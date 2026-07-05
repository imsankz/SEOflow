/**
 * Ahrefs API client for keyword research.
 *
 * Uses Ahrefs API v3 keywords-explorer endpoints directly via HTTP.
 * Requires AHREFS_API_KEY in env (passed as `Authorization: Bearer TOKEN`).
 * Falls back gracefully if not set.
 *
 * API docs: https://docs.ahrefs.com/
 * Endpoints used:
 *   GET /v3/keywords-explorer/overview  — keyword metrics
 *   GET /v3/keywords-explorer/matching-terms — keyword ideas
 */

export interface AhrefsKeywordResult {
  keyword: string;
  searchVolume: number;
  difficulty: number;
  cpc: number;
  competition: number;
  traffic: number;
  globalVolume: number;
}

export interface AhrefsResearchResult {
  focusKeyword: string;
  searchVolume: number;
  difficulty: number;
  relatedKeywords: AhrefsKeywordResult[];
  source: 'ahrefs' | 'fallback';
}

const AHREFS_BASE = 'https://api.ahrefs.com/v3';

/**
 * Default country code for API queries. Override with AHREFS_COUNTRY env var.
 */
function getCountry(): string {
  return process.env.AHREFS_COUNTRY || process.env.SEOFLOW_COUNTRY || 'us';
}

/**
 * Parse a raw Ahrefs keyword value (may be null/integer) into AhrefsKeywordResult.
 */
function parseAhrefsKeyword(kw: Record<string, any>): AhrefsKeywordResult {
  return {
    keyword:       String(kw.keyword || ''),
    searchVolume:  Number(kw.volume ?? 0),
    difficulty:    Number(kw.difficulty ?? 0),
    cpc:           Number(kw.cpc ?? 0),
    competition:   0,                            // not directly returned by Ahrefs
    traffic:       Number(kw.clicks ?? 0),
    globalVolume:  Number(kw.volume ?? 0),
  };
}

export class AhrefsClient {
  /**
   * Check if Ahrefs API key is available
   */
  static hasKey(): boolean {
    return !!process.env.AHREFS_API_KEY;
  }

  /**
   * Research keywords using Ahrefs v3 API.
   * Fetches metrics for the seed + matching terms for related keywords.
   */
  static async researchKeywords(seed: string, context: string = ''): Promise<AhrefsResearchResult> {
    if (!this.hasKey()) {
      return this.fallbackResearch(seed);
    }

    try {
      const token = process.env.AHREFS_API_KEY;
      const country = getCountry();
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      };

      // 1. Get keyword metrics
      const overviewUrl = new URL(`${AHREFS_BASE}/keywords-explorer/overview`);
      const params = overviewUrl.searchParams;
      params.set('keywords', seed);
      params.set('country', country);
      params.set('select', 'keyword,volume,difficulty,cpc,clicks,cps');
      params.set('output', 'json');

      const overviewResp = await fetch(overviewUrl.toString(), { headers });

      if (!overviewResp.ok) {
        const text = await overviewResp.text().catch(() => '');
        console.error(`Ahrefs overview failed: ${overviewResp.status} ${overviewResp.statusText}`, text.slice(0, 200));
        return this.fallbackResearch(seed);
      }

      const overview = await overviewResp.json() as any;
      const seedData = overview.keywords?.[0] ?? {};

      // 2. Get related keyword ideas
      const matchingUrl = new URL(`${AHREFS_BASE}/keywords-explorer/matching-terms`);
      const mParams = matchingUrl.searchParams;
      mParams.set('keyword', seed);
      mParams.set('country', country);
      mParams.set('select', 'keyword,volume,difficulty,cpc,clicks,cps');
      mParams.set('limit', '10');
      mParams.set('output', 'json');

      const matchingResp = await fetch(matchingUrl.toString(), { headers });

      let relatedKeywords: AhrefsKeywordResult[] = [];
      if (matchingResp.ok) {
        const matching = await matchingResp.json() as any;
        if (Array.isArray(matching.keywords)) {
          relatedKeywords = matching.keywords
            .filter((k: any) => k.keyword && k.keyword !== seed)
            .slice(0, 10)
            .map((k: any) => parseAhrefsKeyword(k));
        }
      } else {
        // If matching-terms fails (may not be eligible on all plans),
        // log and continue with empty related keywords (graceful degradation).
        console.error(`Ahrefs matching-terms failed: ${matchingResp.status} — continuing without related keywords`);
      }

      return {
        focusKeyword: String(seedData.keyword ?? seed),
        searchVolume: Number(seedData.volume ?? 0),
        difficulty: Number(seedData.difficulty ?? 0),
        relatedKeywords,
        source: 'ahrefs',
      };
    } catch (error: any) {
      console.error('Ahrefs research error:', error?.message);
      return this.fallbackResearch(seed);
    }
  }

  /**
   * Fallback research using basic keyword extraction
   */
  private static fallbackResearch(seed: string): AhrefsResearchResult {
    return {
      focusKeyword: seed,
      searchVolume: 0,
      difficulty: 0,
      relatedKeywords: [],
      source: 'fallback',
    };
  }
}

/**
 * Helper function for keyword research
 */
export async function researchKeywords(
  seed: string,
  context: string = ''
): Promise<AhrefsResearchResult> {
  return AhrefsClient.researchKeywords(seed, context);
}