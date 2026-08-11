/**
 * BLUF summary pipeline step (feature 3).
 *
 * Read-only step: wraps lib/bluf.generateBluf and returns the typed
 * BlufResult as step data. Never rewrites post content — the BLUF output
 * is a sidecar (markdown + JSON under .seoflow/bluf/). When no AI key is
 * configured, generateBluf degrades to a skipped result and this step
 * reports it without crashing the pipeline.
 */

import type { StepInput, StepOutput } from '../lib/types';
import { generateBluf, saveBluf, type BlufResult } from '../lib/bluf';

/**
 * Generate a BLUF summary sidecar for a post (read-only).
 *
 * changes stays [] — BLUF never edits the post body or frontmatter; the
 * summary is persisted as a sidecar file so downstream tools can consume it.
 */
export async function stepBlufAudit(input: StepInput): Promise<StepOutput & { data?: BlufResult }> {
  const result = await generateBluf(input.slug);

  if (result && !result.degraded && result.blufStatement) {
    try {
      saveBluf(result);
    } catch (e) {
      // Sidecar write is best-effort — never fail the step over it.
      console.log(`     ⚠️  BLUF sidecar write failed: ${e instanceof Error ? e.message : 'error'}`);
    }
  }

  return {
    content: input.content,
    frontmatter: input.frontmatter,
    changes: [],
    data: result,
  };
}
