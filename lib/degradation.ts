/**
 * Integration degradation — graceful fallbacks for missing API keys.
 *
 * Each integration step checks whether its required API key / tool is available.
 * If unavailable, the step is skipped with a clear explanation rather than
 * crashing the pipeline.
 *
 * Ported from SEO Office's integration-readiness pattern.
 */

export type IntegrationId =
  | 'gemini'
  | 'openrouter'
  | 'anthropic'
  | 'neuronwriter'
  | 'pexels'
  | 'unsplash'
  | 'semrush'
  | 'ahrefs'
  | 'ubersuggest'
  | 'gsc-live'
  | 'gsc-csv'
  | 'citations-probe';

export interface IntegrationStatus {
  id: IntegrationId;
  name: string;
  available: boolean;
  reason?: string;
}

// ─── Checks ───────────────────────────────────────────────────────────────────

function envExists(key: string): boolean {
  return !!process.env[key];
}

function mcpAvailable(name: string): boolean {
  // Check if MCP tool is available by looking for env hints
  // Ubersuggest MCP is always assumed available if we're in a session with it
  return true;
}

const CHECKS: Record<IntegrationId, { name: string; check: () => IntegrationStatus }> = {
  gemini: {
    name: 'Gemini AI (Google)',
    check: () => ({
      id: 'gemini',
      name: 'Gemini AI (Google)',
      available: envExists('GEMINI_API_KEY'),
      reason: envExists('GEMINI_API_KEY') ? undefined : 'GEMINI_API_KEY not set',
    }),
  },
  openrouter: {
    name: 'OpenRouter (300+ models)',
    check: () => ({
      id: 'openrouter',
      name: 'OpenRouter (300+ models)',
      available: envExists('OPENROUTER_API_KEY'),
      reason: envExists('OPENROUTER_API_KEY') ? undefined : 'OPENROUTER_API_KEY not set',
    }),
  },
  anthropic: {
    name: 'Anthropic Claude',
    check: () => ({
      id: 'anthropic',
      name: 'Anthropic Claude',
      available: envExists('ANTHROPIC_API_KEY'),
      reason: envExists('ANTHROPIC_API_KEY') ? undefined : 'ANTHROPIC_API_KEY not set',
    }),
  },
  neuronwriter: {
    name: 'NeuronWriter NLP',
    check: () => ({
      id: 'neuronwriter',
      name: 'NeuronWriter NLP',
      available: envExists('NEURONWRITER_API_KEY') && envExists('NEURONWRITER_PROJECT_ID'),
      reason: !envExists('NEURONWRITER_API_KEY') ? 'NEURONWRITER_API_KEY not set'
        : !envExists('NEURONWRITER_PROJECT_ID') ? 'NEURONWRITER_PROJECT_ID not set'
        : undefined,
    }),
  },
  pexels: {
    name: 'Pexels Images',
    check: () => ({
      id: 'pexels',
      name: 'Pexels Images',
      available: envExists('PEXELS_API_KEY'),
      reason: envExists('PEXELS_API_KEY') ? undefined : 'PEXELS_API_KEY not set',
    }),
  },
  unsplash: {
    name: 'Unsplash Images',
    check: () => ({
      id: 'unsplash',
      name: 'Unsplash Images',
      available: envExists('UNSPLASH_API_KEY'),
      reason: envExists('UNSPLASH_API_KEY') ? undefined : 'UNSPLASH_API_KEY not set',
    }),
  },
  semrush: {
    name: 'SEMrush Keywords',
    check: () => ({
      id: 'semrush',
      name: 'SEMrush Keywords',
      available: envExists('SEMRUSH_API_KEY'),
      reason: envExists('SEMRUSH_API_KEY') ? undefined : 'SEMRUSH_API_KEY not set',
    }),
  },
  ahrefs: {
    name: 'Ahrefs Keywords',
    check: () => ({
      id: 'ahrefs',
      name: 'Ahrefs Keywords',
      available: envExists('AHREFS_API_KEY'),
      reason: envExists('AHREFS_API_KEY') ? undefined : 'AHREFS_API_KEY not set',
    }),
  },
  ubersuggest: {
    name: 'Ubersuggest Keywords (MCP)',
    check: () => ({
      id: 'ubersuggest',
      name: 'Ubersuggest Keywords (MCP)',
      available: mcpAvailable('ubersuggest'),
      reason: undefined,
    }),
  },
  'gsc-live': {
    name: 'Google Search Console (live)',
    check: () => ({
      id: 'gsc-live',
      name: 'Google Search Console (live)',
      available: envExists('GOOGLE_APPLICATION_CREDENTIALS') || envExists('GSC_SITE_URL'),
      reason: !envExists('GOOGLE_APPLICATION_CREDENTIALS') && !envExists('GSC_SITE_URL')
        ? 'No GSC credentials. Set GOOGLE_APPLICATION_CREDENTIALS or GSC_SITE_URL'
        : undefined,
    }),
  },
  'gsc-csv': {
    name: 'Google Search Console (CSV fallback)',
    check: () => {
      const cfg = process.env.GSC_PAGES_CSV || '';
      return {
        id: 'gsc-csv',
        name: 'Google Search Console (CSV fallback)',
        available: !!cfg || !!process.env.SEOFLOW_GSC_PAGES_CSV,
        reason: undefined,
      };
    },
  },
  'citations-probe': {
    name: 'AI Citation Probe',
    check: () => ({
      id: 'citations-probe',
      name: 'AI Citation Probe',
      available: envExists('OPENROUTER_API_KEY') || envExists('GEMINI_API_KEY'),
      reason: !envExists('OPENROUTER_API_KEY') && !envExists('GEMINI_API_KEY')
        ? 'No AI key — set OPENROUTER_API_KEY or GEMINI_API_KEY'
        : undefined,
    }),
  },
};

/** Check a single integration */
export function checkIntegration(id: IntegrationId): IntegrationStatus {
  const check = CHECKS[id];
  if (!check) {
    return { id, name: id, available: false, reason: `Unknown integration: ${id}` };
  }
  return check.check();
}

/** Check multiple integrations */
export function checkIntegrations(ids: IntegrationId[]): IntegrationStatus[] {
  return ids.map(checkIntegration);
}

/** Check all known integrations */
export function checkAllIntegrations(): IntegrationStatus[] {
  return Object.keys(CHECKS).map((id) => checkIntegration(id as IntegrationId));
}

/** Log integration status to console */
export function logIntegrationStatus(): void {
  const all = checkAllIntegrations();
  const available = all.filter((s) => s.available);
  const missing = all.filter((s) => !s.available);

  console.log('\n   📡 Integrations:');
  for (const s of available) {
    console.log(`      ✅ ${s.name}`);
  }
  for (const s of missing) {
    console.log(`      ⏭  ${s.name} — ${s.reason || 'not configured'}`);
  }

  if (missing.length > 0) {
    console.log('\n   Steps requiring missing integrations will be skipped.');
  }
}

/**
 * Require an integration. Throws with a skip-reason if unavailable.
 * Pipeline steps call this at the top — if it throws, catch and skip.
 */
export function requireIntegration(id: IntegrationId): void {
  const status = checkIntegration(id);
  if (!status.available) {
    throw new SkipStepError(status.reason || `${status.name} not available`);
  }
}

/** Error thrown to skip a pipeline step gracefully */
export class SkipStepError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'SkipStepError';
  }
}