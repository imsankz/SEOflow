/**
 * bluf.test.ts — unit tests for the BLUF summary generator (feature 3).
 *
 * Covers prompt construction, strict-JSON response parsing (with fences and
 * prose tolerance), markdown sidecar rendering, and graceful degradation
 * when no AI key is configured. No network calls — the AI path is never
 * exercised with a real key.
 *
 * Run: npx tsx --test tests/bluf.test.ts
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configure, resetConfig } from '../lib/config';
import {
  buildBlufPrompt,
  parseBlufResponse,
  generateBluf,
  blufToMarkdown,
  saveBluf,
  type BlufResult,
} from '../lib/bluf';

const TEST_CONFIG = {
  siteName: 'Test Site',
  siteUrl: 'https://example.com',
  author: 'Test Author',
  authorLocation: 'Rome',
  writingSample: 'The verdict first: it is worth it. Then the details.',
  contentDomain: 'travel blog',
  postsDir: '/tmp/bluf-posts',
  gscPagesCsv: '/tmp/bluf-gsc.csv',
  gscQueriesCsv: '/tmp/bluf-gsc-queries.csv',
  auditLogPath: '/tmp/bluf-audit.json',
  keywordCachePath: '/tmp/bluf-kw.json',
  tools: [],
  bookings: [],
};

function saveEnv(key: string): string | undefined {
  return process.env[key];
}
function restoreEnv(key: string, saved: string | undefined): void {
  if (saved) process.env[key] = saved;
  else delete process.env[key];
}

// ─── Prompt construction ─────────────────────────────────────────────────────

test('buildBlufPrompt: includes site context, writing sample, title, and JSON contract', () => {
  configure({ ...TEST_CONFIG, postsDir: os.tmpdir() });
  try {
    const fm = { title: 'Rome in 3 Days', category: 'itinerary', schema: 'Itinerary' };
    const prompt = buildBlufPrompt('rome-in-3-days', fm, 'Body text with prices: metro day pass 7 EUR.');

    assert.match(prompt, /example\.com/);                       // site context
    assert.match(prompt, /Test Author/);                        // author
    assert.match(prompt, /The verdict first: it is worth it\./); // writing sample
    assert.match(prompt, /Rome in 3 Days/);                     // title
    assert.match(prompt, /BLUF/);
    assert.match(prompt, /"bluf_statement"/);                   // strict JSON keys
    assert.match(prompt, /"quick_answer"/);
    assert.match(prompt, /"key_facts"/);
    assert.match(prompt, /"sections"/);
    assert.match(prompt, /"qa_pairs"/);
    assert.match(prompt, /Never invent facts/);
  } finally {
    resetConfig();
  }
});

test('buildBlufPrompt: truncates long content into an excerpt', () => {
  configure({ ...TEST_CONFIG, postsDir: os.tmpdir() });
  try {
    const longContent = ('word '.repeat(5000)).trim();
    const prompt = buildBlufPrompt('long-post', {}, longContent);
    assert.ok(prompt.length < longContent.length + 2000, 'prompt should excerpt, not embed, long content');
    assert.match(prompt, /\[middle of post\]/);
  } finally {
    resetConfig();
  }
});

// ─── JSON parsing ────────────────────────────────────────────────────────────

test('parseBlufResponse: parses valid JSON into typed result', () => {
  const json = JSON.stringify({
    bluf_statement: 'Three days is enough for Rome.',
    quick_answer: 'Rome is doable in 3 days.',
    key_facts: [{ fact: 'Metro day pass', detail: '7 EUR' }, { fact: 'Colosseum ticket', detail: '18 EUR' }],
    sections: [{ heading: 'Day 1', summary: 'Ancient city.', bullets: ['Colosseum', 'Forum'] }],
    qa_pairs: [{ question: 'Is 3 days enough?', answer: 'Yes.' }],
  });
  const r = parseBlufResponse(json, 'rome-in-3-days', 'Rome in 3 Days');

  assert.equal(r.slug, 'rome-in-3-days');
  assert.equal(r.title, 'Rome in 3 Days');
  assert.equal(r.blufStatement, 'Three days is enough for Rome.');
  assert.equal(r.quickAnswer, 'Rome is doable in 3 days.');
  assert.equal(r.keyFacts.length, 2);
  assert.equal(r.keyFacts[0].fact, 'Metro day pass');
  assert.equal(r.keyFacts[1].detail, '18 EUR');
  assert.equal(r.sections.length, 1);
  assert.equal(r.sections[0].heading, 'Day 1');
  assert.deepEqual(r.sections[0].bullets, ['Colosseum', 'Forum']);
  assert.equal(r.qaPairs.length, 1);
  assert.equal(r.qaPairs[0].question, 'Is 3 days enough?');
});

test('parseBlufResponse: strips code fences and surrounding prose', () => {
  const wrapped = 'Sure! Here is your summary:\n```json\n{"bluf_statement":"Line one.","quick_answer":"QA","key_facts":[],"sections":[],"qa_pairs":[]}\n```\nHope this helps!';
  const r = parseBlufResponse(wrapped, 'x', 'X');
  assert.equal(r.blufStatement, 'Line one.');
  assert.equal(r.quickAnswer, 'QA');
});

test('parseBlufResponse: returns empty fallback on malformed JSON (never throws)', () => {
  const r = parseBlufResponse('no json here at all', 'x', 'X');
  assert.equal(r.blufStatement, '');
  assert.deepEqual(r.keyFacts, []);
  assert.deepEqual(r.sections, []);
  assert.deepEqual(r.qaPairs, []);
  assert.equal(r.degraded, undefined, 'parse fallback is not a degraded result');
});

test('parseBlufResponse: filters malformed rows instead of crashing', () => {
  const json = JSON.stringify({
    bluf_statement: 'OK.',
    quick_answer: '',
    key_facts: [{ fact: 'A' }, 'garbage', null],
    sections: [{ heading: 'H', summary: '', bullets: ['b', 42, null] }, {}],
    qa_pairs: [{ answer: 'A' }],
  });
  const r = parseBlufResponse(json, 'x', 'X');
  assert.deepEqual(r.keyFacts, [{ fact: 'A', detail: '' }]);
  assert.equal(r.sections.length, 1);
  assert.deepEqual(r.sections[0].bullets, ['b']);
  assert.equal(r.qaPairs.length, 1);
});

// ─── Markdown sidecar ────────────────────────────────────────────────────────

test('blufToMarkdown: renders BLUF, Quick Answer, Key Facts table, sections, Q&A', () => {
  const result: BlufResult = {
    slug: 'rome',
    title: 'Rome',
    blufStatement: 'Three days is enough.',
    quickAnswer: 'Quick answer text.',
    keyFacts: [{ fact: 'Metro pass', detail: '7 EUR' }],
    sections: [{ heading: 'Day 1', summary: 'Summary.', bullets: ['Colosseum'] }],
    qaPairs: [{ question: 'Is 3 days enough?', answer: 'Yes.' }],
  };
  const md = blufToMarkdown(result);
  assert.match(md, /# BLUF: Rome/);
  assert.match(md, /> Three days is enough\./);
  assert.match(md, /## Quick Answer/);
  assert.match(md, /\| Metro pass \| 7 EUR \|/);
  assert.match(md, /### Day 1/);
  assert.match(md, /\*\*Q: Is 3 days enough\?\*\*/);
  assert.match(md, /Post content was not modified/);
});

