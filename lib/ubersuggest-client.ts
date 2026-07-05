/**
 * Ubersuggest keyword research client.
 *
 * The Ubersuggest MCP server uses OAuth 2.0 — it's accessible from within
 * an AI session (Claude Code) that's configured with the OAuth flow in
 * .mcp.json. A standalone tsx script can't hold the OAuth session.
 *
 * Instead, this client:
 * 1. Checks `data/keyword-research-cache.json` for pre-fetched results
 * 2. If no cache, prints the MCP command the user should run in their
 *    Claude Code session, then saves the result to the cache
 *
 * Workflow:
 *   npm run seo:keywords -- --slug <post>  → shows MCP command to run
 *   [run command in Claude session]
 *   npm run seo:keywords -- --slug <post>  → picks up cached result
 */
import fs from 'fs';
import path from 'path';
import type { KeywordResearchResult } from './types';
import { loadConfig } from './config';
import { selectProvider } from './providers';

export interface CachedResearch {
  slug: string;
  seed: string;
  result: KeywordResearchResult;
  cachedAt: string;
}

function cachePath(): string {
  return loadConfig().keywordCachePath;
}

function loadCache(): CachedResearch[] {
  try {
    const p = cachePath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch {}
  return [];
}

function saveCache(cache: CachedResearch[]): void {
  fs.writeFileSync(cachePath(), JSON.stringify(cache, null, 2));
}

function findRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'seoflow.config.json'))) return dir;
    const p = path.dirname(dir);
    if (p === dir) break;
    dir = p;
  }
  return process.cwd();
}

const ROOT = findRoot();

/**
 * Check if the Ubersuggest MCP is available by looking at .mcp.json config.
 */
export function isMcpConfigured(): boolean {
  try {
    const mcpPath = path.join(ROOT, '.mcp.json');
    if (!fs.existsSync(mcpPath)) return false;
    const config = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
    return !!(config?.mcpServers?.ubersuggest?.url);
  } catch {
    return false;
  }
}

/**
 * Perform keyword research.
 *
 * Tries cache first. If not cached, prints the MCP command and returns
 * an unavailable result — the user runs it in their Claude session
 * and the next pipeline run picks it up.
 */
export async function researchKeywords(
  seed: string,
  slug: string,
  context: string
): Promise<KeywordResearchResult> {
  // Check cache first
  const cache = loadCache();
  const cached = cache.find(c => c.slug === slug && c.seed === seed);
  if (cached) {
    console.log(`     📊 Ubersuggest: using cached results for "${seed}" (cached: ${cached.cachedAt})`);
    return cached.result;
  }

  // Try AI fallback before giving up
  try {
    const result = await aiFallbackResearch(seed, context);
    if (result) {
      cacheKeywordResults(slug, seed, result);
      console.log(`     🤖 AI fallback: keyword research generated via AI for "${seed}"`);
      return result;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`     ⚠️ AI fallback failed for "${seed}": ${msg}`);
  }

  // Not cached, AI fallback failed — tell the user what to run
  printMcpCommand(seed, slug, context);

  return {
    focusKeyword: seed,
    suggestions: [],
    relatedKeywords: [],
    searchVolume: 0,
    difficulty: 0,
    clusterScore: 0,
    source: 'unavailable',
  };
}

/**
 * Save keyword research results to cache for next pipeline run.
 */
export function cacheKeywordResults(
  slug: string,
  seed: string,
  result: KeywordResearchResult
): void {
  const cache = loadCache();
  const existing = cache.findIndex(c => c.slug === slug && c.seed === seed);
  const entry: CachedResearch = {
    slug,
    seed,
    result,
    cachedAt: new Date().toISOString().split('T')[0],
  };

  if (existing !== -1) {
    cache[existing] = entry;
  } else {
    cache.push(entry);
  }

  saveCache(cache);
  console.log(`     💾 Saved keyword research to cache: ${cachePath()}`);
}

/**
 * Fallback keyword research using the available AI provider.
 * Called when cache misses and no MCP results are available.
 */
async function aiFallbackResearch(
  seed: string,
  context: string
): Promise<KeywordResearchResult | null> {
  console.log(`     🔍 AI fallback: researching "${seed}"...`);

  const provider = await selectProvider();
  const result = await provider.chat({
    tier: 'routing',
    systemPrompt: 'You are an SEO keyword research expert. Return ONLY valid JSON.',
    messages: [{
      role: 'user',
      content: `Generate keyword research for the seed keyword '${seed}' in the context of '${context}'. Return a JSON object with: focusKeyword, searchVolume (number, estimate), difficulty (number 1-100, estimate), relatedKeywords (array of {keyword, volume, difficulty}), suggestions (array of {keyword, volume, difficulty, cpc (string), intent (string)}). Return ONLY valid JSON.`,
    }],
    temperature: 0.3,
  });

  if (!result?.text) return null;

  const text = result.text.trim();
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : text;
  const parsed = JSON.parse(jsonStr);

  return {
    focusKeyword: parsed.focusKeyword || seed,
    suggestions: (parsed.suggestions || []).map((s: { keyword?: string; volume?: number; difficulty?: number; cpc?: string; intent?: string }) => ({
      keyword: s.keyword ?? seed,
      volume: s.volume ?? 0,
      difficulty: s.difficulty ?? 0,
      cpc: s.cpc ?? '0',
      intent: s.intent ?? '',
    })),
    relatedKeywords: (parsed.relatedKeywords || []).map((r: { keyword?: string } | string) =>
      typeof r === 'string' ? r : (r.keyword ?? '')
    ),
    searchVolume: parsed.searchVolume ?? 0,
    difficulty: parsed.difficulty ?? 0,
    clusterScore: parsed.clusterScore ?? 0,
    source: 'ai-fallback',
  } as unknown as KeywordResearchResult;
}

/**
 * Print the MCP command the user should run in their Claude Code session.
 */
function printMcpCommand(seed: string, slug: string, context: string): void {
  const divider = '─'.repeat(60);
  console.log(`\n${divider}`);
  console.log(`     🔑 KEYWORD RESEARCH NEEDED`);
  console.log(`${divider}`);
  console.log(`     Post: ${slug}`);
  console.log(`     Seed: "${seed}"`);
  console.log(`     Context: ${context || 'travel blog post'}`);
  console.log(``);
  console.log(`     The Ubersuggest MCP uses OAuth and can only be called`);
  console.log(`     from within a Claude Code session.`);
  console.log(``);
  console.log(`     Step 1: Run this command in this Claude session:`);
  console.log(`     ${''.padEnd(5)}mcp__ubersuggest__keyword_ideas on "${seed}"`);
  console.log(``);
  console.log(`     Step 2: Save the result to data/keyword-research-cache.json:`);
  console.log(`     ${''.padEnd(5)}{\"slug\":\"${slug}\",\"seed\":\"${seed}\",\"result\":<MCP response>,\"cachedAt\":\"$(date +%Y-%m-%d)\"}`);
  console.log(`\n${divider}\n`);
}

/**
 * Load the cache so external tools can inspect it.
 */
export function getKeywordCache(): CachedResearch[] {
  return loadCache();
}
