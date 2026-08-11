/**
 * AI Citation Tracker — per-brand REST probing.
 *
 * Probes buyer prompts against brand-representative models:
 * - OPENROUTER_API_KEY → all 3 brands via OpenRouter chat/completions
 *   (chatgpt=openai/gpt-4o-mini, gemini=google/gemini-2.5-flash-lite,
 *   perplexity=perplexity/sonar — verified live 2026-08-11).
 * - Only GEMINI_API_KEY → gemini via the direct API
 *   (gemini-3.5-flash-lite — gemini-2.5-flash-lite 404s on direct API).
 *
 * Read-only: never writes content, only `.seoflow/data/` via store.ts.
 * Graceful: a failed probe is recorded (status: "error") and the run continues.
 */
import { loadConfig } from '../config';
import { requireIntegration, SkipStepError } from '../degradation';
import { getAiCallCount, bumpAiCallCount } from '../ai-provider';
import { resolveCitationsConfig, routeForBrand, estimateCostUsd, type ResolvedCitationsConfig, type BrandRoute } from './config';
import { detectMentions, resolveDetectionSettings } from './detect';
import type { ProbeResult, CitationRun } from './types';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const GEMINI_DIRECT_URL = (model: string, key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

const DEFAULT_TIMEOUT_MS = 60_000;
const RETRY_DELAY_MS = 5_000;

/** Collapse newlines/CR in user-controlled strings before logging (CWE-117). */
function sanitizeLog(s: string | null | undefined): string {
  return String(s ?? '').replace(/[\r\n]/g, ' ');
}

export interface ProbeRunOptions {
  /** Restrict to one topic name (--topic). */
  topic?: string | null;
  /** Cap the number of network probes issued this run (--limit). */
  limit?: number | null;
}

interface ProbeJob {
  topic: string;
  prompt: string;
  brand: ProbeResult['brand'];
  route: BrandRoute;
}

// ─── Low-level probe call ─────────────────────────────────────────────────────

interface RawProbeResponse {
  text: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Extract a useful message from an API error response. */
function errorMessage(res: Response, body: string): string {
  let detail = '';
  try {
    const j = JSON.parse(body) as { error?: { message?: string } };
    detail = j.error?.message ?? '';
  } catch {
    detail = '';
  }
  // Research §6: model IDs churn — fail loudly with the verification command.
  if ((res.status === 404 || res.status === 400) && /model/i.test(body)) {
    return `model not found (HTTP ${res.status}): ${detail || body.slice(0, 160)} — verify with: curl -s https://openrouter.ai/api/v1/models`;
  }
  return `HTTP ${res.status}: ${detail || body.slice(0, 160) || res.statusText}`;
}

/** One network probe with a single retry (5s delay) — matches aiChatWithRetry style. */
async function probeOnce(
  route: BrandRoute,
  prompt: string,
  opts: { maxAnswerTokens: number; siteUrl: string; siteName: string; timeoutMs: number },
): Promise<RawProbeResponse> {
  const { maxAnswerTokens, siteUrl, siteName, timeoutMs } = opts;
  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    try {
      let res: Response;
      if (route.provider === 'openrouter') {
        res = await fetchWithTimeout(
          OPENROUTER_URL,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
              'HTTP-Referer': siteUrl ? `https://${siteUrl}` : 'https://seoflow',
              'X-Title': siteName ? `${siteName} SeoFlow` : 'SeoFlow',
            },
            body: JSON.stringify({
              model: route.modelId,
              messages: [{ role: 'user', content: prompt }],
              max_tokens: maxAnswerTokens,
              temperature: 0.3,
            }),
          },
          timeoutMs,
        );
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(errorMessage(res, body));
        }
        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const content = data.choices?.[0]?.message?.content;
        const text = Array.isArray(content) ? content.map((p) => p.text ?? '').join('') : (content ?? '');
        return {
          text,
          promptTokens: data.usage?.prompt_tokens ?? 0,
          completionTokens: data.usage?.completion_tokens ?? 0,
          latencyMs: Date.now() - started,
        };
      }

      // gemini-direct fallback (thevenicepass case: only GEMINI_API_KEY).
      res = await fetchWithTimeout(
        GEMINI_DIRECT_URL(route.modelId, process.env.GEMINI_API_KEY || ''),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: maxAnswerTokens },
          }),
        },
        timeoutMs,
      );
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(errorMessage(res, body));
      }
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
      return {
        text,
        promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        latencyMs: Date.now() - started,
      };
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (attempt === 1) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }
  throw lastErr ?? new Error('probe failed');
}

// ─── Run orchestration ────────────────────────────────────────────────────────

let probeCounter = 0;

function nextProbeId(): string {
  probeCounter++;
  return `probe-${probeCounter}`;
}

