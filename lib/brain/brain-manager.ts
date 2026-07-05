/**
 * Brain Manager — single integration point for vault, evidence ledger, and log.
 *
 * Wires together vault-fs.ts, evidence-ledger.ts, and index.ts (hot.md/log.md)
 * into a cohesive system called from every pipeline path.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ensureVault, writeVaultNote } from './vault-fs';
import type { VaultFrontmatter } from './types';
import { loadLedger, recordClaim } from './evidence-ledger';
import { appendLog, writeBrain } from './index';
import { getClientSlug } from '../config';

function getSlug(): string {
  try { return getClientSlug(); } catch { return 'default'; }
}

/** Initialize the brain vault — creates directories and initial notes */
export function initBrain(): void {
  const vaultPath = ensureVault(getSlug());
  appendLog({ type: 'decision', summary: 'Brain initialized at ' + vaultPath });
}

/** Record an audit finding in the vault + evidence ledger */
export function recordFinding(
  url: string,
  category: string,
  finding: string,
  severity: 'high' | 'medium' | 'low',
  source: string,
  confidence: number,
): void {
  ensureVault(getSlug());

  // Write as vault note
  const dateStr = new Date().toISOString().slice(0, 10);
  const title = `${category}: ${url.replace(/https?:\/\//, '').slice(0, 60)}`;
  const body = `## Finding\n\n${finding}\n\n**Source:** ${source}\n**Severity:** ${severity}\n**Confidence:** ${confidence}/10\n`;
  const fm: VaultFrontmatter = {
    title,
    owner: 'seoflow',
    confidence: confidence / 10,
    approval_status: 'draft',
    risk_level: severity === 'high' ? 'high' : severity === 'medium' ? 'medium' : 'low',
    created: dateStr,
    updated: dateStr,
  };
  const slug = finding.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50);
  writeVaultNote(getSlug(), 'findings', `${dateStr}-${slug}`, fm, body);

  // Record in evidence ledger
  recordClaim(getSlug(), finding, source, confidence >= 7 ? 'high' : confidence >= 4 ? 'medium' : 'low');

  // Write to log
  appendLog({ type: 'change', summary: `[${severity.toUpperCase()}] ${category}: ${finding.slice(0, 100)}`, detail: `${url} — ${source}` });
}

