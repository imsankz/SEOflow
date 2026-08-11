/**
 * citations.test.ts — unit tests for the AI Citation Tracker.
 *
 * Covers:
 * - mention detection (pure function, no network)
 * - SOV aggregation (pure function)
 * - JSON store (load-or-default + append-run)
 * - probe budget/skip behaviour with mocked fetch
 *
 * Run: npx tsx --test tests/citations.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configure, resetConfig } from '../lib/config';
import { SkipStepError } from '../lib/degradation';
import {
  detectMentions,
  resolveDetectionSettings,
  aggregateSov,
  loadHistory,
  saveHistory,
  appendRun,
  resolveCitationsConfig,
  routeForBrand,
  runCitationsProbes,
} from '../lib/citations';
import type { CitationHistory, CitationRun, ProbeResult } from '../lib/citations';
import type { CitationsConfig, SeoFlowConfig } from '../lib/config';

function freshConfig(overrides: Partial<SeoFlowConfig> = {}): void {
  resetConfig();
  configure({
    siteName: 'Chasing Whereabouts',
    siteUrl: 'chasingwhereabouts.com',
    author: 'Sankalp Singh',
    authorLocation: 'Frankfurt',
    postsDir: '/tmp/posts',
    gscPagesCsv: '/tmp/pages.csv',
    gscQueriesCsv: '/tmp/queries.csv',
    auditLogPath: '/tmp/audit-log.json',
    keywordCachePath: '/tmp/keyword-cache.json',
    blogPrefix: '/blog/',
    tools: [],
    bookings: [],
    ...overrides,
  } as SeoFlowConfig);
}

const SITE = { siteUrl: 'chasingwhereabouts.com', siteName: 'Chasing Whereabouts', author: 'Sankalp Singh' };
const DETECT_DEFAULT = resolveDetectionSettings(undefined);

// ─── Mention detection ───────────────────────────────────────────────────────

describe('detectMentions', () => {
  it('detects bare domain in plain text', () => {
    const r = detectMentions('For Berlin tips check chasingwhereabouts.com — it is excellent.', 'prompt?', SITE, DETECT_DEFAULT);
    assert.equal(r.mentionCount, 1);
    assert.equal(r.mentions[0].matchKind, 'domain');
    assert.equal(r.mentions[0].inSourcesSection, false);
  });

  it('detects domain inside https:// and www. forms', () => {
    const a = 'Read https://www.chasingwhereabouts.com/berlin and www.chasingwhereabouts.com too';
    const r = detectMentions(a, 'prompt?', SITE, DETECT_DEFAULT);
    assert.equal(r.mentionCount, 2);
    assert.ok(r.mentions.every((m) => m.matchKind === 'domain'));
  });

  it('detects capitalized brand name', () => {
    const r = detectMentions('I found Chasing Whereabouts helpful for Prague.', 'prompt?', SITE, DETECT_DEFAULT);
    assert.equal(r.mentionCount, 1);
    assert.equal(r.mentions[0].matchKind, 'brand');
  });

  it('ignores lowercase generic phrase by default (brandNameRequiresCapital)', () => {
    const r = detectMentions('the chasing whereabouts of the suspect remain unknown.', 'prompt?', SITE, DETECT_DEFAULT);
    assert.equal(r.mentionCount, 0);
  });

  it('counts lowercase brand when brandNameRequiresCapital is false', () => {
    const settings = resolveDetectionSettings({ detection: { brandNameRequiresCapital: false } } as CitationsConfig);
    const r = detectMentions('the chasing whereabouts of the suspect remain unknown.', 'prompt?', SITE, settings);
    assert.equal(r.mentionCount, 1);
    assert.equal(r.mentions[0].matchKind, 'brand');
  });

  it('ignores author by default, matches when includeAuthor is on', () => {
    const off = detectMentions('Written by Sankalp Singh from Frankfurt.', 'prompt?', SITE, DETECT_DEFAULT);
    assert.equal(off.mentionCount, 0);

    const on = resolveDetectionSettings({ detection: { includeAuthor: true } } as CitationsConfig);
    const r = detectMentions('Written by Sankalp Singh from Frankfurt.', 'prompt?', SITE, on);
    assert.equal(r.mentionCount, 1);
    assert.equal(r.mentions[0].matchKind, 'author');
  });

  it('tags matches in a trailing Sources block as inSourcesSection', () => {
    const a = 'The pass is worth it for most visitors.\n\nSources:\n- chasingwhereabouts.com/berlin-pass-review\n- prague-pass-review.com';
    const r = detectMentions(a, 'prompt?', SITE, DETECT_DEFAULT);
    const domainMatch = r.mentions.find((m) => m.matchKind === 'domain');
    assert.ok(domainMatch, 'domain should be detected in sources');
    assert.equal(domainMatch!.inSourcesSection, true);
  });

  it('does not tag inline matches before a Sources block', () => {
    const a = 'chasingwhereabouts.com covers this in detail.\n\nReferences:\n- example.org';
    const r = detectMentions(a, 'prompt?', SITE, DETECT_DEFAULT);
    assert.equal(r.mentions[0].inSourcesSection, false);
  });

  it('strips an echoed probe prompt before matching', () => {
    const prompt = 'Best things to do in Berlin in winter?';
    const a = `${prompt}\n\nBerlin is great — see chasingwhereabouts.com for a full guide.`;
    // The prompt itself must NOT contain the site; detection should only see the answer.
    const r = detectMentions(a, prompt, SITE, DETECT_DEFAULT);
    assert.equal(r.mentionCount, 1);
    assert.equal(r.mentions[0].matchKind, 'domain');
  });

  it('dedupes overlapping matches (domain wins)', () => {
    // Synthetic siteName that appears inside the domain string → overlapping spans.
    const overlapSite = { siteUrl: 'chasingwhereabouts.com', siteName: 'Whereabouts', author: 'Nobody' };
    const r = detectMentions('visit chasingwhereabouts.com now', 'prompt?', overlapSite, DETECT_DEFAULT);
    assert.equal(r.mentionCount, 1, 'brand match inside domain span must be deduped');
    assert.equal(r.mentions[0].matchKind, 'domain');
  });

  it('caps recorded mention detail at maxMatchesPerProbe but counts all distinct', () => {
    const settings = resolveDetectionSettings({ detection: { maxMatchesPerProbe: 2 } } as CitationsConfig);
    const a = Array.from({ length: 5 }, (_, i) => `https://chasingwhereabouts.com/post-${i}`).join(' ');
    const r = detectMentions(a, 'prompt?', SITE, settings);
    assert.equal(r.mentionCount, 5);
    assert.equal(r.mentions.length, 2);
  });

  it('counts inline [N] citation markers', () => {
    const a = 'Berlin is great [1] and the guide [2][3] says so — see chasingwhereabouts.com [4].';
    const r = detectMentions(a, 'prompt?', SITE, DETECT_DEFAULT);
    assert.equal(r.inlineCitationCount, 4);
  });

  it('a probe counts as cited when mentionCount >= 1', () => {
    const yes = detectMentions('See chasingwhereabouts.com.', 'prompt?', SITE, DETECT_DEFAULT);
    const no = detectMentions('I have no idea what to recommend.', 'prompt?', SITE, DETECT_DEFAULT);
    assert.equal(yes.mentionCount >= 1, true);
    assert.equal(no.mentionCount >= 1, false);
  });
});

// ─── SOV aggregation ─────────────────────────────────────────────────────────

function probe(partial: Partial<ProbeResult>): ProbeResult {
  return {
    id: 'p',
    topic: 'berlin',
    prompt: 'p?',
    brand: 'chatgpt',
    provider: 'openrouter',
    modelId: 'openai/gpt-4o-mini',
    status: 'ok',
    error: null,
    startedAt: '2026-08-01T00:00:00.000Z',
    latencyMs: 100,
    promptTokens: 10,
    completionTokens: 50,
    costUsd: 0.0001,
    answerSnippet: '',
    inlineCitationCount: 0,
    citationsArray: [],
    mentions: [],
    mentionCount: 0,
    ...partial,
  };
}

function run(overrides: Partial<CitationRun> = {}, probes: ProbeResult[] = []): CitationRun {
  return {
    id: 'run-1',
    startedAt: '2026-08-01T00:00:00.000Z',
    finishedAt: '2026-08-01T00:01:00.000Z',
    status: 'completed',
    config: { freeOnly: false, perRunCap: 30 },
    budget: { callsUsed: probes.length, callsCap: 30, costUsd: 0.001 },
    probes,
    ...overrides,
  };
}

describe('aggregateSov', () => {
  it('computes runs/mentions/rate per topic per AI', () => {
    const history: CitationHistory = {
      version: '1.0',
      siteUrl: 'chasingwhereabouts.com',
      lastRun: null,
      runs: [
        run({ id: 'r1', startedAt: '2026-08-01T00:00:00.000Z' }, [
          probe({ brand: 'chatgpt', mentionCount: 1, startedAt: '2026-08-01T00:00:00.000Z' }),
          probe({ brand: 'gemini', mentionCount: 0, startedAt: '2026-08-01T00:00:01.000Z' }),
          probe({ brand: 'perplexity', mentionCount: 1, startedAt: '2026-08-01T00:00:02.000Z' }),
        ]),
        run({ id: 'r2', startedAt: '2026-08-08T00:00:00.000Z' }, [
          probe({ brand: 'chatgpt', mentionCount: 0, startedAt: '2026-08-08T00:00:00.000Z' }),
          probe({ brand: 'gemini', mentionCount: 1, startedAt: '2026-08-08T00:00:01.000Z' }),
          probe({ brand: 'perplexity', mentionCount: 0, startedAt: '2026-08-08T00:00:02.000Z' }),
        ]),
        run({ id: 'r3', startedAt: '2026-08-15T00:00:00.000Z' }, [
          probe({ brand: 'chatgpt', mentionCount: 1, startedAt: '2026-08-15T00:00:00.000Z' }),
          probe({ brand: 'gemini', mentionCount: 0, startedAt: '2026-08-15T00:00:01.000Z' }),
          probe({ brand: 'perplexity', mentionCount: 1, startedAt: '2026-08-15T00:00:02.000Z' }),
        ]),
      ],
    };

    const summary = aggregateSov(history, 30);
    const t = summary.byTopic.berlin;

    assert.deepEqual(t.runs, { chatgpt: 3, gemini: 3, perplexity: 3 });
    assert.deepEqual(t.mentions, { chatgpt: 2, gemini: 1, perplexity: 2 });
    // mentionRate is rounded to 4 decimals for display (SOV metric).
    assert.equal(t.mentionRate.chatgpt, 0.6667);
    assert.equal(t.mentionRate.gemini, 0.3333);
    assert.equal(t.mentionRate.perplexity, 0.6667);

    // trend: oldest → newest (newest last)
    assert.deepEqual(t.trend.chatgpt, [1, 0, 1]);
    assert.deepEqual(t.trend.gemini, [0, 1, 0]);
    assert.deepEqual(t.trend.perplexity, [1, 0, 1]);

    // lastMentioned = newest mentioning run
    assert.equal(t.lastMentioned.chatgpt, '2026-08-15T00:00:00.000Z');
    assert.equal(t.lastMentioned.gemini, '2026-08-08T00:00:01.000Z');
    assert.equal(t.lastMentioned.perplexity, '2026-08-15T00:00:02.000Z');
  });

  it('respects the windowRuns lookback', () => {
    const history: CitationHistory = {
      version: '1.0',
      siteUrl: 'x.com',
      lastRun: null,
      runs: [
        run({ id: 'r1', startedAt: '2026-08-01T00:00:00.000Z' }, [probe({ brand: 'chatgpt', mentionCount: 1 })]),
        run({ id: 'r2', startedAt: '2026-08-08T00:00:00.000Z' }, [probe({ brand: 'chatgpt', mentionCount: 0 })]),
        run({ id: 'r3', startedAt: '2026-08-15T00:00:00.000Z' }, [probe({ brand: 'chatgpt', mentionCount: 1 })]),
      ],
    };
    const summary = aggregateSov(history, 2);
    assert.equal(summary.windowRuns, 2);
    const t = summary.byTopic.berlin;
    assert.equal(t.runs.chatgpt, 2);
    assert.equal(t.mentions.chatgpt, 1);
    assert.deepEqual(t.trend.chatgpt, [0, 1]);
  });

  it('keeps arrays aligned when probes are skipped-key (thevenicepass case)', () => {
    const history: CitationHistory = {
      version: '1.0',
      siteUrl: 'thevenicepass.com',
      lastRun: null,
      runs: [
        run({ id: 'r1', startedAt: '2026-08-01T00:00:00.000Z' }, [
          probe({ brand: 'chatgpt', status: 'skipped-key', error: 'no OPENROUTER_API_KEY', mentionCount: 0 }),
          probe({ brand: 'gemini', status: 'ok', mentionCount: 1 }),
          probe({ brand: 'perplexity', status: 'skipped-key', error: 'no OPENROUTER_API_KEY', mentionCount: 0 }),
        ]),
      ],
    };
    const summary = aggregateSov(history, 30);
    const t = summary.byTopic.berlin;
    // skipped-key probes count as runs (arrays aligned) but never as mentions.
    assert.deepEqual(t.runs, { chatgpt: 1, gemini: 1, perplexity: 1 });
    assert.deepEqual(t.mentions, { chatgpt: 0, gemini: 1, perplexity: 0 });
  });
});

// ─── Store ───────────────────────────────────────────────────────────────────

describe('citations store', () => {
  it('loadHistory returns defaults on missing file', () => {
    freshConfig();
    const p = join(mkdtempSync(join(tmpdir(), 'seoflow-cit-')), 'history.json');
    const h = loadHistory(p);
    assert.equal(h.version, '1.0');
    assert.deepEqual(h.runs, []);
    assert.equal(h.lastRun, null);
  });

  it('appendRun persists and updates lastRun', () => {
    freshConfig();
    const dir = mkdtempSync(join(tmpdir(), 'seoflow-cit-'));
    const p = join(dir, 'history.json');
    const h = loadHistory(p);
    appendRun(h, run({ id: 'r1', finishedAt: '2026-08-01T00:01:00.000Z' }, [probe({})]), p);

    const reloaded = loadHistory(p);
    assert.equal(reloaded.runs.length, 1);
    assert.equal(reloaded.lastRun, '2026-08-01T00:01:00.000Z');

    appendRun(reloaded, run({ id: 'r2', finishedAt: '2026-08-02T00:01:00.000Z' }, [probe({})]), p);
    const again = loadHistory(p);
    assert.equal(again.runs.length, 2);
    assert.equal(again.lastRun, '2026-08-02T00:01:00.000Z');
    rmSync(dir, { recursive: true });
  });

  it('saveHistory/loadHistory roundtrips a full run shape', () => {
    freshConfig();
    const dir = mkdtempSync(join(tmpdir(), 'seoflow-cit-'));
    const p = join(dir, 'history.json');
    const history: CitationHistory = {
      version: '1.0',
      siteUrl: 'chasingwhereabouts.com',
      lastRun: '2026-08-01T00:01:00.000Z',
      runs: [
        run({ id: 'r1' }, [
          probe({
            topic: 'berlin-winter',
            prompt: 'Best things to do in Berlin?',
            brand: 'perplexity',
            modelId: 'perplexity/sonar',
            mentionCount: 1,
            mentions: [{ matchKind: 'domain', pattern: 'chasingwhereabouts.com', count: 1, context: 'see chasingwhereabouts.com for the guide', inSourcesSection: false }],
            inlineCitationCount: 2,
            answerSnippet: 'Berlin in winter is magical…',
          }),
        ]),
      ],
    };
    saveHistory(history, p);
    const reloaded = loadHistory(p);
    assert.equal(reloaded.runs[0].probes[0].brand, 'perplexity');
    assert.equal(reloaded.runs[0].probes[0].mentions[0].matchKind, 'domain');
    assert.equal(reloaded.runs[0].probes[0].mentionCount, 1);
    rmSync(dir, { recursive: true });
  });
});

// ─── Config + routing + probe budget ─────────────────────────────────────────

describe('citations config + routing', () => {
  it('resolveCitationsConfig fills defaults and uses the per-site default pack', () => {
    freshConfig({ siteUrl: 'chasingwhereabouts.com' });
    const resolved = resolveCitationsConfig(undefined);
    assert.equal(resolved.enabled, true);
    assert.equal(resolved.perRunCap, 30);
    assert.equal(resolved.models.chatgpt, 'openai/gpt-4o-mini');
    assert.equal(resolved.models.gemini, 'google/gemini-2.5-flash-lite');
    assert.equal(resolved.models.perplexity, 'perplexity/sonar');
    assert.equal(resolved.geminiDirectModel, 'gemini-3.5-flash-lite');
    const names = resolved.topics.map((t) => t.name);
    assert.ok(names.includes('berlin-winter'));
    assert.ok(names.includes('prague-planning'));
  });

  it('uses configured topics when provided', () => {
    freshConfig();
    const resolved = resolveCitationsConfig({ topics: [{ name: 'custom', prompts: ['q?'] }] } as CitationsConfig);
    assert.deepEqual(resolved.topics, [{ name: 'custom', prompts: ['q?'] }]);
  });

  it('routes all brands via OpenRouter when OR key is set', () => {
    process.env.OPENROUTER_API_KEY = 'test-or';
    delete process.env.GEMINI_API_KEY;
    const resolved = resolveCitationsConfig(undefined);
    for (const brand of ['chatgpt', 'gemini', 'perplexity'] as const) {
      const r = routeForBrand(brand, resolved);
      assert.equal(r.provider, 'openrouter');
      assert.equal(r.skipReason, null);
    }
  });

  it('routes gemini via direct API and skips others when only GEMINI key is set', () => {
    delete process.env.OPENROUTER_API_KEY;
    process.env.GEMINI_API_KEY = 'test-gemini';
    const resolved = resolveCitationsConfig(undefined);
    const g = routeForBrand('gemini', resolved);
    assert.equal(g.provider, 'gemini-direct');
    assert.equal(g.modelId, 'gemini-3.5-flash-lite');
    for (const brand of ['chatgpt', 'perplexity'] as const) {
      const r = routeForBrand(brand, resolved);
      assert.equal(r.provider, 'none');
      assert.equal(r.skipReason, 'no OPENROUTER_API_KEY');
    }
  });

  it('freeOnly routes to :free models and skips perplexity', () => {
    process.env.OPENROUTER_API_KEY = 'test-or';
    const resolved = resolveCitationsConfig({ freeOnly: true } as CitationsConfig);
    assert.equal(routeForBrand('chatgpt', resolved).modelId, 'openai/gpt-oss-20b:free');
    assert.equal(routeForBrand('gemini', resolved).modelId, 'google/gemma-4-31b-it:free');
    assert.equal(routeForBrand('perplexity', resolved).skipReason, 'no free model for brand');
  });
});

describe('runCitationsProbes', () => {
  it('throws SkipStepError when no AI key is available', async () => {
    freshConfig();
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GEMINI_API_KEY;
    await assert.rejects(runCitationsProbes({}), SkipStepError);
  });

  it('probes configured topics with mocked fetch and records ok + cost', async () => {
    freshConfig({
      siteUrl: 'chasingwhereabouts.com',
      citations: {
        perRunCap: 30,
        maxAnswerTokens: 400,
        topics: [{ name: 'berlin-winter', prompts: ['Best things to do in Berlin in winter?'] }],
      } as CitationsConfig,
    });
    process.env.OPENROUTER_API_KEY = 'test-or';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Berlin is great — check chasingwhereabouts.com for the full guide.' } }],
          usage: { prompt_tokens: 40, completion_tokens: 60 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch;

    try {
      const run = await runCitationsProbes({});
      assert.equal(run.probes.length, 3); // 1 prompt × 3 brands
      assert.equal(run.status, 'completed');
      const ok = run.probes.filter((p) => p.status === 'ok');
      assert.equal(ok.length, 3);
      const cited = run.probes.filter((p) => p.mentionCount >= 1);
      assert.equal(cited.length, 3);
      assert.ok(ok[0].costUsd > 0, 'cost should be estimated from token usage');
      assert.equal(ok[0].modelId, 'openai/gpt-4o-mini');
      assert.equal(run.budget.callsUsed, 3);
      assert.equal(run.budget.callsCap, 3); // min(30, 3 issuable)
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('honours perRunCap and marks the remainder skipped-budget', async () => {
    freshConfig({
      siteUrl: 'chasingwhereabouts.com',
      citations: {
        perRunCap: 1,
        topics: [{ name: 't1', prompts: ['q1?', 'q2?'] }],
      } as CitationsConfig,
    });
    process.env.OPENROUTER_API_KEY = 'test-or';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'no mention here.' } }], usage: { prompt_tokens: 5, completion_tokens: 5 } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch;

    try {
      const run = await runCitationsProbes({});
      assert.equal(run.probes.filter((p) => p.status === 'ok').length, 1);
      assert.equal(run.probes.filter((p) => p.status === 'skipped-budget').length, 5); // 2 prompts × 3 brands − 1
      assert.equal(run.status, 'degraded');
      assert.equal(run.budget.callsUsed, 1);
      assert.equal(run.budget.callsCap, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('--limit caps network probes', async () => {
    freshConfig({
      siteUrl: 'chasingwhereabouts.com',
      citations: {
        topics: [{ name: 't1', prompts: ['q1?', 'q2?'] }],
      } as CitationsConfig,
    });
    process.env.OPENROUTER_API_KEY = 'test-or';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'fine.' } }], usage: { prompt_tokens: 5, completion_tokens: 5 } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch;

    try {
      const run = await runCitationsProbes({ limit: 2 });
      assert.equal(run.probes.filter((p) => p.status === 'ok').length, 2);
      assert.equal(run.budget.callsUsed, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
