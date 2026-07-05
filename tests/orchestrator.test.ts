/**
 * orchestrator.test.ts — unit tests for the orchestrator module.
 *
 * Run: npx tsx --test tests/orchestrator.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generateId, ALL_STEPS } from '../lib/orchestrator/types';
import { registerStepRunner } from '../lib/orchestrator';

describe('orchestrator', () => {
  it('generateId returns unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateId());
    }
    assert.equal(ids.size, 100);
  });

  it('registerStepRunner stores runner', () => {
    registerStepRunner('test-step', async () => ({ success: true }));
  });

  it('ALL_STEPS has expected steps', () => {
    assert.ok(ALL_STEPS.length >= 11);
    const stepIds = ALL_STEPS.map(s => s.id);
    assert.ok(stepIds.includes('keyword-research'));
    assert.ok(stepIds.includes('fix-frontmatter'));
    assert.ok(stepIds.includes('inject-links'));
    assert.ok(stepIds.includes('inject-images'));
    assert.ok(stepIds.includes('neuron-analysis'));
    assert.ok(stepIds.includes('content-audit'));
    assert.ok(stepIds.includes('seo-review'));
    assert.ok(stepIds.includes('schema-validation'));
    assert.ok(stepIds.includes('quality-audit'));
    assert.ok(stepIds.includes('technical-audit'));
    assert.ok(stepIds.includes('fact-check'));
    assert.ok(stepIds.includes('report-export'));
  });

  it('ALL_STEPS phases cover all 5 phases', () => {
    const phases = new Set(ALL_STEPS.map(s => s.phase));
    assert.ok(phases.has('intake'));
    assert.ok(phases.has('diagnostic'));
    assert.ok(phases.has('discovery'));
    assert.ok(phases.has('synthesis'));
    assert.ok(phases.has('final'));
  });
});
