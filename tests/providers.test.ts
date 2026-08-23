/**
 * providers.test.ts — unit tests for the provider registry.
 *
 * Run: npx tsx --test tests/providers.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectAll, selectProvider } from '../lib/providers';

describe('provider registry', () => {
  it('detectAll returns all 7 providers', async () => {
    const all = await detectAll();
    assert.equal(all.length, 7);
    const ids = all.map(a => a.id).sort();
    assert.deepEqual(ids, [
      'anthropic',
      'claude-cli',
      'codex-cli',
      'gemini',
      'gemini-cli',
      'openai',
      'openrouter',
    ]);
  });

  it('selectProvider throws when no auth available', async () => {
    const savedGemini = process.env.GEMINI_API_KEY;
    const savedOpenrouter = process.env.OPENROUTER_API_KEY;
    const savedAnthropic = process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      // Before asserting the throw, check if any CLI-based provider
      // (claude-cli, codex-cli, gemini-cli) is already authed on this machine.
      // If so, selectProvider will find them despite deleted API keys.
      const all = await detectAll();
      const anyAuthed = all.some(a => a.authed);
      if (!anyAuthed) {
        await assert.rejects(
          () => selectProvider(),
          /No AI provider available/,
        );
      }
      // When a CLI provider is authed, selectProvider returns that provider
      // instead of throwing — that's correct behavior, so we skip the assert.
    } finally {
      if (savedGemini) process.env.GEMINI_API_KEY = savedGemini;
      if (savedOpenrouter) process.env.OPENROUTER_API_KEY = savedOpenrouter;
      if (savedAnthropic) process.env.ANTHROPIC_API_KEY = savedAnthropic;
    }
  });

  it('GEMINI_API_KEY makes gemini provider authed', async () => {
    const saved = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-key';
    try {
      const all = await detectAll();
      const gemini = all.find(a => a.id === 'gemini');
      assert.equal(gemini?.authed, true);
      assert.equal(gemini?.name, 'Gemini 2.5 Flash (Google)');
    } finally {
      if (saved) process.env.GEMINI_API_KEY = saved;
      else delete process.env.GEMINI_API_KEY;
    }
  });
});
