/**
 * SeoFlow — Site configuration.
 *
 * Each project provides a seoflow.config.json at the root.
 * This loader reads it and provides typed access to all site-specific values.
 */
import fs from 'fs';
import path from 'path';
import type { BusinessType } from './brain/types';
import { suggestBusinessType } from './business-types/overlays';

export interface SeoFlowConfig {
  siteName: string;
  siteUrl: string;
  author: string;
  authorLocation: string;
  /** Single voice sample string, or per-category map. Optional — omit for non-blog use cases. */
  writingSample?: string;
  /** Per content-type voice samples: { "guide": "...", "review": "...", "itinerary": "..." } */
  writingSamples?: Record<string, string>;
  postsDir: string;
  gscPagesCsv: string;
  gscQueriesCsv: string;
  auditLogPath: string;
  keywordCachePath: string;
  destinationPattern?: string;

  /**
   * Content format adapter: "mdx" | "markdown" | "wordpress"
   * Default: "mdx" — YAML frontmatter + MDX body.
   * "markdown" — same parsing, no JSX-specific patterns.
   * "wordpress" — future: REST API adapter.
   */
  contentFormat?: 'mdx' | 'markdown' | 'wordpress';

  /**
   * Business type for strategy overlays, FLOW framework, and AI prompt tuning.
   * Options: travel, saas, ecommerce, affiliate, lead-gen-b2b, publisher-news,
   * local-seo-services, blog, other (default: auto-detect from contentDomain)
   */
  businessType?: BusinessType;

  /**
   * Default image search context when no tag/category is available.
   * Set to a domain-relevant term (e.g. "travel", "food", "tech").
   * Default: "travel"
   */
  imageSearchFallback?: string;

  /**
   * Default category label used in AI prompts when frontmatter has none.
   * Default: "travel"
   */
  defaultCategory?: string;

  /**
   * Verb/domain for AI prompts — e.g. "travel blog", "food blog", "SaaS product".
   * Injected into step prompts so AI knows the content domain.
   * Default: "blog"
   */
  contentDomain?: string;

  /**
   * URL path prefix where blog posts live (default: "/blog/").
   * Used to strip the prefix when converting page URLs to slugs.
   * Example: "/posts/" for Hugo sites, "/" for root-level blogs.
   */
  blogPrefix?: string;

  /**
   * Number of days to look back when fetching live GSC data (default: 28).
   * GSC has a ~3-day lag; this value adds 3 days automatically.
   */
  gscDays?: number;

  /**
   * AI usage limits — protect against runaway costs in bulk runs.
   */
  aiLimits?: {
    /** Max total AI calls per pipeline run. Default: unlimited. */
    maxCallsPerRun?: number;
    /** Max AI calls per post. Default: 3 (content + review + factcheck). */
    maxCallsPerPost?: number;
    /** Which AI-powered steps to enable. Omit to enable all. */
    enabledSteps?: Array<'keywords' | 'content' | 'review' | 'factcheck'>;
  };

  /**
   * Slug-pattern → priority score map for the publish step.
   * Each entry: { "pattern": "regex or substring", "score": number }
   * Replaces the built-in travel-specific scoring when provided.
   * Example: [{ "pattern": "review", "score": 90 }, { "pattern": "guide", "score": 60 }]
   */
  publishPriority?: Array<{ pattern: string; score: number }>;

  /**
   * Content types for generation.
   * Each key is a type name (e.g. "guide", "review", "article").
   * Defaults to built-in travel types if not provided.
   */
  contentTypes?: Record<string, { schema: string; instructions: string }>;

  tools: Array<{ keywords: string[]; path: string; anchor: string }>;
  bookings: Array<{ keywords: string[]; path: string; anchor: string }>;

  /**
   * Affiliate link triggers — injected by the `inject-affiliates` step.
   * Same shape as `tools`/`bookings`: matched by keyword, max 3-4 per post.
   */
  affiliates?: Array<{ keywords: string[]; url: string; anchor: string; category?: string }>;

  /**
   * Path to a content-gap queue JSON (relative to project root), used by
   * `seoflow generate` when called with no --slug/--country. Expected shape:
   * { aiPrioritised?: Array<{destination,country,type,reason}>,
   *   allGaps: Array<{destination,country,type,priority,suggestedSlug}> }
   * Default: "data/content-gaps.json"
   */
  gapQueuePath?: string;

  /**
   * ImageKit CDN upload — when set, generated/injected images are downloaded
   * from Pexels/Unsplash and re-uploaded to ImageKit instead of hotlinking
   * the source URL. Private key comes from the env var named by privateKeyEnv.
   */
  imageKit?: {
    id: string;
    folder?: string;
    privateKeyEnv?: string;
  };

  /** Content generation settings */
  generation?: {
    defaultSchema: string;
    defaultCategory: string;
    wordCountMin: number;
    wordCountMax: number;
  };

  /** Publishing settings */
  publishing?: {
    gitEmail: string;
    gitName: string;
    branch: string;
    indexnowHost?: string;
    majorCities: string[];
    baseUrl: string;
  };
}

