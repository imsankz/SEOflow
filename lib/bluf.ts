/**
 * BLUF (Bottom-Line-Up-Front) summary generator.
 *
 * Feature 3 — produces an AI-answer-ready summary sidecar for a post:
 * a 1-2 sentence BLUF statement, a Quick Answer paragraph, a Key Facts
 * table (fact | detail), scannable H2 sections, and 3-5 Q/A pairs.
 *
 * Read-only by design: it never rewrites the post, it only generates
 * markdown + JSON sidecars under .seoflow/bluf/.
 *
 * Degradation: when no AI key is configured (GEMINI_API_KEY /
 * OPENROUTER_API_KEY) it returns a degraded result with a clear message —
 * callers print it and exit 0, never crash.
 */

import fs from 'fs';
import path from 'path';
import { parseMdx } from './mdx-parser';
import { aiChatWithRetry } from './ai-provider';
import { getAiContext, getWritingSample, getContentDomain, getPostsDir } from './config';
import type { Frontmatter } from './types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BlufKeyFact {
  fact: string;
  detail: string;
}

export interface BlufSection {
  heading: string;
  summary: string;
  bullets: string[];
}

export interface BlufQaPair {
  question: string;
  answer: string;
}

export interface BlufResult {
  slug: string;
  title: string;
  /** 1-2 sentence bottom-line-up-front statement. */
  blufStatement: string;
  /** Quick Answer paragraph answering the core question immediately. */
  quickAnswer: string;
  /** Key Facts table rows (fact | detail). */
  keyFacts: BlufKeyFact[];
  /** Scannable H2 sections with bullet summaries. */
  sections: BlufSection[];
  /** 3-5 Q/A pairs for AI assistants and FAQs. */
  qaPairs: BlufQaPair[];
  /** True when generation was skipped (no AI key / post missing / AI failure). */
  degraded?: boolean;
  /** Human-readable skip message when degraded. */
  message?: string;
}

// ─── Guards ──────────────────────────────────────────────────────────────────

/** True when at least one supported AI key is configured. */
export function hasAiKey(): boolean {
  return !!process.env.GEMINI_API_KEY || !!process.env.OPENROUTER_API_KEY;
}

// ─── Post loading ────────────────────────────────────────────────────────────

/** Resolve the post file (`.mdx` preferred, then `.md`) for a slug. */
export function resolvePostFile(slug: string): string | null {
  const postsDir = getPostsDir();
  const mdxPath = path.join(postsDir, `${slug}.mdx`);
  if (fs.existsSync(mdxPath)) return mdxPath;
  const mdPath = path.join(postsDir, `${slug}.md`);
  if (fs.existsSync(mdPath)) return mdPath;
  return null;
}

/** Load a post's frontmatter + body from postsDir. Null when the slug has no file. */
export function loadPostForBluf(slug: string): { filePath: string; frontmatter: Frontmatter; content: string } | null {
  const filePath = resolvePostFile(slug);
  if (!filePath) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  const { frontmatter, content } = parseMdx(raw);
  return { filePath, frontmatter, content };
}

/** Best writing-sample content type for a post (mirrors pipeline/steps.ts). */
export function detectContentType(frontmatter: Frontmatter): string {
  const schema = (frontmatter.schema || '').toLowerCase();
  if (schema.includes('review')) return 'review';
  if (schema.includes('itinerary')) return 'itinerary';
  return frontmatter.category || 'guide';
}

// ─── Prompt construction ─────────────────────────────────────────────────────

/**
 * Build the BLUF generation prompt: site context + writing sample + content
 * excerpt, with strict raw-JSON output rules and the "never generic" voice
 * rules used by the rest of the pipeline.
 */
export function buildBlufPrompt(slug: string, frontmatter: Frontmatter, content: string): string {
  const ai = getAiContext();
  const contentType = detectContentType(frontmatter);
  const writingSample = getWritingSample(contentType);
  const contentDomain = getContentDomain();
  const title = frontmatter.title || slug;

  const contentSnippet = content.length > 3000
    ? content.slice(0, 1500) + '\n\n...[middle of post]...\n\n' + content.slice(-800)
    : content;

  const voiceSection = writingSample
    ? `Here is a sample of ${ai.author}'s actual writing voice — match this tone exactly:\n"${writingSample}"\n`
    : '';

  return `You are creating a BLUF (Bottom-Line-Up-Front) summary for a ${contentDomain} post on ${ai.siteUrl} written by ${ai.author}${ai.authorLocation ? `, based in ${ai.authorLocation}` : ''}.

Voice: first-person, practical, authentic, specific. Never generic. Never AI-sounding. Never invent facts — only summarize what the post actually says. If the post gives specific prices, times, routes, or numbers, keep them in the summary.

${voiceSection}
Style rules:
- Short, punchy sentences. Vary length.
- Specific, grounded observations (not vague praise)
- Practical details: prices, transit, timing
- Never use: nestled, delve, vibrant, treasure trove, bustling, hidden gem, breathtaking, truly unique, picturesque, enchanting, captivating, magical, whimsical, wanderlust

POST TITLE: ${title}
SLUG: ${slug}

CURRENT CONTENT EXCERPT:
${contentSnippet}

YOUR TASK — produce an AI-answer-ready summary with:
1. A BLUF statement: 1-2 sentences that give the bottom line first (the direct answer to the post's core question).
2. A Quick Answer paragraph: 2-4 sentences answering the core question immediately, no preamble.
3. A Key Facts table: 4-8 rows of (fact | detail) — specific numbers, prices, times, routes from the post.
4. Scannable H2 sections: 3-6 sections, each with a short heading, a 1-2 sentence summary, and 2-4 bullets.
5. Q/A pairs: 3-5 questions a reader (or an AI assistant) would ask, each with a 2-3 sentence answer.

OUTPUT RULES:
- Respond with ONLY a raw JSON object — no explanation, no markdown, no code fences
- Start your response with { and end with }
- Use \\n for newlines inside string values
- Never invent facts that are not in the post

JSON FORMAT:
{"bluf_statement":"...","quick_answer":"...","key_facts":[{"fact":"...","detail":"..."}],"sections":[{"heading":"...","summary":"...","bullets":["...","..."]}],"qa_pairs":[{"question":"...?","answer":"..."}]}`;
}

