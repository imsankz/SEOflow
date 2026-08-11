/**
 * GEO / AI-Citability audit step (added 2026-08-04)
 *
 * Scores content for how likely AI answer engines (ChatGPT, Claude, Gemini,
 * Perplexity, AI Overviews) are to cite it. Based on the BabyLoveGrowth
 * Academy playbook (see seo-geo skill, "Operational Playbook — AI Citation
 * Tactics"). This is a read-only scoring step: it reports + logs but does NOT
 * rewrite content (rewrites are the writer's job — AI-quotable rewrites need
 * judgment, not regex).
 */

import type { StepInput, StepOutput } from '../lib/types';

export interface GeoAuditResult {
  score: number;                 // 0-100 citability score
  answerFirstPass: boolean;      // direct answer in first 60 words
  questionHeadingCount: number;  // H2/H3 headings ending in "?"
  faqBlocks: number;             // Q:/A: pairs
  longParagraphs: number;        // paragraphs > 120 words (walls of text)
  listsAndTables: number;        // markdown lists + tables
  selfContainedWarnings: string[]; // first sentences that reference prior context
  issues: string[];
  warnings: string[];
  quickWins: string[];
  // BLUF-readiness signals (feature 3 — additive only, never affect score)
  blufReadiness: {
    directAnswerFirst40: boolean;  // direct answer in the first 40 words
    keyFactsTable: boolean;        // markdown table (fact | detail) near the top
    quickAnswerSection: boolean;   // "Quick Answer"-style H2 section
  };
}

