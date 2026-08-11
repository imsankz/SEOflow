/**
 * AI Citation Tracker — config resolution.
 *
 * Turns the optional `citations` block in seoflow.config.json into a fully
 * resolved config with defaults, so the feature works with ZERO config changes
 * on a site that only adds a .env.local with GEMINI_API_KEY / OPENROUTER_API_KEY.
 *
 * Model IDs and prompt packs come from the research handoff (t_cc28dbec,
 * research-report.md) and were verified live on 2026-08-11.
 */
import path from 'node:path';
import { loadConfig, getAuditLogPath, type CitationBrand, type CitationsConfig } from '../config';
import type { ProbeProvider } from './types';

// ─── Verified model IDs (research-report.md §1.1) ─────────────────────────────

/** Brand-representative (paid, ~$0.0002–0.001 per probe) model IDs via OpenRouter. */
export const DEFAULT_MODELS: Record<CitationBrand, string> = {
  chatgpt: 'openai/gpt-4o-mini',
  gemini: 'google/gemini-2.5-flash-lite',
  perplexity: 'perplexity/sonar',
};

/** :free open-weights stand-ins (NOT the real brand products — only used when freeOnly: true). */
export const FREE_MODELS: Record<CitationBrand, string> = {
  chatgpt: 'openai/gpt-oss-20b:free',
  gemini: 'google/gemma-4-31b-it:free',
  // Perplexity has no :free model — that brand degrades to skipped-key.
  perplexity: '',
};

/**
 * Gemini direct-API model. Verified live 2026-08-11: gemini-2.5-flash-lite 404s
 * on the direct API ("no longer available to new users"); gemini-3.5-flash-lite
 * returns HTTP 200.
 */
export const GEMINI_DIRECT_MODEL = 'gemini-3.5-flash-lite';

/** USD per 1M tokens. Keys are modelId suffixes matched by substring. */
export const MODEL_PRICES: Array<{ match: string; prompt: number; completion: number }> = [
  { match: 'gpt-4o-mini', prompt: 0.15, completion: 0.60 },
  { match: 'gpt-4.1-nano', prompt: 0.10, completion: 0.40 },
  { match: 'gpt-oss-20b:free', prompt: 0, completion: 0 },
  { match: 'gemini-2.5-flash-lite', prompt: 0.10, completion: 0.40 },
  { match: 'gemini-2.5-flash', prompt: 0.30, completion: 2.50 },
  { match: 'gemini-3.5-flash-lite', prompt: 0.10, completion: 0.40 },
  { match: 'gemma-4-31b-it:free', prompt: 0, completion: 0 },
  { match: 'sonar-pro-search', prompt: 3.00, completion: 15.00 },
  { match: 'sonar-deep-research', prompt: 2.00, completion: 8.00 },
  { match: 'sonar', prompt: 1.00, completion: 1.00 },
];

/** Fallback pricing for unknown model IDs (close to gpt-4o-mini; documented estimate). */
const FALLBACK_PRICE = { prompt: 0.15, completion: 0.60 };

/** Estimate USD cost from token usage. */
export function estimateCostUsd(modelId: string, promptTokens: number, completionTokens: number): number {
  const p = MODEL_PRICES.find((e) => modelId.includes(e.match)) ?? FALLBACK_PRICE;
  return (promptTokens / 1_000_000) * p.prompt + (completionTokens / 1_000_000) * p.completion;
}

// ─── Default buyer prompt packs (research-report.md §2) ───────────────────────

export interface TopicPack {
  name: string;
  prompts: string[];
}

/** Per-site default packs, keyed by bare domain (no protocol/www). */
const SITE_TOPIC_PACKS: Record<string, TopicPack[]> = {
  'chasingwhereabouts.com': [
    {
      name: 'berlin-winter',
      prompts: [
        'Best things to do in Berlin in winter for first-time visitors?',
        'Is Berlin worth visiting in winter? What indoor attractions should I plan around?',
        'What are the best day trips from Berlin in winter?',
        'How many days do you need in Berlin - is 3 days enough?',
      ],
    },
    {
      name: 'prague-planning',
      prompts: [
        'How many days do you need in Prague?',
        'Is a 3-day Prague itinerary enough to see the main sights?',
        'Does Prague use euros or the Czech crown - how should I pay?',
        'What are the best walking tours in Prague?',
      ],
    },
    {
      name: 'city-passes',
      prompts: [
        'Is the Berlin Pass worth it vs the Berlin WelcomeCard?',
        'Is the Prague Pass worth it? What does it include?',
        'Which European city pass is actually worth buying?',
      ],
    },
    {
      name: 'italy-itineraries',
      prompts: [
        'How many days do you need in Rome - is 3 days enough?',
        'Is Venice worth visiting in winter?',
        'How many days do you need in Venice?',
        'Best 10-day Spain itinerary by train?',
      ],
    },
  ],
  'thevenicepass.com': [
    {
      name: 'pass-worth',
      prompts: [
        'Is the Venice Pass worth it?',
        'Is the Venice All-Inclusive Pass worth it? What is included?',
        'Venice Explorer Pass vs Flex Pass vs Mega Pass - which is best?',
        'Are there working Venice Pass discount codes?',
      ],
    },
    {
      name: 'tickets-lines',
      prompts: [
        'How do I skip the lines at St Mark Basilica?',
        'Do you need to book Doges Palace tickets in advance?',
        'Venice museum pass vs single tickets - which is cheaper?',
        'How do I skip the line at the Doges Palace without a tour?',
      ],
    },
    {
      name: 'itineraries',
      prompts: [
        'Is 3 days in Venice enough - what is the best 3-day Venice itinerary?',
        'Can you do Venice in one day? Best 1-day itinerary?',
        'What is the best 2-day Venice itinerary?',
      ],
    },
    {
      name: 'venice-practical',
      prompts: [
        'Is the Venice vaporetto pass worth it? How much is the water bus?',
        'What is the dress code for St Mark Basilica?',
        'When is the best time to visit Venice?',
        'How much does a gondola ride cost in Venice?',
      ],
    },
  ],
};