/** Build the full job list (topic × prompt × brand) with route decisions. */
function buildJobs(resolved: ResolvedCitationsConfig, opts: ProbeRunOptions): ProbeJob[] {
  const jobs: ProbeJob[] = [];
  for (const topic of resolved.topics) {
    if (opts.topic && topic.name !== opts.topic) continue;
    for (const prompt of topic.prompts) {
      for (const brand of ['chatgpt', 'gemini', 'perplexity'] as const) {
        jobs.push({ topic: topic.name, prompt, brand, route: routeForBrand(brand, resolved) });
      }
    }
  }
  return jobs;
}

/** Compute the network-probe budget (shared AI counter + local perRunCap + --limit). */
function computeBudget(jobs: ProbeJob[], resolved: ResolvedCitationsConfig, limit: number | null): number {
  let available = Infinity;
  try {
    const max = loadConfig().aiLimits?.maxCallsPerRun;
    if (max) available = Math.max(0, max - getAiCallCount());
  } catch {
    // config not loaded yet — allow
  }
  const issuable = jobs.filter((j) => j.route.skipReason === null).length;
  return Math.min(available, resolved.perRunCap, limit ?? Infinity, issuable);
}

/**
 * Run the citation probe pack.
 * Throws SkipStepError when no AI key is available or the feature is disabled —
 * callers must catch it and skip cleanly (exit 0).
 */
export async function runCitationsProbes(opts: ProbeRunOptions = {}): Promise<CitationRun> {
  const cfg = loadConfig();
  const resolved = resolveCitationsConfig(cfg.citations);
  if (!resolved.enabled) {
    throw new SkipStepError('citations disabled (citations.enabled: false)');
  }
  requireIntegration('citations-probe');

  const siteUrl = cfg.siteUrl;
  const siteName = cfg.siteName;
  const detection = resolveDetectionSettings(cfg.citations);

  const jobs = buildJobs(resolved, opts);
  if (jobs.length === 0) {
    throw new SkipStepError('citations: no topics/prompts configured');
  }

  const budget = computeBudget(jobs, resolved, opts.limit ?? null);
  const startedAt = new Date().toISOString();
  const probes: ProbeResult[] = [];
  let issued = 0;
  let costUsd = 0;

  for (const job of jobs) {
    const base: ProbeResult = {
      id: nextProbeId(),
      topic: job.topic,
      prompt: job.prompt,
      brand: job.brand,
      provider: job.route.provider,
      modelId: job.route.modelId,
      status: 'skipped-key',
      error: null,
      startedAt: new Date().toISOString(),
      latencyMs: 0,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      answerSnippet: '',
      inlineCitationCount: 0,
      citationsArray: [],
      mentions: [],
      mentionCount: 0,
    };

    if (job.route.skipReason) {
      base.error = job.route.skipReason;
      probes.push(base);
      continue;
    }

    if (issued >= budget) {
      base.status = 'skipped-budget';
      base.error = `budget cap ${budget} reached`;
      probes.push(base);
      continue;
    }

    issued++;
    bumpAiCallCount();
    const probeStarted = Date.now();
    try {
      const raw = await probeOnce(job.route, job.prompt, {
        maxAnswerTokens: resolved.maxAnswerTokens,
        siteUrl,
        siteName,
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
      const detected = detectMentions(raw.text, job.prompt, { siteUrl, siteName, author: cfg.author }, detection);
      const probeCost = estimateCostUsd(job.route.modelId, raw.promptTokens, raw.completionTokens);
      costUsd += probeCost;
      probes.push({
        ...base,
        status: 'ok',
        provider: job.route.provider,
        latencyMs: raw.latencyMs,
        promptTokens: raw.promptTokens,
        completionTokens: raw.completionTokens,
        costUsd: probeCost,
        answerSnippet: raw.text.slice(0, 400),
        inlineCitationCount: detected.inlineCitationCount,
        mentions: detected.mentions,
        mentionCount: detected.mentionCount,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`     ⚠️  ${job.brand}/${job.topic} probe failed: ${sanitizeLog(msg)}`);
      probes.push({
        ...base,
        status: 'error',
        provider: job.route.provider,
        latencyMs: Date.now() - probeStarted,
        error: msg,
      });
    }
  }

  const ok = probes.filter((p) => p.status === 'ok').length;
  const errors = probes.filter((p) => p.status === 'error').length;
  const skips = probes.filter((p) => p.status === 'skipped-key' || p.status === 'skipped-budget').length;
  const status: CitationRun['status'] = ok === 0 && errors > 0 ? 'failed' : errors > 0 || skips > 0 ? 'degraded' : 'completed';

  return {
    id: `run-${startedAt.replace(/[:.]/g, '-')}`,
    startedAt,
    finishedAt: new Date().toISOString(),
    status,
    config: { freeOnly: resolved.freeOnly, perRunCap: resolved.perRunCap },
    budget: { callsUsed: issued, callsCap: budget, costUsd: Number(costUsd.toFixed(6)) },
    probes,
  };
}
