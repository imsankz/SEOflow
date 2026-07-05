/**
 * Codex CLI provider — spawn `codex exec` using the user's ChatGPT/OpenAI subscription.
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

const BIN = process.env.SEOFLOW_CODEX_BIN || 'codex';

export const codexCliProvider: LLMProvider = {
  id: 'codex-cli',
  name: 'Codex (via codex CLI)',
  authMode: 'subscription',

  async availability(): Promise<ProviderAvailability> {
    const probe = await spawnChild(BIN, ['--version'], { timeoutMs: 5000 });
    const installed = probe.exitCode === 0;
    const authPath = path.join(process.env.HOME ?? '', '.codex', 'auth.json');
    const authTomlPath = path.join(process.env.HOME ?? '', '.codex', 'auth.toml');
    const authed = installed && (fs.existsSync(authPath) || fs.existsSync(authTomlPath));
    return {
      id: 'codex-cli',
      name: 'Codex (via codex CLI)',
      authMode: 'subscription',
      installed,
      authed,
      error: installed ? undefined : probe.stderr || 'codex CLI not on PATH',
    };
  },

  async chat(input: LLMChatInput): Promise<LLMChatResult | null> {
    const composed = `SYSTEM:\n${input.systemPrompt}\n\nUSER:\n${input.messages.map((m) => `${m.role === 'user' ? '' : '(assistant) '}${m.content}`).join('\n\n')}`;
    const args = ['exec', '-s', 'read-only', ...(input.model ? ['-m', input.model] : []), '-'];
    const started = Date.now();
    const result = await spawnChild(BIN, args, { timeoutMs: input.timeoutMs ?? 120_000, input: composed });
    if (result.exitCode !== 0) {
      console.error(`     Codex CLI error (${result.exitCode}): ${result.stderr.slice(0, 200)}`);
      return null;
    }
    return { text: result.stdout.trim(), durationMs: Date.now() - started };
  },
};