/** Generic fallback pack for sites without a baked-in pack. */
const GENERIC_TOPIC_PACK: TopicPack[] = [
  {
    name: 'planning',
    prompts: [
      'How many days do you need to see the main sights?',
      'Is it worth buying a city pass for a first-time visit?',
      'What is the best way to get around on a budget?',
      'What are the top things to do for first-time visitors?',
    ],
  },
];

/** Normalize siteUrl → bare domain used as the pack key. */
function bareDomain(siteUrl: string): string {
  return siteUrl
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

/** Default topic pack for a site URL (falls back to the generic pack). */
export function defaultTopicPack(siteUrl: string): TopicPack[] {
  return SITE_TOPIC_PACKS[bareDomain(siteUrl)] ?? GENERIC_TOPIC_PACK;
}

// ─── Resolved config ──────────────────────────────────────────────────────────

export interface ResolvedCitationsConfig {
  enabled: boolean;
  models: Record<CitationBrand, string>;
  geminiDirectModel: string;
  freeOnly: boolean;
  perRunCap: number;
  maxAnswerTokens: number;
  windowRuns: number;
  detection: { includeAuthor: boolean; brandNameRequiresCapital: boolean; maxMatchesPerProbe: number };
  topics: TopicPack[];
}

const DEFAULTS: ResolvedCitationsConfig = {
  enabled: true,
  models: { ...DEFAULT_MODELS },
  geminiDirectModel: GEMINI_DIRECT_MODEL,
  freeOnly: false,
  perRunCap: 30,
  maxAnswerTokens: 400,
  windowRuns: 30,
  detection: { includeAuthor: false, brandNameRequiresCapital: true, maxMatchesPerProbe: 10 },
  topics: [],
};

/** Build the resolved citations config from a (possibly partial) config object. */
export function resolveCitationsConfig(cfg: CitationsConfig | undefined): ResolvedCitationsConfig {
  const d = DEFAULTS;
  const models = { ...d.models, ...(cfg?.models ?? {}) } as Record<CitationBrand, string>;
  return {
    enabled: cfg?.enabled ?? d.enabled,
    models,
    geminiDirectModel: cfg?.models?.geminiDirect ?? d.geminiDirectModel,
    freeOnly: cfg?.freeOnly ?? d.freeOnly,
    perRunCap: cfg?.perRunCap ?? d.perRunCap,
    maxAnswerTokens: cfg?.maxAnswerTokens ?? d.maxAnswerTokens,
    windowRuns: cfg?.windowRuns ?? d.windowRuns,
    detection: {
      includeAuthor: cfg?.detection?.includeAuthor ?? d.detection.includeAuthor,
      brandNameRequiresCapital: cfg?.detection?.brandNameRequiresCapital ?? d.detection.brandNameRequiresCapital,
      maxMatchesPerProbe: cfg?.detection?.maxMatchesPerProbe ?? d.detection.maxMatchesPerProbe,
    },
    // Absent topics → per-site default pack (zero-config operation).
    topics: cfg?.topics && cfg.topics.length > 0 ? cfg.topics : defaultTopicPack(loadConfig().siteUrl),
  };
}

/** Paths for history + SOV JSON, following the audit-log data-dir convention. */
export function getCitationsPaths(): { historyPath: string; sovPath: string } {
  const dataDir = path.dirname(getAuditLogPath());
  const historyPath = loadConfig().citations?.historyPath
    ? path.resolve(loadConfig().citations!.historyPath!)
    : path.join(dataDir, 'citations-history.json');
  return {
    historyPath,
    sovPath: path.join(dataDir, 'citations-sov.json'),
  };
}

/** Provider route decision for one brand probe. */
export interface BrandRoute {
  provider: ProbeProvider;
  modelId: string;
  /** null when the brand can be probed; otherwise skip reason (skipped-key). */
  skipReason: string | null;
}

/**
 * Decide how to probe each brand given the available keys.
 * Research rules (§5.1): OPENROUTER_API_KEY → all 3 brands via OpenRouter;
 * only GEMINI_API_KEY → gemini via direct API, others skipped-key;
 * freeOnly → :free models via OpenRouter (perplexity always skipped-key).
 */
export function routeForBrand(brand: CitationBrand, resolved: ResolvedCitationsConfig): BrandRoute {
  const hasOr = !!process.env.OPENROUTER_API_KEY;
  const hasGemini = !!process.env.GEMINI_API_KEY;

  if (resolved.freeOnly) {
    if (!hasOr) {
      return { provider: 'none', modelId: FREE_MODELS[brand] || 'n/a', skipReason: 'freeOnly requires OPENROUTER_API_KEY' };
    }
    if (!FREE_MODELS[brand]) {
      return { provider: 'none', modelId: 'n/a', skipReason: 'no free model for brand' };
    }
    return { provider: 'openrouter', modelId: FREE_MODELS[brand], skipReason: null };
  }

  if (hasOr) {
    return { provider: 'openrouter', modelId: resolved.models[brand], skipReason: null };
  }

  if (hasGemini && brand === 'gemini') {
    return { provider: 'gemini-direct', modelId: resolved.geminiDirectModel, skipReason: null };
  }

  return { provider: 'none', modelId: resolved.models[brand], skipReason: 'no OPENROUTER_API_KEY' };
}
