/**
 * SeoFlow — Content Generator
 *
 * Generates new MDX posts from keywords/gaps using Gemini.
 * Site-specific identity comes from seoflow.config.json.
 */
import fs from 'fs';
import path from 'path';
import { loadConfig, getPostsDir, getGapQueuePath, getAiContext, getContentTypes, getContentDomain, getDefaultCategory } from './config';
import { aiChatWithRetry } from './ai-provider';
import { parseMdx } from './mdx-parser';
import type { Frontmatter } from './types';

export interface ContentGap {
  keyword: string;
  type: string;
  destination: string;
  country: string;
  slug?: string;
  priority?: number;
}

/** Raw gap-queue entry shape (data/content-gaps.json). */
interface RawGap {
  destination: string;
  country: string;
  type: string;
  label?: string;
  priority?: number;
  suggestedSlug?: string;
  reason?: string;
}

interface GapQueue {
  aiPrioritised?: RawGap[];
  allGaps?: RawGap[];
}

/** Type ROI order used to break priority ties — highest-value formats first. */
const TYPE_ROI_ORDER = [
  'city-pass-review', 'city-itinerary-3d', 'things-to-do', 'city-itinerary-week',
  'where-to-stay', 'best-restaurants', 'day-trips', 'budget-guide',
  'country-guide', 'country-itinerary', 'transportation', 'getting-around',
];

function normalizeType(type: string): string {
  return type.toLowerCase().replace(/\s+/g, '-');
}

function keywordForGap(type: string, destination: string): string {
  const map: Record<string, string> = {
    'city-pass-review': `${destination} pass review`,
    'city-itinerary-3d': `3 days in ${destination}`,
    'city-itinerary-week': `one week in ${destination}`,
    'things-to-do': `things to do in ${destination}`,
    'where-to-stay': `where to stay in ${destination}`,
    'best-restaurants': `best restaurants in ${destination}`,
    'day-trips': `day trips from ${destination}`,
    'budget-guide': `${destination} on a budget`,
    'country-guide': `${destination} travel guide`,
    'country-itinerary': `one week in ${destination}`,
    'transportation': `getting around ${destination}`,
    'getting-around': `how to get around ${destination}`,
  };
  return map[type] || `${type.replace(/-/g, ' ')} ${destination}`;
}

/**
 * Pick the next unwritten content gap from the configured gap queue
 * (data/content-gaps.json by default). Skips any suggestedSlug that
 * already exists in postsDir. Prefers aiPrioritised entries, then
 * falls back to allGaps sorted by priority, then type ROI.
 */
export function pickNextContentGaps(limit = 1, opts: { destination?: string; country?: string } = {}): ContentGap[] {
  const gapQueuePath = getGapQueuePath();
  if (!fs.existsSync(gapQueuePath)) {
    console.log(`     ⚠️  No gap queue found at ${gapQueuePath}`);
    return [];
  }

  let queue: GapQueue;
  try {
    queue = JSON.parse(fs.readFileSync(gapQueuePath, 'utf8'));
  } catch (e) {
    console.log(`     ⚠️  Failed to parse gap queue: ${e instanceof Error ? e.message : e}`);
    return [];
  }

  const postsDir = getPostsDir();
  const existingSlugs = new Set(
    fs.existsSync(postsDir)
      ? fs.readdirSync(postsDir).filter(f => f.endsWith('.mdx') || f.endsWith('.md')).map(f => f.replace(/\.mdx?$/, ''))
      : []
  );

  const isPublished = (slug: string): boolean => {
    const mdxPath = path.join(postsDir, `${slug}.mdx`);
    const mdPath = path.join(postsDir, `${slug}.md`);
    const p = fs.existsSync(mdxPath) ? mdxPath : (fs.existsSync(mdPath) ? mdPath : null);
    if (!p) return false;
    try {
      const { frontmatter } = parseMdx(fs.readFileSync(p, 'utf8'));
      return frontmatter.published !== false; // treat missing/true as published
    } catch {
      return true; // file exists and can't be parsed — don't overwrite it
    }
  };

  const matchesFilter = (g: RawGap): boolean => {
    if (opts.destination && g.destination.toLowerCase() !== opts.destination.toLowerCase()) return false;
    if (opts.country && g.country.toLowerCase() !== opts.country.toLowerCase()) return false;
    return true;
  };

  const toGap = (g: RawGap): ContentGap => {
    const type = normalizeType(g.type);
    const slug = g.suggestedSlug || generateSlug(keywordForGap(type, g.destination), g.destination);
    return {
      keyword: keywordForGap(type, g.destination),
      type,
      destination: g.destination,
      country: g.country,
      slug,
      priority: g.priority ?? 2,
    };
  };

  const picked: ContentGap[] = [];
  const seen = new Set<string>();

  const consider = (g: RawGap) => {
    if (picked.length >= limit) return;
    if (!matchesFilter(g)) return;
    const gap = toGap(g);
    if (seen.has(gap.slug!)) return;
    if (existingSlugs.has(gap.slug!) && isPublished(gap.slug!)) return;
    seen.add(gap.slug!);
    picked.push(gap);
  };

  // 1. AI-prioritised queue first (already ranked by ROI/impact)
  for (const g of queue.aiPrioritised || []) consider(g);

  // 2. Remaining gaps, sorted by priority (1 = highest) then type ROI order
  const rest = [...(queue.allGaps || [])].sort((a, b) => {
    const pDiff = (a.priority ?? 3) - (b.priority ?? 3);
    if (pDiff !== 0) return pDiff;
    const aIdx = TYPE_ROI_ORDER.indexOf(normalizeType(a.type));
    const bIdx = TYPE_ROI_ORDER.indexOf(normalizeType(b.type));
    return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
  });
  for (const g of rest) consider(g);

  return picked;
}

