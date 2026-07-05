/**
 * Brain types — structure for SeoFlow's working memory and audit trail.
 *
 * Inspired by SEO Office's marketing-brain.v1 schema but simplified for CLI use.
 * Uses brain_schema: seoflow-brain.v1 frontmatter.
 */
export interface BrainNoteFrontmatter {
  brain_schema: 'seoflow-brain.v1';
  created: string;
  updated: string;
  confidence?: number;
  status?: 'draft' | 'review' | 'approved';
}

/**
 * hot.md — working memory, overwritten each session.
 * Tracks: last run state, what changed, current backlog, next actions.
 */
export interface HotBrain {
  /** Schema marker */
  brain_schema: 'seoflow-brain.v1';
  /** When this brain was last updated */
  lastUpdated: string;
  /** Last pipeline run */
  lastRun?: {
    timestamp: string;
    duration: number;
    postsProcessed: number;
    errors: number;
    totalChanges: number;
  };
  /** Per-post state from last run */
  recentPosts: Array<{
    slug: string;
    status: 'ok' | 'warn' | 'error';
    changes: number;
    aiCalls: number;
  }>;
  /** High-priority next actions */
  nextActions: string[];
  /** Current backlog */
  backlog: Array<{
    slug: string;
    priority: number;
    reason: string;
  }>;
  /** Summary of issues found */
  issues: Array<{
    severity: 'high' | 'medium' | 'low';
    count: number;
    description: string;
  }>;
}

/**
 * log.md — append-only audit trail.
 * Each entry records one decision, change, or observation.
 */
export interface LogEntry {
  timestamp: string;
  type: 'run' | 'step' | 'change' | 'error' | 'decision' | 'note';
  /** Brief single-line summary */
  summary: string;
  /** Slug if post-specific */
  slug?: string;
  /** Step name if pipeline-specific */
  step?: string;
  /** Detail / rationale */
  detail?: string;
  /** Change count if applicable */
  changeCount?: number;
}

// ─── Vault types (for full brain vault system) ────────────────────────────────

export type BusinessType = 'affiliate' | 'ecommerce' | 'local' | 'saas' | 'publisher' | 'agency' | 'blog' | 'travel' | 'lead-gen-b2b' | 'local-seo-services' | 'publisher-news' | 'other';

export interface VaultFrontmatter {
  title: string;
  owner?: string;
  type?: VaultNoteType;
  confidence?: number | 'seed';
  approval_status?: 'draft' | 'review' | 'approved' | 'needs-review';
  rollback_note?: string;
  risk_level?: 'low' | 'medium' | 'high';
  created?: string;
  updated?: string;
  brain_schema?: string;
  tags?: string[];
}

export type VaultNoteType = 'audit' | 'keyword' | 'decision' | 'deliverable' | 'entity' | 'source' | 'review' | 'note' | 'finding' | 'overview' | 'concept' | 'hot' | 'log';

export interface VaultNote {
  frontmatter: VaultFrontmatter;
  body: string;
  path?: string;
  filePath?: string;
  relPath?: string;
  type?: VaultNoteType;
}

export interface VaultNoteMeta {
  path?: string;
  title: string;
  type?: VaultNoteType;
  created: string;
  updated: string;
  confidence?: number | 'seed';
  approval_status?: string;
  tags?: string[];
  relPath?: string;
  summary?: string;
}

export interface VaultIndex {
  clientSlug: string;
  notes: Record<string, VaultNoteMeta>;
  lastIndexed: string;
  schema?: string;
}

export interface EvidenceEntry {
  claim: string;
  source: string;
  confidence: 'high' | 'medium' | 'low' | number;
  verified: boolean;
  tags?: string[];
  verified_at?: string;
  notes?: unknown;
}

export interface EvidenceLedger {
  clientSlug?: string;
  entries: Record<string, EvidenceEntry>;
  updated?: string;
  lastUpdated?: string;
}

export interface ReadinessCheck {
  name?: string;
  check?: string;
  passed?: boolean;
  detail?: string;
  phase?: string;
  status?: 'pass' | 'warn' | 'fail';
  checks?: Array<{ name?: string; status: 'pass' | 'warn' | 'fail'; detail?: string }>;
}