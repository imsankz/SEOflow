/**
 * SeoFlow — Evidence Ledger
 *
 * Tracks every claim back to its source evidence. Each claim has a confidence
 * level and verification status, so nothing is taken at face value.
 */
import fs from 'fs';
import path from 'path';
import type { EvidenceEntry, EvidenceLedger } from './types';
import { vaultDir } from './vault-fs';

const LEDGER_FILE = 'evidence-ledger.json';

function ledgerPath(clientSlug: string, rootDir?: string): string {
  return path.join(vaultDir(clientSlug, rootDir), LEDGER_FILE);
}

export function loadLedger(clientSlug: string, rootDir?: string): EvidenceLedger {
  const lp = ledgerPath(clientSlug, rootDir);
  if (fs.existsSync(lp)) {
    try {
      return JSON.parse(fs.readFileSync(lp, 'utf8')) as EvidenceLedger;
    } catch { /* corrupt — start fresh */ }
  }
  return { clientSlug, entries: {}, updated: new Date().toISOString() };
}

function saveLedger(ledger: EvidenceLedger, rootDir?: string): void {
  const slug = ledger.clientSlug || 'default';
  const lp = ledgerPath(slug, rootDir);
  const vd = path.dirname(lp);
  if (!fs.existsSync(vd)) fs.mkdirSync(vd, { recursive: true });
  ledger.updated = new Date().toISOString();
  fs.writeFileSync(lp, JSON.stringify(ledger, null, 2), 'utf8');
}

/** Record a claim with its evidence source */
export function recordClaim(
  clientSlug: string,
  claim: string,
  source: string,
  confidence: EvidenceEntry['confidence'] = 'medium',
  rootDir?: string,
): void {
  const ledger = loadLedger(clientSlug, rootDir);
  const key = claim.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 100);
  ledger.entries[key] = {
    claim,
    source,
    verified: false,
    confidence,
    notes: undefined,
  };
  saveLedger(ledger, rootDir);
}

/** Mark a claim as verified */
export function verifyClaim(
  clientSlug: string,
  claimKey: string,
  rootDir?: string,
): void {
  const ledger = loadLedger(clientSlug, rootDir);
  if (ledger.entries[claimKey]) {
    ledger.entries[claimKey].verified = true;
    ledger.entries[claimKey].verified_at = new Date().toISOString();
    saveLedger(ledger, rootDir);
  }
}

/** Get all unverified claims */
export function getUnverifiedClaims(clientSlug: string, rootDir?: string): EvidenceEntry[] {
  const ledger = loadLedger(clientSlug, rootDir);
  return Object.values(ledger.entries).filter(e => !e.verified);
}

/** Get all claims at or below a confidence threshold */
export function getClaimsByConfidence(
  clientSlug: string,
  minConfidence: EvidenceEntry['confidence'],
  rootDir?: string,
): EvidenceEntry[] {
  const ledger = loadLedger(clientSlug, rootDir);
  const order: Record<string, number> = { low: 0, medium: 1, high: 2 };
  const min = order[minConfidence as string];
  return Object.values(ledger.entries).filter(e => (order[e.confidence] ?? 0) >= min);
}