test('blufToMarkdown: escapes pipes in table cells', () => {
  const result: BlufResult = {
    slug: 'x',
    title: 'X',
    blufStatement: '',
    quickAnswer: '',
    keyFacts: [{ fact: 'Wifi | data', detail: 'included' }],
    sections: [],
    qaPairs: [],
  };
  const md = blufToMarkdown(result);
  assert.match(md, /\| Wifi \\\| data \| included \|/);
});

// ─── Degradation (no network calls) ─────────────────────────────────────────

test('generateBluf: degrades to a skip message when no AI key is set', async () => {
  const savedGemini = saveEnv('GEMINI_API_KEY');
  const savedOpenrouter = saveEnv('OPENROUTER_API_KEY');
  const savedAnthropic = saveEnv('ANTHROPIC_API_KEY');
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bluf-posts-'));
  fs.writeFileSync(path.join(tmp, 'test-post.mdx'), '---\ntitle: Test Post\n---\nBody text with a direct answer.');
  configure({ ...TEST_CONFIG, postsDir: tmp });

  try {
    const result = await generateBluf('test-post');
    assert.equal(result.degraded, true);
    assert.match(result.message || '', /AI key/i);
    assert.equal(result.blufStatement, '');
    assert.deepEqual(result.keyFacts, []);
  } finally {
    resetConfig();
    restoreEnv('GEMINI_API_KEY', savedGemini);
    restoreEnv('OPENROUTER_API_KEY', savedOpenrouter);
    restoreEnv('ANTHROPIC_API_KEY', savedAnthropic);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('generateBluf: reports a missing post without calling AI', async () => {
  const savedGemini = saveEnv('GEMINI_API_KEY');
  process.env.GEMINI_API_KEY = 'test-key';
  configure({ ...TEST_CONFIG, postsDir: os.tmpdir() });

  try {
    const result = await generateBluf('does-not-exist');
    assert.equal(result.degraded, true);
    assert.match(result.message || '', /not found/i);
  } finally {
    resetConfig();
    restoreEnv('GEMINI_API_KEY', savedGemini);
  }
});

test('saveBluf: writes .md and .json sidecars', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bluf-out-'));
  try {
    const result: BlufResult = {
      slug: 'sidecar-test',
      title: 'Sidecar Test',
      blufStatement: 'Bottom line.',
      quickAnswer: '',
      keyFacts: [{ fact: 'F', detail: 'D' }],
      sections: [],
      qaPairs: [],
    };
    const { mdPath, jsonPath } = saveBluf(result, tmp);
    assert.ok(fs.existsSync(mdPath));
    assert.ok(fs.existsSync(jsonPath));
    assert.match(fs.readFileSync(mdPath, 'utf8'), /# BLUF: Sidecar Test/);
    const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as BlufResult;
    assert.equal(parsed.slug, 'sidecar-test');
    assert.equal(parsed.blufStatement, 'Bottom line.');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