export interface GeneratedPost {
  slug: string;
  filePath: string;
  content: string;
  frontmatter: Frontmatter;
}

/**
 * Generate a post for a given keyword/content gap.
 * Returns the post content and frontmatter, or null on failure.
 */
export async function generatePost(gap: ContentGap): Promise<GeneratedPost | null> {
  const cfg = loadConfig();
  const ai = getAiContext();
  const today = new Date().toISOString().split('T')[0];
  const contentTypes = getContentTypes();
  const typeConfig = contentTypes[gap.type] || contentTypes['article'] || { schema: 'Article', instructions: 'Write an informative article.' };
  const slug = gap.slug || generateSlug(gap.keyword, gap.destination);
  const postsDir = getPostsDir();

  // Check if slug already exists
  if (fs.existsSync(path.join(postsDir, `${slug}.mdx`))) {
    console.log(`     ⏭️  "${slug}" already exists, skipping`);
    return null;
  }

  const domain = getContentDomain();
  const prompt = `You are ${ai.author}, a ${domain} writer for ${ai.siteUrl}. You live in ${ai.authorLocation} and write honest, practical, first-person ${domain} content.

Generate a complete MDX blog post for the following topic. Follow the instructions strictly.

TOPIC: ${gap.keyword} in ${gap.destination}, ${gap.country}
TYPE: ${gap.type}
TARGET WORD COUNT: ${cfg.generation?.wordCountMin || 1500}–${cfg.generation?.wordCountMax || 2500} words

CONTENT INSTRUCTIONS:
${typeConfig.instructions}

VOICE RULES:
- First-person, practical, specific. Never generic or AI-sounding.
- Never start a paragraph with "I" — vary your sentence openings.
- Include specific prices, transit times, and real details you've experienced.
- Short, punchy sentences. Vary length.
- Never use: nestled, delve, vibrant, treasure trove, hidden gem, breathtaking, truly unique.

OUTPUT FORMAT (YAML frontmatter + MDX body):
---
title: "Compelling SEO title under 55 chars"
date: "${today}"
lastModified: "${today}"
category: ${getDefaultCategory()}
excerpt: "150-160 char meta description with keyword naturally included"
coverImage: ""
published: false
author: ${ai.author}
tags:
  - "${gap.destination}"
  - "${gap.country}"
  - "${getContentDomain()} guide"
schema: ${typeConfig.schema}
focusKeyword: "${gap.keyword}"
description: "Same as excerpt"
visitedDate: "${today.slice(0, 7)}"
---

[Your content here with ## H2 headings]

Internal link format: [anchor text](/related-page) — use / and not full URLs.
Include a "Quick Summary" section near the top if it's a guide or itinerary.
${cfg.destinationPattern ? `Right after the frontmatter, add a one-line breadcrumb: > *Part of [${gap.country} Travel Guide](${cfg.destinationPattern.replace('{country}', gap.country.toLowerCase().replace(/[^a-z0-9]+/g, '-'))})*` : ''}
Do NOT include markdown code fences around the YAML frontmatter.`;

  console.log(`     🤖 Generating "${slug}" (${gap.type}, ${gap.country})...`);

  const response = await aiChatWithRetry(prompt, 'content-audit');
  if (!response) {
    console.log(`     ❌ Generation failed for "${slug}"`);
    return null;
  }

  // Extract or prepend frontmatter
  let content = response.trim();
  if (!content.startsWith('---')) {
    content = `---\ntitle: "${gap.keyword} - ${gap.destination} Guide"\ndate: "${today}"\nlastModified: "${today}"\ncategory: ${getDefaultCategory()}\nexcerpt: "A practical guide to ${gap.keyword.toLowerCase()} in ${gap.destination}."\ncoverImage: ""\npublished: false\nauthor: ${ai.author}\ntags:\n  - "${gap.destination}"\n  - "${gap.country}"\nschema: ${typeConfig.schema}\nfocusKeyword: "${gap.keyword}"\ndescription: "A practical guide to ${gap.keyword.toLowerCase()} in ${gap.destination}."\n---\n\n${content}`;
  }

  const filePath = path.join(postsDir, `${slug}.mdx`);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`     ✅ Generated: ${slug}.mdx`);

  return { slug, filePath, content, frontmatter: {} };
}

/**
 * Generate a URL-friendly slug from a keyword and destination.
 */
export function generateSlug(keyword: string, destination: string): string {
  const kw = keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${kw}-${destination.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

/**
 * Generate multiple posts from a list of gaps. If `gaps` is empty, pulls
 * the next `limit` unwritten gaps from the configured gap queue.
 */
export async function generateBatch(gaps: ContentGap[], limit = 5): Promise<GeneratedPost[]> {
  const results: GeneratedPost[] = [];
  const source = gaps.length > 0 ? gaps : pickNextContentGaps(limit);
  if (source.length === 0) {
    console.log('     📭 No gaps to generate — provide --slug/--country or populate the gap queue');
    return results;
  }
  const toProcess = source.slice(0, limit);

  for (let i = 0; i < toProcess.length; i++) {
    const gap = toProcess[i];
    console.log(`\n  [${i + 1}/${toProcess.length}] ${gap.keyword} (${gap.destination})`);
    const post = await generatePost(gap);
    if (post) results.push(post);
  }

  console.log(`\n📋 Generated ${results.length}/${toProcess.length} posts`);
  if (results.length > 0) {
    console.log(`   Files: ${results.map(p => p.slug).join(', ')}`);
    console.log(`   Review and set published: true when ready.`);
  }

  return results;
}
