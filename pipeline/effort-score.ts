/**
 * Pipeline step for Google 2026 Content Effort & Anti-SAFE Audit
 */

import type { StepInput, StepOutput } from '../lib/types';
import { EffortScoreAnalyzer, type EffortScoreBreakdown } from '../lib/effort-score/effort-score';

export interface EffortScoreAuditResult {
  breakdown: EffortScoreBreakdown;
}

export async function stepEffortScoreAudit(input: StepInput): Promise<StepOutput & { data?: EffortScoreAuditResult }> {
  const changes: string[] = [];

  console.log(`     🎯 Running 2026 Content Effort & Anti-SAFE audit`);

  const breakdown = EffortScoreAnalyzer.analyze(input.content, input.frontmatter);

  changes.push(`🏆 Effort Score: ${breakdown.totalScore}/100 [Rating: ${breakdown.rating}]`);
  changes.push(`   • Firsthand Experience: ${breakdown.firsthandScore}/25`);
  changes.push(`   • Visual Proof & Media: ${breakdown.visualProofScore}/25`);
  changes.push(`   • Original Data & Math: ${breakdown.originalDataScore}/25`);
  changes.push(`   • Authorship Verifiability: ${breakdown.authorshipScore}/15`);
  changes.push(`   • Anti-SAFE & Directness: ${breakdown.antiSafeIntroScore}/10`);

  if (breakdown.recommendations.length > 0) {
    changes.push(`⚠️  Effort recommendations (${breakdown.recommendations.length}):`);
    breakdown.recommendations.forEach(rec => changes.push(`      - ${rec}`));
  }

  return {
    content: input.content,
    frontmatter: input.frontmatter,
    changes,
    data: {
      breakdown
    }
  };
}
