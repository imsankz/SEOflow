/**
 * AI Citation Tracker — mention detection.
 *
 * Implements the research spec (t_cc28dbec, research-report.md §3):
 * - domain pattern:  \b(?:https?:\/\/)?(?:www\.)?<siteUrl>\b  (case-insensitive)
 * - brand pattern:   \b<SiteName>\b — by default only capitalized
 *                    ("Chasing Whereabouts"), config flag brandNameRequiresCapital
 * - author pattern:  \b<Author Name>\b — default OFF (common-name false positives)
 * - strip echoed probe prompt from the answer before matching
 * - tag matches inside a trailing Sources/References/Links block
 * - dedupe overlapping matches (domain is the high-confidence signal)
 * - record per-match detail up to maxMatchesPerProbe
 */
import type { CitationsConfig } from '../config';
import type { MentionMatch } from './types';

export interface DetectionSite {
  siteUrl: string;
  siteName: string;
  author: string;
}

export interface DetectionSettings {
  includeAuthor: boolean;
  brandNameRequiresCapital: boolean;
  maxMatchesPerProbe: number;
}

export interface DetectionResult {
  mentions: MentionMatch[];
  /** Total distinct mentions (may exceed mentions.length when capped for detail). */
  mentionCount: number;
  /** Count of [N] inline citation markers in the answer text. */
  inlineCitationCount: number;
}

export function resolveDetectionSettings(cfg?: CitationsConfig): DetectionSettings {
  return {
    includeAuthor: cfg?.detection?.includeAuthor ?? false,
    brandNameRequiresCapital: cfg?.detection?.brandNameRequiresCapital ?? true,
    maxMatchesPerProbe: cfg?.detection?.maxMatchesPerProbe ?? 10,
  };
}

/** Escape regex metacharacters in a user-supplied pattern source. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Capitalize the first letter of each word ("chasing whereabouts" → "Chasing Whereabouts"). */
function capitalizeWords(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

interface CompiledPattern {
  matchKind: MentionMatch['matchKind'];
  /** Human-readable source, e.g. "chasingwhereabouts.com". */
  pattern: string;
  regex: RegExp;
  priority: number;
}

/** Build the per-site detection regex set from config. */
export function buildPatterns(site: DetectionSite, settings: DetectionSettings): CompiledPattern[] {
  const patterns: CompiledPattern[] = [];

  // Domain — high-confidence signal; bare domain matches inside URLs, markdown links, plain text.
  const domain = site.siteUrl.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
  if (domain) {
    patterns.push({
      matchKind: 'domain',
      pattern: domain,
      regex: new RegExp(`\\b(?:https?:\\/\\/)?(?:www\\.)?${escapeRegex(domain)}\\b`, 'gi'),
      priority: 0,
    });
  }

  // Brand name — capitalized only by default to avoid generic-phrase false positives.
  const brand = site.siteName.trim();
  if (brand) {
    const brandSource = settings.brandNameRequiresCapital ? capitalizeWords(brand) : brand;
    patterns.push({
      matchKind: 'brand',
      pattern: brandSource,
      regex: new RegExp(`\\b${brandSource.split(/\s+/).map(escapeRegex).join('\\s+')}\\b`, settings.brandNameRequiresCapital ? 'g' : 'gi'),
      priority: 1,
    });
  }

  // Author — optional, default OFF.
  if (settings.includeAuthor) {
    const author = site.author.trim();
    if (author) {
      const authorSource = capitalizeWords(author);
      patterns.push({
        matchKind: 'author',
        pattern: authorSource,
        regex: new RegExp(`\\b${authorSource.split(/\s+/).map(escapeRegex).join('\\s+')}\\b`, 'g'),
        priority: 2,
      });
    }
  }

  return patterns;
}

/** Remove the probe prompt from the answer if the model echoed it verbatim. */
export function stripEchoedPrompt(answer: string, prompt: string): string {
  if (!prompt) return answer;
  const idx = answer.indexOf(prompt);
  if (idx === -1) return answer;
  return answer.slice(0, idx) + answer.slice(idx + prompt.length);
}

/** Index after which matches are considered part of a Sources/References/Links block (or -1). */
export function findSourcesSectionIndex(answer: string): number {
  // `g` flag is REQUIRED — without it re.exec() returns the same first match
  // forever and the loop never terminates.
  const re = /^(sources|references|links)\s*:/gim;
  let idx = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) {
    idx = m.index;
  }
  return idx;
}

/** Collapse whitespace in a context snippet. */
function tidyContext(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Detect mentions of the site/brand/author in a model answer.
 *
 * @param answer Raw model answer text.
 * @param prompt The probe prompt (stripped from the answer if echoed).
 * @param site Site identity (siteUrl/siteName/author).
 * @param settings Detection tuning.
 */
export function detectMentions(
  answer: string,
  prompt: string,
  site: DetectionSite,
  settings: DetectionSettings,
): DetectionResult {
  const stripped = stripEchoedPrompt(answer, prompt);
  const sourcesIdx = findSourcesSectionIndex(stripped);
  const patterns = buildPatterns(site, settings);

  interface RawMatch {
    matchKind: MentionMatch['matchKind'];
    pattern: string;
    start: number;
    end: number;
    priority: number;
  }

  const raw: RawMatch[] = [];
  for (const p of patterns) {
    for (const m of stripped.matchAll(p.regex)) {
      raw.push({ matchKind: p.matchKind, pattern: p.pattern, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, priority: p.priority });
    }
  }

  // Sort by position, then priority (domain wins ties), then greedily keep
  // non-overlapping matches → deduped distinct mention spans.
  raw.sort((a, b) => a.start - b.start || a.priority - b.priority);

  const kept: RawMatch[] = [];
  let lastEnd = -1;
  for (const m of raw) {
    if (m.start < lastEnd) continue; // overlaps a previously kept match
    kept.push(m);
    lastEnd = m.end;
  }

  const mentionCount = kept.length;
  const mentions: MentionMatch[] = [];
  for (const m of kept.slice(0, Math.max(1, settings.maxMatchesPerProbe))) {
    const ctxStart = Math.max(0, m.start - 80);
    const ctxEnd = Math.min(stripped.length, m.end + 80);
    mentions.push({
      matchKind: m.matchKind,
      pattern: m.pattern,
      count: 1,
      context: tidyContext(stripped.slice(ctxStart, ctxEnd)),
      inSourcesSection: sourcesIdx !== -1 && m.start >= sourcesIdx,
    });
  }

  const inlineCitationCount = (stripped.match(/\[\d+\]/g) ?? []).length;

  return { mentions, mentionCount, inlineCitationCount };
}