const CONFIG_FILE = 'seoflow.config.json';

let _config: SeoFlowConfig | null = null;

function findRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, CONFIG_FILE))) return dir;
    const p = path.dirname(dir);
    if (p === dir) break;
    dir = p;
  }
  return process.cwd();
}

export function loadConfig(): SeoFlowConfig {
  if (_config) return _config;
  const root = findRoot();
  const p = path.join(root, CONFIG_FILE);
  if (!fs.existsSync(p)) {
    throw new Error(`No ${CONFIG_FILE} found. Run \`npx seoflow init\` first.`);
  }
  let raw: SeoFlowConfig;
  try {
    raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error(`Invalid JSON in ${CONFIG_FILE}: ${e instanceof Error ? e.message : e}`);
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error(`${CONFIG_FILE} must be a JSON object.`);
  }
  const r = (s: string) => path.resolve(root, s);
  _config = {
    ...raw,
    postsDir: r(raw.postsDir),
    gscPagesCsv: r(raw.gscPagesCsv),
    gscQueriesCsv: r(raw.gscQueriesCsv),
    auditLogPath: r(raw.auditLogPath),
    keywordCachePath: r(raw.keywordCachePath),
    gapQueuePath: raw.gapQueuePath ? r(raw.gapQueuePath) : path.resolve(root, 'data/content-gaps.json'),
  };
  return _config;
}

export function getPostsDir() { return loadConfig().postsDir; }
export function getAuditLogPath() { return loadConfig().auditLogPath; }
export function getKeywordCachePath() { return loadConfig().keywordCachePath; }
export function getSiteUrl() { return loadConfig().siteUrl; }
export function getSiteAuthor() { return loadConfig().author; }
export function getToolTriggers() { return loadConfig().tools; }
export function getBookingTriggers() { return loadConfig().bookings; }
export function getAffiliateTriggers() { return loadConfig().affiliates || []; }
export function getGapQueuePath() { return loadConfig().gapQueuePath!; }
export function getImageKitConfig() { return loadConfig().imageKit || null; }

/**
 * Get the most relevant writing sample for a given content type.
 * Falls back: writingSamples[type] → writingSamples.default → writingSample → undefined.
 */
export function getWritingSample(contentType?: string): string | undefined {
  const c = loadConfig();
  if (c.writingSamples && contentType && c.writingSamples[contentType]) {
    return c.writingSamples[contentType];
  }
  if (c.writingSamples?.default) return c.writingSamples.default;
  return c.writingSample;
}

export function getContentDomain(): string {
  return loadConfig().contentDomain || 'blog';
}

/** Get the configured business type, or auto-detect from contentDomain */
export function getBusinessType(): BusinessType {
  const cfg = loadConfig();
  if (cfg.businessType) return cfg.businessType;
  return suggestBusinessType(getContentDomain());
}

