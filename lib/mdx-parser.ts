/**
 * MDX parsing and content analysis utilities.
 */
import yaml from 'js-yaml';
import type { Frontmatter, Section } from './types';
import { getSiteUrl } from './config';

/**
 * Parse an MDX string into frontmatter and body content.
 *
 * Uses a real YAML parser (js-yaml, JSON schema) so quoted/multiline scalars,
 * lists, booleans and integers round-trip losslessly. JSON schema keeps
 * YAML timestamps (e.g. `publishedDate: 2024-01-16`) as plain strings.
 */
export function parseMdx(raw: string): { frontmatter: Frontmatter; fmBlock: string; content: string } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return { frontmatter: {}, fmBlock: '', content: raw };
  const fmBlock = match[0];
  const content = raw.slice(fmBlock.length);
  let frontmatter: Frontmatter = {};
  try {
    const parsed = yaml.load(match[1], { schema: yaml.JSON_SCHEMA }) as Record<string, unknown> | undefined;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      frontmatter = { ...(parsed as Frontmatter) };
    }
  } catch {
    // Defensive fallback: hand-rolled parser for frontmatter a strict YAML
    // parse rejects. Kept from the original implementation.
    frontmatter = parseFrontmatterLegacy(match[1]);
  }
  return { frontmatter, fmBlock, content };
}

/**
 * Legacy line-based frontmatter parser (fallback when yaml.load throws).
 * NOTE: unlike the original, this does NOT inject author/date keys — schema
 * generators resolve those via config fallbacks (resolveAuthor/resolveDate).
 */
function parseFrontmatterLegacy(block: string): Frontmatter {
  const frontmatter: Frontmatter = {};
  let currentKey: string | null = null;
  let inMultiline = false;
  let multilineVal: string[] = [];

  for (const line of block.split('\n')) {
    const kv = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (kv) {
      if (inMultiline && currentKey) {
        frontmatter[currentKey] = multilineVal.join('\n').trim();
        inMultiline = false;
        multilineVal = [];
      }
      currentKey = kv[1];
      let val: any = kv[2].trim();
      if (val === '>-' || val === '>') { inMultiline = true; multilineVal = []; continue; }
      if (val.startsWith('[') && val.endsWith(']')) {
        frontmatter[currentKey] = val
          .slice(1, -1)
          .split(',')
          .map((s: string) => s.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean);
        continue;
      }
      if (val === 'true') val = true;
      else if (val === 'false') val = false;
      else if (/^\d+$/.test(val)) val = parseInt(val);
      else if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) val = val.slice(1, -1);
      frontmatter[currentKey] = val;
    } else if (inMultiline) {
      multilineVal.push(line.trim());
    } else if (currentKey && line.match(/^\s+-\s+(.+)/)) {
      if (!Array.isArray(frontmatter[currentKey])) frontmatter[currentKey] = [];
      frontmatter[currentKey].push(line.replace(/^\s+-\s+/, '').trim().replace(/^['"]|['"]$/g, ''));
    }
  }
  if (inMultiline && currentKey) frontmatter[currentKey] = multilineVal.join(' ').trim();

  return frontmatter;
}

/**
 * Rebuild a frontmatter block from a Frontmatter object.
 * Uses yaml.dump so all values are emitted with correct YAML quoting/escaping
 * (apostrophes, colons, hashes, multiline scalars, lists). Key order is
 * preserved (sortKeys: false) and long strings are not folded (lineWidth: -1).
 */
export function buildFrontmatterBlock(fm: Frontmatter): string {
  const dumped = yaml
    .dump(fm, { schema: yaml.JSON_SCHEMA, lineWidth: -1, noRefs: true, sortKeys: false })
    .trimEnd();
  return '---\n' + dumped + '\n---\n';
}

/**
 * Count words in MDX content (excludes code blocks, HTML tags, markdown syntax).
 */
export function countWords(content: string): number {
  return content
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[#*_\[\]()]/g, '')
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * Count internal links in MDX content.
 */
export function countInternalLinks(content: string, siteUrl?: string): number {
  const links = [...content.matchAll(/\[.*?\]\(([^)]+)\)/g)].map(m => m[1]);
  return links.filter(l => !l.startsWith('http') || (siteUrl ? l.includes(siteUrl) : false)).length;
}

/**
 * Count images in MDX content.
 */
export function countImages(content: string): number {
  return (content.match(/!\[.*?\]\(.*?\)|<Image\s/g) || []).length;
}

/**
 * Extract all existing internal links from content as a Set of paths.
 */
export function extractExistingLinks(content: string): Set<string> {
  const links = new Set<string>();
  for (const m of content.matchAll(/\[.*?\]\(([^)]+)\)/g)) {
    const siteUrl = getSiteUrl().replace(/^https?:\/\//, '').replace(/\/$/, '');
    const href = m[1].replace(new RegExp(`^https?://(www\\.)?${siteUrl.replace(/\./g, '\\.')}`), '');
    links.add(href);
  }
  return links;
}

/**
 * Extract H2 sections from MDX content.
 */
export function getH2Sections(content: string): Section[] {
  const sections: Section[] = [];
  const lines = content.split('\n');
  let current: Section | null = null;
  for (const line of lines) {
    const h2 = line.match(/^## (.+)/);
    if (h2) {
      if (current) sections.push(current);
      current = { heading: h2[1], lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push(current);
  return sections;
}

/**
 * Check if a section needs an image (no existing image, and enough text).
 */
export function sectionNeedsImage(sectionLines: string[]): boolean {
  const text = sectionLines.join('\n');
  const hasImage = /!\[.*?\]\(.*?\)|<Image\s/.test(text);
  const wordCount = countWords(text);
  return !hasImage && wordCount > 150;
}

/**
 * Score a post's SEO priority based on GSC data.
 */
export function scorePriority(slug: string, gscData: { [slug: string]: { impressions?: number; position?: number; ctr?: number; clicks?: number } }): number {
  const gsc = gscData[slug] || {};
  let score = 0;

  if (gsc.impressions && gsc.impressions > 5000) score += 50;
  else if (gsc.impressions && gsc.impressions > 1000) score += 30;
  else if (gsc.impressions && gsc.impressions > 500) score += 15;

  if (gsc.position && gsc.position >= 5 && gsc.position <= 15) score += 40;
  else if (gsc.position && gsc.position >= 15 && gsc.position <= 30) score += 20;

  if (gsc.impressions && gsc.impressions > 500 && gsc.ctr && gsc.ctr < 3) score += 25;
  if (gsc.clicks && gsc.clicks > 100) score += 20;
  else if (gsc.clicks && gsc.clicks > 50) score += 10;

  return score;
}
