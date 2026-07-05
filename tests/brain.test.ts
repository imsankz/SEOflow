/**
 * brain.test.ts — unit tests for the brain module.
 *
 * Run: npx tsx --test tests/brain.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBrain, appendLog, readBrainSummary } from '../lib/brain';

function withTempDir(fn: (dir: string) => void): void {
  const tmpDir = mkdtempSync(join(tmpdir(), 'seoflow-brain-'));
  const origCwd = process.cwd();
  process.chdir(tmpDir);
  try {
    fn(tmpDir);
  } finally {
    process.chdir(origCwd);
    rmSync(tmpDir, { recursive: true });
  }
}

describe('brain module', () => {
  it('readBrain returns defaults on first run', () =>
    withTempDir(() => {
      const brain = readBrain();
      assert.equal(brain.brain_schema, 'seoflow-brain.v1');
      assert.deepEqual(brain.nextActions, []);
      assert.deepEqual(brain.recentPosts, []);
      assert.deepEqual(brain.backlog, []);
      assert.deepEqual(brain.issues, []);
      assert.equal(typeof brain.lastUpdated, 'string');
      assert.ok(brain.lastUpdated.length > 0);
    }),
  );

  it('appendLog creates log.md', () =>
    withTempDir(() => {
      appendLog({ type: 'note', summary: 'test entry' });
      const logPath = join(process.cwd(), '.seoflow', 'brain', 'log.md');
      assert.equal(existsSync(logPath), true);
      const content = readFileSync(logPath, 'utf-8');
      assert.match(content, /test entry/);
      assert.match(content, /\[note\]/);
    }),
  );

  it('readBrainSummary returns a string', () =>
    withTempDir(() => {
      const summary = readBrainSummary();
      assert.equal(typeof summary, 'string');
      assert.ok(summary.length > 0);
      assert.match(summary, /## SeoFlow Brain/);
      assert.match(summary, /\*\*Last updated:\*\*/);
    }),
  );
});