const AI_PATTERNS = /(?:as an AI|language model|delve|tapestry|testament|embark|unlock|moreover|furthermore|in conclusion|nestled|bustling|vibrant|picturesque|hidden gem|hassle-free|game-changer|breathtaking|wanderlust|adventure awaits|when it comes to|whether you'?re (?:a |an )?)/gi;

function countQuestionHeadings(body: string): number {
  const matches = body.match(/^#{2,3}\s+.*\?$/gm) || [];
  return matches.length;
}

function countFaqBlocks(body: string): number {
  const qMatches = body.match(/^Q[.:]\s+/gm) || [];
  const aMatches = body.match(/^A[.:]\s+/gm) || [];
  return Math.min(qMatches.length, aMatches.length);
}

function countLongParagraphs(body: string): number {
  // Split on blank lines, count paragraphs > 120 words (excluding headings/lists)
  const paras = body.split(/\n\s*\n/);
  let count = 0;
  for (const p of paras) {
    const trimmed = p.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-') || trimmed.startsWith('|')) continue;
    const words = trimmed.split(/\s+/).length;
    if (words > 120) count++;
  }
  return count;
}

function countListsAndTables(body: string): number {
  const lists = (body.match(/^[-*]\s+/gm) || []).length;
  const tables = (body.match(/^\|.+\|$/gm) || []).length;
  return lists + tables;
}

function findSelfContainedWarnings(body: string): string[] {
  const warnings: string[] = [];
  const paras = body.split(/\n\s*\n/);
  for (const p of paras) {
    const trimmed = p.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue;
    const firstSentence = trimmed.split(/(?<=[.!?])\s/)[0] || '';
    const lower = firstSentence.toLowerCase();
    // Sentences that reference prior context can't be quoted standalone
    if (/^(it|this|that|these|those|they|he|she|we|as mentioned|as noted|above|earlier|the former|the latter)\b/.test(lower) &&
        !/^(it is|it's|it takes|it costs|it depends)/.test(lower)) {
      warnings.push(firstSentence.slice(0, 100) + (firstSentence.length > 100 ? '…' : ''));
    }
  }
  return warnings.slice(0, 5);
}

function countAiPatterns(body: string): number {
  const matches = body.match(AI_PATTERNS) || [];
  return matches.length;
}

/**
 * Runs GEO / AI-citability audit (read-only scoring, no content changes)
 */
export function stepGeoAudit(input: StepInput): StepOutput & { data?: GeoAuditResult } {
  const changes: string[] = [];
  const body = input.content || '';
  const title = input.frontmatter?.title || '';

  // 1. Answer-first: direct answer in first 60 words of the body
  const first60 = body.replace(/^#.*$/gm, '').trim().split(/\s+/).slice(0, 60).join(' ');
  // Heuristic: opening paragraph has a concrete statement (verb + noun), not a story preamble
  const answerFirstPass = first60.split(/\s+/).length >= 15 &&
    /(?:is|are|costs|takes|includes|offers|features|starts|runs|located|open|best|top|guide|plan|you can|how to|where to)\b/i.test(first60) &&
    !/^(when i|i started|i remember|let me|so,|now,|imagine|as a traveler)/i.test(first60.trim());

  // 2. Question headings
  const questionHeadingCount = countQuestionHeadings(body);

  // 3. FAQ blocks
  const faqBlocks = countFaqBlocks(body);

  // 4. Long paragraphs (walls of text)
  const longParagraphs = countLongParagraphs(body);

  // 5. Lists and tables
  const listsAndTables = countListsAndTables(body);

  // 6. Self-contained warnings
  const selfContainedWarnings = findSelfContainedWarnings(body);

  // 7. AI patterns
  const aiPatterns = countAiPatterns(body);

  // ── BLUF-readiness signals (feature 3 — additive only, no score impact) ──
  // A BLUF-friendly post: leads with the direct answer in the first 40-60
  // words, packs key facts into a table near the top (easy for AI answer
  // engines to copy verbatim), and has a "Quick Answer"-style section.
  const first40 = body.replace(/^#.*$/gm, '').trim().split(/\s+/).slice(0, 40).join(' ');
  const directAnswerFirst40 = first40.split(/\s+/).length >= 10 &&
    /(?:is|are|costs|takes|includes|offers|features|starts|runs|located|open|best|top|guide|plan|you can|how to|where to)\b/i.test(first40) &&
    !/^(when i|i started|i remember|let me|so,|now,|imagine|as a traveler)/i.test(first40.trim());
  // Markdown table in the first ~2000 chars of the body (skip headings).
  const topChunk = body.replace(/^#.*$/gm, '').slice(0, 2000);
  const keyFactsTable = /^\|.+\|$/m.test(topChunk);
  const quickAnswerSection = /^#{2,3}\s*(Quick Answer|Quick Summary|At a Glance|TL;DR|Bottom Line)/im.test(body);

  // ── Score (mirrors seo-geo weighting) ─────────────────────────────────────
  let score = 40; // baseline
  if (answerFirstPass) score += 15;
  if (faqBlocks >= 1) score += 10;
  if (faqBlocks >= 3) score += 5;
  if (questionHeadingCount >= 2) score += 10;
  if (questionHeadingCount >= 5) score += 5;
  if (listsAndTables >= 5) score += 10;
  if (listsAndTables >= 12) score += 5;
  if (longParagraphs === 0) score += 10;
  if (longParagraphs <= 2) score += 5;
  if (aiPatterns === 0) score += 5;
  if (selfContainedWarnings.length === 0) score += 5;
  score = Math.min(100, Math.max(0, score));

  const issues: string[] = [];
  const warnings: string[] = [];
  const quickWins: string[] = [];

  if (score >= 80) {
    changes.push(`✅ GEO citability score: ${score}/100 — strong AI-quote potential`);
  } else if (score >= 60) {
    changes.push(`🟡 GEO citability score: ${score}/100 — good, room to improve`);
    warnings.push('GEO score 60-79: add question headings or FAQ block to push past 80.');
  } else {
    changes.push(`🔴 GEO citability score: ${score}/100 — needs AI-quotability work`);
    issues.push('GEO score < 60: content likely passed over by AI answer engines.');
  }

  if (!answerFirstPass) {
    issues.push('No direct answer in first 60 words — AIs grab the top of a section; lead with the answer, then explain.');
    quickWins.push('Rewrite the opening paragraph to state the direct answer first (40-60 words).');
  }
  if (faqBlocks === 0) {
    warnings.push('No FAQ block — add Q:/A: pairs for ready-made quote fodder.');
    quickWins.push('Add an FAQ section with 3-5 Q:/A: pairs.');
  }
  if (questionHeadingCount === 0) {
    warnings.push('No question-form headings — make H2s the real questions ("How much does X cost?" beats "Pricing").');
  }
  if (longParagraphs > 0) {
    warnings.push(`${longParagraphs} paragraph(s) over 120 words — walls of text are hard for AIs to extract from.`);
    quickWins.push('Break long paragraphs into 2-4 sentence chunks.');
  }
  if (aiPatterns > 0) {
    warnings.push(`${aiPatterns} AI-sounding phrase(s) found (e.g. "nestled", "bustling", "when it comes to") — AI-quotable content reads human.`);
  }
  if (selfContainedWarnings.length > 0) {
    warnings.push('Opening sentences reference prior context — a section must make sense lifted out of the page to be quoted.');
  }
  if (listsAndTables < 5) {
    warnings.push('Few lists/tables — these are the easiest content for a model to copy cleanly.');
  }

  // ── BLUF-readiness warnings/quick wins (feature 3 — additive only) ────────
  // These never touch the score above; they flag how ready the post is for a
  // bottom-line-up-front summary and AI-answer extraction.
  if (!directAnswerFirst40) {
    warnings.push('No direct answer in the first 40 words — BLUF-friendly posts state the bottom line before the preamble.');
    quickWins.push('Lead with a 1-2 sentence bottom-line answer in the first 40 words (BLUF).');
  }
  if (!keyFactsTable) {
    warnings.push('No markdown table near the top of the post — AI answer engines copy key-facts tables verbatim.');
    quickWins.push('Add a Key Facts table (fact | detail) near the top of the post.');
  }
  if (!quickAnswerSection) {
    warnings.push('No Quick Answer section — a "## Quick Answer" paragraph up top makes the verdict instantly quotable.');
    quickWins.push('Add a "## Quick Answer" section that answers the core question in one paragraph.');
  }

  if (score >= 80) quickWins.push('Post is AI-quotable — ensure it stays fresh (lastModified) since Perplexity rewards recency.');
  changes.push(`GEO audit: ${questionHeadingCount} question headings, ${faqBlocks} FAQ blocks, ${listsAndTables} lists/tables, ${longParagraphs} long paragraphs`);

  return {
    content: input.content,
    frontmatter: input.frontmatter,
    changes,
    data: {
      score,
      answerFirstPass,
      questionHeadingCount,
      faqBlocks,
      longParagraphs,
      listsAndTables,
      selfContainedWarnings,
      issues,
      warnings,
      quickWins,
      blufReadiness: {
        directAnswerFirst40,
        keyFactsTable,
        quickAnswerSection,
      },
    },
  };
}
