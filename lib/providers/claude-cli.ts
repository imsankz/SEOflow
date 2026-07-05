/**
 * Claude CLI provider — spawn `claude --print` using the user's Claude subscription.
 *
 * No per-token cost — billed against existing Claude Pro/Max subscription.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { LLMChatInput, LLMChatResult, LLMProvider, ProviderAvailability } from './types';

const BIN = process.env.SEOFLOW_CLAUDE_BIN || 'claude';

async function spawnCapture(bin: string, args: string[], opts: { timeoutMs: number; input?: string }): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.on('error', (err) => {
      resolve({ stdout: '', stderr: `Failed to spawn: ${err.message}`, exitCode: 127, timedOut: false });
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, opts.timeoutMs);

    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stderr += d.toString()));

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1, timedOut });
    });

    if (opts.input) {
      child.stdin?.end(opts.input);
    }
  });
}

export const claudeCliProvider: LLMProvider = {
  id: 'claude-cli',
  name: 'Claude (via claude CLI)',
  authMode: 'subscription',

  async availability(): Promise<ProviderAvailability> {
    const probe = await spawnCapture(BIN, ['--version'], { timeoutMs: 5000 });
    const installed = probe.exitCode === 0;
    let authed = false;

    if (installed) {
      // Claude CLI stores credentials under ~/.claude/auth.json or ~/.claude/auth.toml
      const authPath = path.join(process.env.HOME ?? '', '.claude', 'auth.json');
      const authTomlPath = path.join(process.env.HOME ?? '', '.claude', 'auth.toml');
      authed = fs.existsSync(authPath) || fs.existsSync(authTomlPath);
    }

    return {
      id: 'claude-cli',
      name: 'Claude (via claude CLI)',
      authMode: 'subscription',
      installed,
      authed,
      error: installed ? undefined : probe.stderr || 'claude CLI not on PATH',
    };
  },

  async chat(input: LLMChatInput): Promise<LLMChatResult | null> {
    // Compose system + messages into a single prompt for claude --print
    const composed = `SYSTEM: ${input.systemPrompt}\n\n${input.messages
               .map((m) => `${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${m.content}`)
          .join('\n\n')}`;

    const started = Date.now();
    const result = await spawnCapture(BIN, ['--print', '--no-color'], {
          timeoutMs: input.timeoutMs ?? 120_000,
            input: composed,
    });

    if (result.exitCode !== 0) {
      console.error(`     Claude CLI error (${result.exitCode}): ${result.stderr.slice(0, 200)}`);
      return null;
    }

    return {
      text: result.stdout.trim(),
      durationMs: Date.now() - started,
    };
  },
};