// ─── Response parsing ────────────────────────────────────────────────────────

/** Empty (non-degraded) result used as a parse fallback. */
export function emptyBlufResult(slug: string, title: string): BlufResult {
  return { slug, title, blufStatement: '', quickAnswer: '', keyFacts: [], sections: [], qaPairs: [] };
}

/**
 * Parse the AI's raw JSON response into a typed BlufResult.
 * Tolerates code fences, surrounding prose, and malformed JSON (returns an
 * empty result rather than throwing).
 */
export function parseBlufResponse(response: string, slug: string, title: string): BlufResult {
  const fallback = emptyBlufResult(slug, title);
  let raw = response.trim();
  raw = raw.replace(/^```(?:json)?\s*/im, '').replace(/```\s*$/m, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) return fallback;

  let data: any;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return fallback;
  }
  if (!data || typeof data !== 'object') return fallback;

  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const objList = (v: unknown): any[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);

  return {
    slug,
    title,
    blufStatement: str(data.bluf_statement),
    quickAnswer: str(data.quick_answer),
    keyFacts: objList(data.key_facts)
      .map((k) => ({ fact: str(k.fact), detail: str(k.detail) }))
      .filter((k) => k.fact || k.detail),
    sections: objList(data.sections)
      .map((s) => ({
        heading: str(s.heading),
        summary: str(s.summary),
        bullets: Array.isArray(s.bullets) ? s.bullets.map((b: unknown) => str(b)).filter(Boolean) : [],
      }))
      .filter((s) => s.heading),
    qaPairs: objList(data.qa_pairs)
      .map((q) => ({ question: str(q.question), answer: str(q.answer) }))
      .filter((q) => q.question || q.answer),
  };
}

// ─── Generation ──────────────────────────────────────────────────────────────

/**
 * Generate a BLUF summary for a post slug.
 *
 * Degrades (never throws) to an empty result with a clear `message` when:
 * - no AI key is configured (GEMINI_API_KEY / OPENROUTER_API_KEY),
 * - the post file is missing,
 * - the AI call fails after retries.
 */
export async function generateBluf(slug: string): Promise<BlufResult> {
  const skip = (message: string): BlufResult => ({
    ...emptyBlufResult(slug, slug),
    degraded: true,
    message,
  });

  if (!hasAiKey()) {
    return skip('BLUF skipped — no AI key configured (set GEMINI_API_KEY or OPENROUTER_API_KEY)');
  }

  const post = loadPostForBluf(slug);
  if (!post) {
    return skip(`BLUF skipped — post not found: ${slug}`);
  }

  const prompt = buildBlufPrompt(slug, post.frontmatter, post.content);
  const response = await aiChatWithRetry(prompt, 'bluf');
  if (!response) {
    return skip(`BLUF generation failed for ${slug} after retries`);
  }

  return parseBlufResponse(response, slug, post.frontmatter.title || slug);
}

// ─── Sidecar output ──────────────────────────────────────────────────────────

/** Escape pipes so fact/detail values survive markdown table cells. */
function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/** Render a BlufResult as a markdown sidecar document. */
export function blufToMarkdown(result: BlufResult): string {
  let md = `# BLUF: ${result.title}\n\n`;
  if (result.blufStatement) {
    md += `> ${result.blufStatement}\n\n`;
  }

  if (result.quickAnswer) {
    md += `## Quick Answer\n\n${result.quickAnswer}\n\n`;
  }

  if (result.keyFacts.length > 0) {
    md += `## Key Facts\n\n| Fact | Detail |\n|------|--------|\n`;
    for (const kf of result.keyFacts) {
      md += `| ${escapeCell(kf.fact)} | ${escapeCell(kf.detail)} |\n`;
    }
    md += '\n';
  }

  if (result.sections.length > 0) {
    md += `## Scannable Sections\n\n`;
    for (const s of result.sections) {
      md += `### ${s.heading}\n\n${s.summary}\n\n`;
      for (const b of s.bullets) {
        md += `- ${b}\n`;
      }
      md += '\n';
    }
  }

  if (result.qaPairs.length > 0) {
    md += `## Q&A\n\n`;
    for (const q of result.qaPairs) {
      md += `**Q: ${q.question}**\n\n${q.answer}\n\n`;
    }
  }

  md += `---\n*Generated by SeoFlow BLUF — AI-answer-ready sidecar. Post content was not modified.*\n`;
  return md;
}

/** Write the .md + .json BLUF sidecars. Returns both absolute paths. */
export function saveBluf(result: BlufResult, dir: string = '.seoflow/bluf'): { mdPath: string; jsonPath: string } {
  fs.mkdirSync(dir, { recursive: true });
  const mdPath = path.join(dir, `${result.slug}.md`);
  const jsonPath = path.join(dir, `${result.slug}.json`);
  fs.writeFileSync(mdPath, blufToMarkdown(result), 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf8');
  return { mdPath, jsonPath };
}
