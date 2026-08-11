/**
 * AI Citation Tracker — SOV aggregation + console formatting.
 *
 * Aggregates the citation history into a per-topic per-AI share-of-voice view:
 * runs, mentions, mentionRate (SOV = mentions/runs), lastMentioned, and a
 * rolling mention trend per run (newest last).
 *
 * History file is the source of truth; the SOV view is regenerable.
 */
import type { CitationBrand } from '../config';
import type { CitationHistory, CitationRun, SovSummary, SovTopicSummary } from './types';
import { BRANDS, BRAND_LABELS } from './types';

const EMPTY_BRAND_RECORD = (): Record<CitationBrand, number> => ({ chatgpt: 0, gemini: 0, perplexity: 0 });

/**
 * Aggregate history → SOV summary over the last `windowRuns` runs.
 * Runs are taken in chronological order (newest last), so `trend` arrays end
 * with the most recent run — ready for sparklines.
 */
export function aggregateSov(history: CitationHistory, windowRuns = 30): SovSummary {
  const runs = history.runs.slice(-Math.max(1, windowRuns));
  const byTopic: Record<string, SovTopicSummary> = {};

  // Collect topics in first-seen order for stable console output.
  const topicOrder: string[] = [];
  for (const run of runs) {
    for (const probe of run.probes) {
      if (!byTopic[probe.topic]) {
        byTopic[probe.topic] = {
          runs: EMPTY_BRAND_RECORD(),
          mentions: EMPTY_BRAND_RECORD(),
          mentionRate: EMPTY_BRAND_RECORD(),
          lastMentioned: { chatgpt: null, gemini: null, perplexity: null },
          trend: { chatgpt: [], gemini: [], perplexity: [] },
        };
        topicOrder.push(probe.topic);
      }
    }
  }

  for (const run of runs) {
    for (const topic of topicOrder) {
      for (const brand of BRANDS) {
        const probe = run.probes.find((p) => p.topic === topic && p.brand === brand);
        if (!probe) continue; // topic/brand not probed in this run — keep arrays aligned per existing probe
        const summary = byTopic[topic];
        summary.runs[brand] += 1;
        const mentioned = probe.status === 'ok' && probe.mentionCount >= 1;
        if (mentioned) {
          summary.mentions[brand] += 1;
          const ts = probe.startedAt || run.startedAt;
          if (!summary.lastMentioned[brand] || ts > summary.lastMentioned[brand]!) {
            summary.lastMentioned[brand] = ts;
          }
        }
        summary.trend[brand].push(mentioned ? 1 : 0);
      }
    }
  }

  for (const topic of topicOrder) {
    const summary = byTopic[topic];
    for (const brand of BRANDS) {
      summary.mentionRate[brand] = summary.runs[brand] > 0
        ? Number((summary.mentions[brand] / summary.runs[brand]).toFixed(4))
        : 0;
    }
  }

  // Preserve topic order (first-seen).
  const ordered: Record<string, SovTopicSummary> = {};
  for (const topic of topicOrder) ordered[topic] = byTopic[topic];

  return {
    version: '1.0',
    siteUrl: history.siteUrl,
    generatedAt: new Date().toISOString(),
    windowRuns: Math.max(1, windowRuns),
    byTopic: ordered,
  };
}

// ─── Console formatting (terminal-friendly plain text) ───────────────────────

/** Compact sparkline from a 0/1 trend array (oldest → newest). */
function sparkline(trend: number[]): string {
  if (trend.length === 0) return '—';
  return trend.map((v) => (v ? '█' : '·')).join('');
}

interface Row {
  label: string;
  cells: string[];
}

/** Render an aligned plain-text table (no external deps). */
function renderTable(header: string[], rows: Row[]): string[] {
  const widths = header.map((h, i) => {
    if (i === 0) return Math.max(h.length, ...rows.map((r) => r.label.length));
    return Math.max(h.length, ...rows.map((r) => r.cells[i]?.length ?? 0));
  });
  const line = (parts: string[]) => parts.map((p, i) => p.padEnd(widths[i])).join('  ').trimEnd();
  const out = [line(header)];
  out.push(widths.map((w) => '─'.repeat(w)).join('  '));
  for (const r of rows) out.push(line([r.label, ...r.cells]));
  return out;
}

/**
 * Format a single probe run for `seoflow citations`.
 * Per topic: mentions per brand with inline sparkline for this run's trend.
 */
export function formatRunTable(run: CitationRun, siteName: string): string[] {
  const topics = [...new Set(run.probes.map((p) => p.topic))];
  const rows: Row[] = [];
  const totals: Record<CitationBrand, number> = { chatgpt: 0, gemini: 0, perplexity: 0 };

  for (const topic of topics) {
    const cells: string[] = [];
    for (const brand of BRANDS) {
      const probe = run.probes.find((p) => p.topic === topic && p.brand === brand);
      if (!probe) {
        cells.push('·');
        continue;
      }
      if (probe.status === 'ok') {
        totals[brand] += probe.mentionCount;
        cells.push(`${probe.mentionCount > 0 ? '✓' : '✗'} ${probe.mentionCount > 0 ? 'cited' : 'silent'} (${probe.modelId.split('/').pop()})`);
      } else if (probe.status === 'error') {
        cells.push(`⚠ error`);
      } else {
        cells.push(`⏭ ${probe.status === 'skipped-budget' ? 'budget' : 'key'}`);
      }
    }
    rows.push({ label: topic, cells });
  }

  const lines = [
    `\n🔎 Citation probe run — ${run.id} (${run.status})`,
    `   ${siteName} · ${run.probes.length} probes, ${run.budget.callsUsed}/${run.budget.callsCap} calls, est. $${run.budget.costUsd.toFixed(4)}`,
    '',
    ...renderTable(['Topic', 'ChatGPT', 'Gemini', 'Perplexity'], rows),
    '',
    `   ${BRAND_LABELS.chatgpt} cited you ${totals.chatgpt}x · ${BRAND_LABELS.gemini} ${totals.gemini}x · ${BRAND_LABELS.perplexity} ${totals.perplexity}x`,
    '',
  ];
  return lines;
}

/**
 * Format the SOV dashboard for `seoflow sov`.
 * Per topic: mentions/runs + mentionRate + trend sparkline per brand, plus an
 * overall "cited you Nx" line.
 */
export function formatSovTable(summary: SovSummary, siteName: string): string[] {
  const topics = Object.keys(summary.byTopic);
  const totals: Record<CitationBrand, number> = { chatgpt: 0, gemini: 0, perplexity: 0 };

  const rows: Row[] = topics.map((topic) => {
    const s = summary.byTopic[topic];
    const cells = BRANDS.map((brand) => {
      totals[brand] += s.mentions[brand];
      const rate = (s.mentionRate[brand] * 100).toFixed(0);
      return `${s.mentions[brand]}/${s.runs[brand]} (${rate}%) ${sparkline(s.trend[brand])}`;
    });
    return { label: topic, cells };
  });

  const lines = [
    `\n📊 Share of Voice — ${siteName} (last ${summary.windowRuns} runs)`,
    `   Mentions per topic per AI · SOV = mentions/runs · █ = mentioned, · = silent (oldest → newest)`,
    '',
    ...renderTable(['Topic', 'ChatGPT', 'Gemini', 'Perplexity'], rows),
    '',
    `   ${BRAND_LABELS.chatgpt} cited you ${totals.chatgpt}x · ${BRAND_LABELS.gemini} ${totals.gemini}x · ${BRAND_LABELS.perplexity} ${totals.perplexity}x`,
    '',
  ];
  return lines;
}
