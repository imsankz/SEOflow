/**
 * SeoFlow — Vault Readiness & Quality Gates
 *
 * Phase-gate checks that prevent moving to the next stage until
 * the current one produces clean results. Patterned after the
 * shipping-rules concept: read first, write second, verify third.
 */
import type { ReadinessCheck, VaultIndex } from './types';
import { loadIndex, findByType } from './vault-index';
import { getUnverifiedClaims } from './evidence-ledger';
import fs from 'fs';
import path from 'path';

export function checkReadiness(
  clientSlug: string,
  phase: ReadinessCheck['phase'],
  rootDir?: string,
): ReadinessCheck {
  const index = loadIndex(clientSlug, rootDir);
  const checks: ReadinessCheck['checks'] = [];
  let overall: ReadinessCheck['status'] = 'pass';

  switch (phase) {
    case 'intake': {
      // Minimum: overview note + hot.md exist
      const overview = findByType(clientSlug, 'overview', rootDir);
      checks.push({
        name: 'Overview note exists',
        status: overview.length > 0 ? 'pass' : 'fail',
        detail: overview.length > 0
          ? `Found at ${overview[0].relPath}`
          : 'No overview.md found in vault',
      });

      // GSC baselines exist
      checks.push({
        name: 'GSC baseline data',
        status: hasGscBaselines(clientSlug, rootDir) ? 'pass' : 'warn',
        detail: 'GSC data not yet captured — some recommendations will lack data',
      });

      break;
    }

    case 'diagnostic': {
      // Must have completed at least one audit
      const audits = findByType(clientSlug, 'audit', rootDir);
      checks.push({
        name: 'Completed audits',
        status: audits.length > 0 ? 'pass' : 'fail',
        detail: `${audits.length} audit note(s) found`,
      });

      // Check for unverified claims
      const unverified = getUnverifiedClaims(clientSlug, rootDir);
      checks.push({
        name: 'Unverified claims',
        status: unverified.length === 0 ? 'pass' : 'warn',
        detail: `${unverified.length} unverified claim(s) — review before acting on them`,
      });

      break;
    }

    case 'discovery': {
      // Keywords and competitors populated
      const keywords = findByType(clientSlug, 'keyword', rootDir);
      checks.push({
        name: 'Keyword research',
        status: keywords.length >= 5 ? 'pass' : keywords.length > 0 ? 'warn' : 'fail',
        detail: `${keywords.length} keyword note(s)`,
      });

      const competitors = findByType(clientSlug, 'competitor', rootDir);
      checks.push({
        name: 'Competitor landscape',
        status: competitors.length > 0 ? 'pass' : 'warn',
        detail: competitors.length > 0
          ? `${competitors.length} competitor(s) identified`
          : 'No competitors documented',
      });

      break;
    }

    case 'synthesis': {
      // Decisions documented, deliverables exist
      const decisions = findByType(clientSlug, 'decision', rootDir);
      checks.push({
        name: 'Decisions documented',
        status: decisions.length >= 3 ? 'pass' : decisions.length > 0 ? 'warn' : 'fail',
        detail: `${decisions.length} decision note(s)`,
      });

      const deliverables = findByType(clientSlug, 'deliverable', rootDir);
      checks.push({
        name: 'Deliverables ready',
        status: deliverables.length > 0 ? 'pass' : 'warn',
        detail: deliverables.length > 0
          ? `${deliverables.length} deliverable(s)`
          : 'No deliverables created yet',
      });

      break;
    }

    case 'final': {
      // Everything ready for publish/action
      const unverified = getUnverifiedClaims(clientSlug, rootDir);
      checks.push({
        name: 'All claims verified',
        status: unverified.length === 0 ? 'pass' : 'warn',
        detail: `${unverified.length} unverified claim(s)`,
      });

      const indexOk = checkIndexFreshness(index);
      checks.push({
        name: 'Index freshness',
        status: indexOk ? 'pass' : 'warn',
        detail: indexOk
          ? `Index built ${index.lastIndexed}`
          : 'Index may be stale — run `seoflow vault index`',
      });

      break;
    }
  }

  if (checks.some(c => c.status === 'fail')) overall = 'fail';
  else if (checks.some(c => c.status === 'warn')) overall = 'warn';

  return { phase, status: overall, checks };
}

function hasGscBaselines(clientSlug: string, rootDir?: string): boolean {
  const baseDir = rootDir || process.cwd();
  const baselinePath = path.join(baseDir, '.seoflow', 'data', 'gsc-baselines.json');
  return fs.existsSync(baselinePath);
}

function checkIndexFreshness(index: VaultIndex): boolean {
  if (!index.lastIndexed) return false;
  const age = Date.now() - new Date(index.lastIndexed).getTime();
  // Index is fresh if < 1 hour old
  return age < 3600_000;
}
