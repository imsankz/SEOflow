/**
 * SEMrush keyword research client — direct HTTP API calls.
 *
 * Uses SEMrush API:
 *   type=phrase_this     — metrics for a single keyword
 *   type=phrase_related  — related keyword ideas
 *
 * Auth: SEMRUSH_API_KEY passed as `key` query param.
 * Response format: semicolon-separated CSV with header row.
 *
 * API key must have sufficient units for keyword lookups.
 */

export interface SEMrushKeywordResult {
  keyword: string;
  searchVolume: number;
  difficulty: number;
  cpc: number;
  competition: number;
}

export interface SEMrushResearchResult {
  focusKeyword: string;
  searchVolume: number;
  difficulty: number;
  relatedKeywords: SEMrushKeywordResult[];
  source: 'semrush' | 'fallback';
}

const SEMRUSH_API = 'https://api.semrush.com/';

/**
 * Default database (region) for SEMrush queries. Override with SEMRUSH_DATABASE env var.
 */
function getDatabase(): string {
  return process.env.SEMRUSH_DATABASE || process.env.SEOFLOW_DATABASE || 'us';
}

/**
 * Parse a SEMrush CSV response (semicolon-separated).
 * Returns an array of row objects keyed by the header row.
 *
 * Example response:
 *   Phrase;Volume;Cpc;Kd;Competition
 *   seo;1000000;1.23;85.5;0.89
 */
function parseSemrushCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(';').map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = line.split(';');
    const obj: Record<string, string> = { _raw: line };
    headers.forEach((h, i) => {
      obj[h] = (values[i] || '').trim();
    });
    return obj;
  });
}

/**
 * Convert a parsed row into the SEMrushKeywordResult interface.
 */
function rowToKeyword(row: Record<string, any>): SEMrushKeywordResult {
  const cleanKd = Number(String(row['Kd'] || '0').replace(/\+$/, '').trim()); // strip trailing +
  return {
    keyword: String(row['Ph'] || row['Phrase'] || ''),
    searchVolume: Number(row['Nq'] || 0),
    difficulty: cleanKd,
    cpc: Number(row['Cp'] || 0),
    competition: Number(row['Co'] || 0),
  };
}

export class SEMrushClient {
  /**
   * Check if SEMrush API key is available
   */
  static hasKey(): boolean {
    return !!process.env.SEMRUSH_API_KEY;
  }

  /**
   * Research keywords using SEMrush API.
   * Fetches metrics for the seed + related keyword ideas.
   */
  static async researchKeywords(
    seed: string,
    context: string = ''
  ): Promise<SEMrushResearchResult> {
    if (!this.hasKey()) {
      return this.fallbackResearch(seed);
    }

    try {
      const key = process.env.SEMRUSH_API_KEY;
      const database = getDatabase();
      const exportColumns = 'Ph,Nq,Cp,Kd,Co';

      // 1. Get keyword metrics
      const overviewParams = new URLSearchParams();
      overviewParams.set('type', 'phrase_this');
      overviewParams.set('key', key);
      overviewParams.set('phrase', seed);
      overviewParams.set('export_columns', exportColumns);
      overviewParams.set('database', database);

      const overviewResp = await fetch(`${SEMRUSH_API}?${overviewParams.toString()}`, {
        headers: { 'Accept': 'text/csv' },
      });

      const overviewText = await overviewResp.text();

      if (overviewText.startsWith('ERROR')) {
        console.error(`SEMrush phrase_this failed: ${overviewText.split('\n')[0]}`);
        return this.fallbackResearch(seed);
      }

      const overviewRows = parseSemrushCsv(overviewText);
      const seedData = overviewRows[0] ? rowToKeyword(overviewRows[0]) : null;

      // 2. Get related keyword ideas (phrase_related)
      const relatedParams = new URLSearchParams();
      relatedParams.set('type', 'phrase_related');
      relatedParams.set('key', key);
      relatedParams.set('phrase', seed);
      relatedParams.set('export_columns', exportColumns);
      relatedParams.set('display_limit', '10');
      relatedParams.set('database', database);

      const relatedResp = await fetch(`${SEMRUSH_API}?${relatedParams.toString()}`, {
        headers: { 'Accept': 'text/csv' },
      });

      const relatedText = await relatedResp.text();

      let relatedKeywords: SEMrushKeywordResult[] = [];
      if (!relatedText.startsWith('ERROR')) {
        const relatedRows = parseSemrushCsv(relatedText);
        relatedKeywords = relatedRows
          .map(rowToKeyword)
          .filter(kw => kw.keyword && kw.keyword !== seed)
          .slice(0, 10);
      } else {
        // Not all plans have access to phrase_related — log and continue.
        console.error(`SEMrush phrase_related failed: ${relatedText.split('\n')[0]}`);
      }

      if (!seedData) {
        return {
          focusKeyword: seed,
          searchVolume: 0,
          difficulty: 0,
          relatedKeywords,
          source: relatedKeywords.length > 0 ? 'semrush' : 'fallback',
        };
      }

      return {
        focusKeyword: seedData.keyword,
        searchVolume: seedData.searchVolume,
        difficulty: seedData.difficulty,
        relatedKeywords,
        source: 'semrush',
      };
    } catch (error: any) {
      console.error('SEMrush research error:', error?.message);
      return this.fallbackResearch(seed);
    }
  }

  /**
   * Fallback research using basic keyword extraction
   */
  private static fallbackResearch(seed: string): SEMrushResearchResult {
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
): Promise<SEMrushResearchResult> {
  return SEMrushClient.researchKeywords(seed, context);
}