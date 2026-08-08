/**
 * Gemini CLI provider — spawn `gemini -p` using the user's Google AI Pro subscription.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { LLMChatInput, LLMChatResult, LLMProvider, ProviderAvailability } from './types';

async function spawnChild(bin: string, args: string[], opts: { timeoutMs: number; input?: string }): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.on('error', (err) => resolve({ stdout: '', stderr: `Failed to spawn: ${err.message}`, exitCode: 127 }));
    const timer = setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs);
    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => { clearTimeout(timer); resolve({ stdout, stderr, exitCode: code ?? 1 }); });
    if (opts.input) child.stdin?.end(opts.input);
  });
}

const BIN = process.env.SEOFLOW_GEMINI_BIN || 'gemini';

// Token-level auth failures (stale/ineligible creds) can't be seen by availability() —
// they only surface at chat time. Print ONE clean hint per process, then stay quiet so
// the fallback chain handles the rest without spamming raw auth errors mid-run.
let authFailureNotified = false;

export const geminiCliProvider: LLMProvider = {
  id: 'gemini-cli',
  name: 'Gemini (via gemini CLI)',
  authMode: 'subscription',

  async availability(): Promise<ProviderAvailability> {
    const probe = await spawnChild(BIN, ['--version'], { timeoutMs: 5000 });
    const installed = probe.exitCode === 0;
    const credCandidates = [
      path.join(process.env.HOME ?? '', '.gemini', 'oauth_creds.json'),
      path.join(process.env.HOME ?? '', '.gemini', 'creds.json'),
      path.join(process.env.HOME ?? '', '.config', 'gemini', 'auth.json'),
    ];
    const authed = installed && credCandidates.some((p) => fs.existsSync(p));
    return {
      id: 'gemini-cli',
      name: 'Gemini (via gemini CLI)',
      authMode: 'subscription',
      installed,
      authed,
      error: installed ? (authed ? undefined : 'not authenticated') : probe.stderr || 'gemini CLI not on PATH',
    };
  },

  async chat(input: LLMChatInput): Promise<LLMChatResult | null> {
    const composed = `SYSTEM:\n${input.systemPrompt}\n\nUSER:\n${input.messages.map((m) => `${m.role === 'user' ? '' : '(assistant) '}${m.content}`).join('\n\n')}`;
    const args = ['-p', 'Use the instructions and transcript below.', '--output-format', 'json', ...(input.model ? ['-m', input.model] : [])];
    const started = Date.now();
    const result = await spawnChild(BIN, args, { timeoutMs: input.timeoutMs ?? 120_000, input: composed });
    if (result.exitCode !== 0) {
      const err = result.stderr.slice(0, 300);
      const isAuthFailure = /authenticat|Ineligible|credential|permission|login/i.test(err);
      if (isAuthFailure && !authFailureNotified) {
        authFailureNotified = true;
        console.error(`     ⚠️ Gemini CLI auth failed (stale or ineligible credentials) — run \`gemini auth login\` or set GEMINI_API_KEY. Skipping Gemini CLI for this run.`);
      } else if (!isAuthFailure) {
        console.error(`     Gemini CLI error (${result.exitCode}): ${err}`);
      }
      return null;
    }
    return { text: result.stdout.trim(), durationMs: Date.now() - started };
  },
};