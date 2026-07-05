/**
 * Structured output with Zod schemas.
 *
 * Every pipeline step produces both markdown (body) and structured JSON (data).
 * The data block is validated against a Zod schema so downstream steps can
 * read typed results instead of parsing free text.
 *
 * Pattern: AI response → extract fenced data block → parse with Zod → emit
 */

// ─── Step Output Schemas ──────────────────────────────────────────────────────

export interface StepData {
  /** The step kind */
  kind: string;
  /** Schema version */
  v: number;
}

export interface MetaFixData extends StepData {
  kind: 'meta-fix';
  v: 1;
  changes: Array<{ field: string; from: string; to: string }>;
  scores: {
    descriptionLength: number;
    hasFocusKeyword: boolean;
    hasSchema: boolean;
  };
}

export interface LinkData extends StepData {
  kind: 'link-injection';
  v: 1;
  linksAdded: number;
  links: Array<{ anchor: string; target: string }>;
}

export interface ImageData extends StepData {
  kind: 'image-injection';
  v: 1;
  imagesAdded: number;
  images: Array<{ section: string; url: string; source: string }>;
}

export interface ContentAuditData extends StepData {
  kind: 'content-audit';
  v: 1;
  wordCount: number;
  faqCount: number;
  expandedSections: number;
  nlpTermsWoven: number;
}

export interface ReviewData extends StepData {
  kind: 'seo-review';
  v: 1;
  score: number;
  quickWins: string[];
  severityCounts: {
    high: number;
    medium: number;
    low: number;
  };
  signals: Array<{
    id: string;
    label: string;
    severity: 'high' | 'medium' | 'low' | 'info';
    detail: string;
  }>;
}

export interface SchemaData extends StepData {
  kind: 'schema-validation';
  v: 1;
  types: string[];
  errors: string[];
  warnings: string[];
}

export interface QualityData extends StepData {
  kind: 'quality-audit';
  v: 1;
  score: number;
  eeat: {
    expertise: number;
    authoritativeness: number;
    trustworthiness: number;
  };
  readabilityScore: number;
}

export interface TechnicalData extends StepData {
  kind: 'technical-audit';
  v: 1;
  scores: {
    crawl: number;
    index: number;
    mobile: number;
    performance: number;
    schema: number;
  };
  severityCounts: {
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  signals: Array<{
    id: string;
    label: string;
    severity: 'high' | 'medium' | 'low' | 'info';
    detail: string;
  }>;
}

// ─── Extract structured data from LLM response ────────────────────────────────

/**
 * Extract a fenced JSON data block from an AI response.
 *
 * The AI is instructed to append a block like:
 * ```data
 * { "kind": "...", ... }
 * ```
 */
export function extractDataBlock(text: string): { body: string; data: Record<string, unknown> | null } {
  const dataBlockMatch = text.match(/```data\n([\s\S]*?)```/);
  if (!dataBlockMatch) {
    return { body: text, data: null };
  }

  try {
    const data = JSON.parse(dataBlockMatch[1]) as Record<string, unknown>;
    const body = text.replace(dataBlockMatch[0], '').trim();
    return { body, data };
  } catch (e) {
    console.error(`     Failed to parse data block: ${e instanceof Error ? e.message : 'unknown'}`);
    return { body: text, data: null };
  }
}

/**
 * Validate data against a type guard / shape check.
 *
 * Instead of importing Zod (heavy for a CLI), we use simple shape validators.
 */
export function validateShape<T>(data: unknown, shape: Record<string, string>): data is T {
  if (typeof data !== 'object' || data === null) return false;
  for (const [key, type] of Object.entries(shape)) {
    const val = (data as Record<string, unknown>)[key];
    if (type.endsWith('[]')) {
      if (!Array.isArray(val)) return false;
    } else if (type === 'number') {
      if (typeof val !== 'number') return false;
    } else if (type === 'string') {
      if (typeof val !== 'string') return false;
    } else if (type === 'boolean') {
      if (typeof val !== 'boolean') return false;
    } else if (type === 'object') {
      if (typeof val !== 'object' || val === null) return false;
    }
  }
  return true;
}

/**
 * Validate ReviewData shape.
 */
export function isReviewData(data: unknown): data is ReviewData {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as ReviewData).kind === 'seo-review' &&
    typeof (data as ReviewData).score === 'number'
  );
}

/**
 * Validate TechnicalData shape.
 */
export function isTechnicalData(data: unknown): data is TechnicalData {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as TechnicalData).kind === 'technical-audit' &&
    typeof (data as TechnicalData).scores === 'object'
  );
}

/**
 * Write a structured data sidecar file alongside an audit report.
 */
import fs from 'node:fs';
import path from 'node:path';

export function writeDataSidecar(outputPath: string, data: Record<string, unknown>): string {
  const dir = path.dirname(outputPath);
  const base = path.basename(outputPath, path.extname(outputPath));
  const sidecarPath = path.join(dir, `${base}.data.json`);
  fs.writeFileSync(sidecarPath, JSON.stringify(data, null, 2));
  return sidecarPath;
}