/** Record a complete audit run as a vault note */
export function recordAuditRun(
  url: string,
  report: string,
  score: number,
  signalCount: number,
): void {
  ensureVault(getSlug());

  const dateStr = new Date().toISOString().slice(0, 10);
  const domain = url.replace(/https?:\/\//, '').replace(/[\/:]/g, '_').slice(0, 40);
  const fm: VaultFrontmatter = {
    title: `SEO Audit — ${domain}`,
    owner: 'seoflow',
    confidence: 0.5,
    approval_status: 'draft',
    risk_level: score < 40 ? 'high' : score < 70 ? 'medium' : 'low',
    created: dateStr,
    updated: dateStr,
  };
  const auditBody = `## Audit Results\n\n**URL:** ${url}\n**Date:** ${dateStr}\n**Health Score:** ${score}/100\n**Signals Found:** ${signalCount}\n\n---\n\n${report}`;
  writeVaultNote(getSlug(), 'audits', `${dateStr}-${domain}`, fm, auditBody);

  // Log + hot brain
  appendLog({ type: 'run', summary: `Audit saved: ${url} — score ${score}/100, ${signalCount} signals` });

  writeBrain({
    lastRun: {
      timestamp: new Date().toISOString(),
      duration: 0,
      postsProcessed: 1,
      errors: 0,
      totalChanges: signalCount,
    },
    recentPosts: [{
      slug: domain,
      status: score >= 70 ? 'ok' : score >= 40 ? 'warn' : 'error',
      changes: signalCount,
      aiCalls: 0,
    }],
  });
}

/** Record a specific signal from a page audit */
export function recordSignal(
  url: string,
  signalId: string,
  label: string,
  severity: 'high' | 'medium' | 'low' | 'info',
  detail: string,
): void {
  ensureVault(getSlug());

  const dateStr = new Date().toISOString().slice(0, 10);
  const domain = url.replace(/https?:\/\//, '').replace(/[\/:]/g, '_').slice(0, 30);
  const fm: VaultFrontmatter = {
    title: `Signal: ${label}`,
    owner: 'seoflow',
    confidence: 0.7,
    approval_status: 'draft',
    risk_level: severity === 'high' ? 'high' : severity === 'medium' ? 'medium' : 'low',
    created: dateStr,
    updated: dateStr,
  };
  writeVaultNote(getSlug(), 'findings', `${dateStr}-${domain}-${signalId}`, fm, `## ${label}\n\n**Severity:** ${severity}\n**URL:** ${url}\n**Detail:** ${detail}\n\n*Auto-detected by SeoFlow URL auditor*`);

  // Record in evidence ledger
  recordClaim(getSlug(), `${label}: ${detail}`, url, severity === 'high' ? 'high' : 'medium');
}

/** Get a summary of everything in the vault */
export function vaultSummary(): string {
  const baseDir = path.join(process.cwd(), '.seoflow', 'brain', getSlug());
  if (!fs.existsSync(baseDir)) return 'No vault data yet. Run an audit first.';

  const lines: string[] = ['## Vault Summary'];

  // Count notes by type
  const types = ['audits', 'findings', 'decisions', 'deliverables', 'entities'];
  for (const type of types) {
    const dir = path.join(baseDir, 'wiki', type);
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
      lines.push(`- ${type}: ${files.length} notes`);
    }
  }

  // Latest audits
  const auditsDir = path.join(baseDir, 'wiki', 'audits');
  if (fs.existsSync(auditsDir)) {
    const files = fs.readdirSync(auditsDir).filter(f => f.endsWith('.md')).sort().reverse().slice(0, 5);
    if (files.length > 0) {
      lines.push('\n**Latest audits:**');
      for (const f of files) {
        const raw = fs.readFileSync(path.join(auditsDir, f), 'utf-8');
        const titleMatch = raw.match(/title: (.+)/);
        lines.push(`- ${titleMatch?.[1] || f.replace('.md', '')}`);
      }
    }
  }

  // Evidence ledger
  const ledger = loadLedger(getSlug());
  const entries = Object.values(ledger.entries || {});
  if (entries.length > 0) {
    lines.push(`\n**Evidence ledger:** ${entries.length} claims`);
    const verified = entries.filter((e: any) => e.verified).length;
    lines.push(`- Verified: ${verified}/${entries.length}`);
  }

  return lines.join('\n');
}

/** Suggest next actions based on vault state */
export function suggestNextActions(): string[] {
  const actions: string[] = [];

  const baseDir = path.join(process.cwd(), '.seoflow', 'brain', getSlug(), 'wiki', 'findings');
  if (fs.existsSync(baseDir)) {
    const highSeverity = fs.readdirSync(baseDir).filter(f => {
      const content = fs.readFileSync(path.join(baseDir, f), 'utf-8');
      return content.includes('**Severity:** high');
    });
    if (highSeverity.length > 0) {
      actions.push(`Review ${highSeverity.length} high-severity findings in vault`);
    }
  }

  const ledger = loadLedger(getSlug());
  const unverified = Object.values(ledger.entries || {}).filter((e: any) => !e.verified);
  if (unverified.length > 5) {
    actions.push(`Verify ${unverified.length} unverified claims in evidence ledger`);
  }

  return actions;
}

export interface SeveritySignal {
  id: string;
  label: string;
  severity: 'high' | 'medium' | 'low' | 'info';
  detail: string;
}

/** Compute audit score from page signals */
export function computeAuditScore(signals: { title?: string; description?: string; h1?: string[]; h2?: string[]; canonical?: string; hasSchema?: boolean }, psi?: { score: number } | null): number {
  const titleScore = signals.title && signals.title.length >= 30 && signals.title.length <= 60 ? 90 : signals.title ? 60 : 0;
  const descScore = signals.description && signals.description.length >= 120 && signals.description.length <= 160 ? 90 : signals.description ? 60 : 0;
  const h1Score = signals.h1?.length === 1 ? 100 : !signals.h1?.length ? 0 : 50;
  const canonicalScore = signals.canonical ? 100 : 0;
  const schemaScore = signals.hasSchema ? 80 : 0;
  const h2Score = (signals.h2?.length ?? 0) >= 2 ? 90 : (signals.h2?.length ?? 0) >= 1 ? 60 : 30;
  const psiScore = psi?.score ?? 0;
  return Math.round((titleScore + descScore + h1Score + canonicalScore + schemaScore + h2Score + (psi ? psiScore : 50)) / 7);
}

/** Compute severity signals from page signals */
export function computeSeveritySignals(signals: { title?: string; description?: string; h1?: string[]; h2?: string[]; canonical?: string; hasSchema?: boolean; links?: { internal: number; external: number } }, psi?: { score: number; lcp: number; cls: number } | null): SeveritySignal[] {
  const results: SeveritySignal[] = [];
  if (!signals.title) results.push({ id: 'missing-title', label: 'Missing <title> tag', severity: 'high', detail: 'Every page needs a unique, descriptive title tag' });
  if (!signals.description) results.push({ id: 'missing-description', label: 'Missing meta description', severity: 'high', detail: 'Meta descriptions drive CTR from search results' });
  if (!signals.h1?.length) results.push({ id: 'missing-h1', label: 'Missing H1 heading', severity: 'high', detail: 'Each page needs exactly one H1' });
  if ((signals.h1?.length ?? 0) > 1) results.push({ id: 'multiple-h1', label: `${signals.h1!.length} H1 tags found`, severity: 'medium', detail: 'Best practice is exactly one H1 per page' });
  if (!signals.canonical) results.push({ id: 'missing-canonical', label: 'Missing canonical URL', severity: 'medium', detail: 'Canonical prevents duplicate content issues' });
  if (!signals.h2?.length) results.push({ id: 'no-h2', label: 'No H2 headings', severity: 'medium', detail: 'H2s provide content structure and keyword signals' });
  if (psi && psi.score < 50) results.push({ id: 'poor-perf', label: `Low PSI score: ${psi.score}/100`, severity: 'high', detail: `LCP: ${psi.lcp.toFixed(1)}s, CLS: ${psi.cls.toFixed(2)}` });
  if (psi && psi.lcp > 2.5) results.push({ id: 'lcp-issue', label: `High LCP: ${psi.lcp.toFixed(1)}s`, severity: 'high', detail: 'LCP should be under 2.5 seconds' });
  if (psi && psi.cls > 0.1) results.push({ id: 'cls-issue', label: `High CLS: ${psi.cls.toFixed(2)}`, severity: 'high', detail: 'CLS should be under 0.1' });
  if (signals.links && signals.links.internal === 0 && signals.links.external === 0) results.push({ id: 'no-links', label: 'No links detected', severity: 'low', detail: 'Page may have no outbound links' });
  return results;
}