/** Get a usable client slug from site config */
export function getClientSlug(): string {
  return loadConfig().siteName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export function getImageSearchFallback(): string {
  return loadConfig().imageSearchFallback || 'travel';
}

export function getDefaultCategory(): string {
  return loadConfig().defaultCategory || loadConfig().generation?.defaultCategory || 'travel';
}

/**
 * Default content types (travel-focused). Users can override via config.
 */
export const DEFAULT_CONTENT_TYPES: Record<string, { schema: string; instructions: string }> = {
  'guide': {
    schema: 'TravelGuide',
    instructions: `Write a comprehensive travel guide. Include practical tips, transportation options, best time to visit, where to stay (budget/mid-range/splurge), and local customs. Use first-person where relevant ("I found that...", "In my experience..."). Include specific prices, transit times, and real details.`,
  },
  'itinerary': {
    schema: 'Itinerary',
    instructions: `Write a day-by-day itinerary. Include specific timings, meal recommendations, transit between stops, and practical tips for each day. Start with a "Quick Summary" box highlighting the itinerary at a glance. Include a budget breakdown section.`,
  },
  'city-itinerary-3d': {
    schema: 'Itinerary',
    instructions: `Write a 3-day city itinerary. Follow this exact H2 structure: Why {destination} Is Worth 3 Days -> Getting to {destination} (train/flight/bus + prices) -> Getting Around {destination} (transport options + day pass cost) -> Where to Stay in {destination} (3 budget tiers + neighbourhood names) -> Day 1: [Theme] (hour-by-hour, entry prices, opening hours) -> Day 2: [Theme] -> Day 3: [Theme] -> Best Restaurants in {destination} (5-6 picks, dish + price range) -> {destination} Budget Breakdown (table: budget/mid/comfort daily cost) -> Best Time to Visit -> Practical Tips -> FAQs (5-6 questions). Open with a 2-sentence quick-summary of what's realistically doable in 3 days, the top 3 highlights, and the best base neighbourhood.`,
  },
  'city-itinerary-week': {
    schema: 'Itinerary',
    instructions: `Write a 1-week city/region itinerary. Same structure as a 3-day itinerary but with Day 1 through Day 7 (or day-by-day sub-regions for multi-stop trips), plus a day-trip options section. Include a budget breakdown table and a "how to adjust if you only have X days" note.`,
  },
  'things-to-do': {
    schema: 'TravelGuide',
    instructions: `Write a things-to-do guide with categorized attractions. Structure: overview comparison table -> numbered attraction entries (1 through 10-15, each with hours, ticket price, how to get there, honest note on whether it's worth it) -> Free Things to Do -> Day Trips from {destination} -> Practical Tips -> FAQs. Group remaining entries by category (museums, outdoor, free) or by neighbourhood when the list is long.`,
  },
  'city-pass-review': {
    schema: 'Review',
    instructions: `Write an honest review of the city pass. Open with a 2-sentence verdict: who should buy it, who shouldn't. Then: What's Included (full list + individual attraction prices) -> Pass Prices table (with affiliate booking link) -> Is It Worth It? My Calculation (cost comparison table: pass price vs sum of individual tickets for a realistic itinerary) -> How to Use the Pass -> What's NOT Included (gotchas) -> Alternatives to the Pass -> FAQs. Never inflate the verdict — if the pass only pays off for specific itineraries, say so explicitly.`,
  },
  'where-to-stay': {
    schema: 'TravelGuide',
    instructions: `Write a where-to-stay guide. Structure: neighbourhood overview -> Best Neighbourhoods table (name | vibe | price range | best for) -> Best for First-Timers (hotels at 3 price tiers) -> Best for Budget Travellers -> Best for Families -> Booking Tips (when to book, which platforms) -> FAQs. Name real neighbourhoods, not generic "downtown"/"city centre".`,
  },
  'best-restaurants': {
    schema: 'TravelGuide',
    instructions: `Write a best-restaurants guide. 8-12 picks grouped by cuisine or price tier, each with: dish to order, price range, neighbourhood, and one specific detail that proves you'd actually recommend it (not generic "cozy atmosphere" praise). Include a local-food-terms glossary if the cuisine has unfamiliar dishes. Close with practical tips (reservations, tipping norms, meal times) and FAQs.`,
  },
  'day-trips': {
    schema: 'TravelGuide',
    instructions: `Write a day-trips-from-{destination} guide. 5-8 destinations, each with: travel time + cost from {destination}, what to do in a single day there, and whether it needs a full day or can be combined with another stop. Include a comparison table (destination | travel time | cost | best for) up top. Close with practical tips (booking trains in advance, luggage storage) and FAQs.`,
  },
  'budget-guide': {
    schema: 'TravelGuide',
    instructions: `Write a {destination}-on-a-budget guide. Structure: realistic daily budget table (budget/mid/comfort tiers, broken into accommodation/food/transport/activities) -> money-saving tips per category -> free/cheap things to do -> how prices compare to nearby destinations -> FAQs. Every claim needs a EUR number attached.`,
  },
  'country-guide': {
    schema: 'TravelGuide',
    instructions: `Write a country-level travel guide. Structure: overview + when to visit -> getting in (major airports/border crossings) -> getting around (trains/buses/car, with a country rail-pass note if relevant) -> top regions/cities to include in an itinerary (link out to per-city guides) -> money + costs -> practical tips (language, tipping, safety) -> FAQs.`,
  },
  'country-itinerary': {
    schema: 'Itinerary',
    instructions: `Write a country-level multi-city itinerary (typically 1-2 weeks). Structure as a route: stop-by-stop with nights-per-stop, inter-city transport (time + price), and a day-by-day breakdown per stop. Include a budget breakdown and an "if you only have X days, cut these stops" note.`,
  },
  'transportation': {
    schema: 'TravelGuide',
    instructions: `Write a transportation/getting-around guide. Cover every mode relevant to the destination (metro/tram/bus/train/taxi/rideshare/bike), each with: cost, how to buy tickets, coverage area, and when it's the right choice vs the alternatives. Include a day-pass vs single-ticket cost comparison and an airport-to-city-centre section.`,
  },
  'getting-around': {
    schema: 'TravelGuide',
    instructions: `Same as transportation: cover every mode relevant to the destination, cost, ticket-buying process, coverage, and when each is the right choice. Include a day-pass vs single-ticket comparison.`,
  },
  'article': {
    schema: 'Article',
    instructions: `Write an informative article. Use first-person perspective where relevant. Include specific examples, data points, and practical takeaways. Structure with clear H2 sections.`,
  },
};

export function getContentTypes(): Record<string, { schema: string; instructions: string }> {
  return loadConfig().contentTypes || DEFAULT_CONTENT_TYPES;
}

export function getAiContext() {
  const c = loadConfig();
  return {
    siteName: c.siteName,
    siteUrl: c.siteUrl,
    author: c.author,
    authorLocation: c.authorLocation,
    writingSample: c.writingSample,
    contentDomain: c.contentDomain || 'blog',
  };
}

/**
 * Programmatic config — for library/API usage and testing.
 * Call before any other seoflow functions when not using seoflow.config.json.
 */
export function configure(config: SeoFlowConfig): void {
  _config = config;
}

/**
 * Reset config cache — useful in tests with multiple configs.
 */
export function resetConfig(): void {
  _config = null;
}
