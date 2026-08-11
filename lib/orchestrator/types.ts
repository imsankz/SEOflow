/**
 * Assignment types — track per-step state through the pipeline lifecycle.
 *
 * Ported from SEO Office's assignment.ts pattern.
 */
export type AssignmentStatus = 'proposed' | 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';

export interface Assignment {
  /** ULID-style unique ID */
  id: string;
  /** Post slug */
  slug: string;
  /** Pipeline step ID */
  stepId: string;
  /** Current status */
  status: AssignmentStatus;
  /** Human-readable step name */
  stepName: string;
  /** Proposed timestamp */
  proposedAt: string;
  /** Started at */
  startedAt?: string;
  /** Finished at */
  finishedAt?: string;
  /** Error message if failed */
  error?: string;
  /** Number of changes made */
  changeCount?: number;
  /** Change descriptions */
  changes?: string[];
  /** Output data from the step */
  data?: Record<string, unknown>;
}

/**
 * Orchestrator types — step definitions, phase gates, and pipeline state.
 */
export type Phase = 'intake' | 'diagnostic' | 'discovery' | 'synthesis' | 'final';

export interface StepDefinition {
  /** Unique step ID (kebab-case) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Which phase this step belongs to */
  phase: Phase;
  /** Dependencies — step IDs that must succeed before this runs */
  dependsOn: string[];
  /** Required integrations — if missing, step is skipped */
  requiresIntegrations: string[];
}

/**
 * Full pipeline state for a single post or the whole site.
 */
export interface PipelineState {
  /** Site-scoped pipeline version */
  version: number;
  /** When this pipeline state was last updated */
  lastUpdated: string;
  /** All assignments (past + proposed) */
  assignments: Assignment[];
  /** Current phase */
  currentPhase: Phase;
  /** Overall pipeline status */
  status: 'idle' | 'running' | 'completed' | 'failed';
  /** Error message if pipeline failed */
  error?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

let _idCounter = 0;
/** Generate a simple unique ID */
export function generateId(): string {
  _idCounter++;
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${ts}-${rand}-${_idCounter}`;
}

/** All pipeline steps in dependency order */
export const ALL_STEPS: StepDefinition[] = [
  // Intake
  { id: 'keyword-research', name: 'Keyword Research', phase: 'intake', dependsOn: [], requiresIntegrations: ['ubersuggest', 'semrush', 'ahrefs'] },
  { id: 'fix-frontmatter', name: 'Fix Frontmatter', phase: 'intake', dependsOn: ['keyword-research'], requiresIntegrations: [] },

  // Diagnostic
  { id: 'inject-links', name: 'Internal Links', phase: 'diagnostic', dependsOn: ['fix-frontmatter'], requiresIntegrations: [] },
  { id: 'inject-affiliates', name: 'Affiliate Links', phase: 'diagnostic', dependsOn: ['fix-frontmatter'], requiresIntegrations: [] },
  { id: 'inject-images', name: 'Image Injection', phase: 'diagnostic', dependsOn: ['fix-frontmatter'], requiresIntegrations: ['pexels', 'unsplash'] },
  { id: 'neuron-analysis', name: 'NeuronWriter NLP', phase: 'diagnostic', dependsOn: [], requiresIntegrations: ['neuronwriter'] },

  // Discovery
  { id: 'content-audit', name: 'Content Audit (AI)', phase: 'discovery', dependsOn: ['neuron-analysis'], requiresIntegrations: ['gemini', 'openrouter', 'anthropic'] },
  { id: 'seo-review', name: 'SEO Review', phase: 'discovery', dependsOn: ['content-audit'], requiresIntegrations: ['gemini', 'openrouter', 'anthropic'] },

  // Synthesis
  { id: 'schema-validation', name: 'Schema Validation', phase: 'synthesis', dependsOn: ['fix-frontmatter'], requiresIntegrations: [] },
  { id: 'quality-audit', name: 'Content Quality Audit', phase: 'synthesis', dependsOn: ['seo-review'], requiresIntegrations: ['gemini', 'openrouter', 'anthropic'] },
  { id: 'technical-audit', name: 'Technical SEO Audit', phase: 'synthesis', dependsOn: [], requiresIntegrations: [] },
  { id: 'fact-check', name: 'Fact Check', phase: 'synthesis', dependsOn: ['content-audit'], requiresIntegrations: ['gemini', 'openrouter', 'anthropic'] },

  // Final
  { id: 'reciprocal-links', name: 'Reciprocal Internal Links', phase: 'final', dependsOn: ['fix-frontmatter'], requiresIntegrations: [] },
  { id: 'report-export', name: 'Report Export', phase: 'final', dependsOn: ['schema-validation', 'quality-audit', 'technical-audit', 'fact-check'], requiresIntegrations: [] },
  { id: 'citations', name: 'AI Citation Probe', phase: 'final', dependsOn: [], requiresIntegrations: ['citations-probe'] },
];