/**
 * Unified AI provider — delegates to the lib/providers/ abstraction.
 *
 * Usage:
 *   import { aiChat, aiChatWithRetry } from '../lib/ai-provider';
 *   const response = await aiChatWithRetry(prompt, 'content-audit');
 *
 * Provider selection is handled by lib/providers/index.ts:
 *   1. AI_PROVIDER env var (fails closed)
 *   2. Auto-detect: claude-cli → codex-cli → gemini-cli → anthropic → openrouter → gemini
 *
 * Task-specific routing is passed through the provider's tier mechanism.
 */
import { selectProvider, logProviderStatus } from './providers';
import { loadConfig } from './config';

type ProviderName = 'gemini' | 'openrouter' | 'claude' | 'claude-cli' | 'codex-cli' | 'gemini-cli';

// ─── Per-run call counter ─────────────────────────────────────────────────────
const _runCounter = { count: 0 };

/** Reset the run-level call counter (call at the start of each pipeline run). */
export function resetAiCallCounter(): void {
  _runCounter.count = 0;
}

/** Current call count for the run. */
export function getAiCallCount(): number {
  return _runCounter.count;
}

/**
 * Bump the run-level call counter without issuing an AI call.
 * Used by integrations that make their own REST calls (e.g. the AI Citation
 * Tracker) so they share the same per-run budget as aiChat()/aiChatWithRetry().
 */
export function bumpAiCallCount(): void {
  _runCounter.count++;
}

/** Check if the run-level budget is exceeded. Returns true if the call should proceed. */
function checkBudget(task: string): boolean {
  try {
    const cfg = loadConfig();
    const max = cfg.aiLimits?.maxCallsPerRun;
    if (max && _runCounter.count >= max) {
      console.log(`     ⚠️  AI budget: ${_runCounter.count}/${max} calls used — skipping ${task}`);
      return false;
    }
  } catch {
    // config not loaded yet — allow
  }
  return true;
}

/** Map legacy task names to provider tiers */
function taskToTier(task: string): 'synthesis' | 'routing' {
  const synthesisTasks = ['content-audit', 'seo-review', 'generate', 'cluster', 'fact-check'];
  return synthesisTasks.includes(task) ? 'synthesis' : 'routing';
}

/**
 * Log available AI providers and current config.
 */
export async function logAiStatus(): Promise<void> {
  await logProviderStatus();
  const preferred = process.env.AI_PROVIDER?.toLowerCase().trim();
  if (preferred) {
    console.log(`   → Primary provider: ${preferred} (set via AI_PROVIDER)`);
  } else {
    console.log('   → Auto-detecting provider on first use');
  }
}

/**
 * Send a prompt to the best available AI provider.
 *
 * @param prompt - The prompt text
 * @param task - Task identifier for model routing
 * @returns Response text or null
 */
export async function aiChat(
  prompt: string,
  task = 'content-audit'
): Promise<string | null> {
  if (!checkBudget(task)) return null;
  _runCounter.count++;

  try {
    const provider = await selectProvider();
    const result = await provider.chat({
      tier: taskToTier(task),
      systemPrompt: '',
      messages: [{ role: 'user', content: prompt }],
    });
    return result?.text ?? null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    console.error(`     AI provider error: ${msg}`);
    return null;
  }
}

/**
 * Send a prompt with automatic retries across providers.
 *
 * @param prompt - The prompt text
 * @param task - Task identifier for model routing
 * @param maxRetries - Number of retries (default: 3)
 * @returns Response text or null
 */
export async function aiChatWithRetry(
  prompt: string,
  task = 'content-audit',
  maxRetries = 3
): Promise<string | null> {
  if (!checkBudget(task)) return null;
  _runCounter.count++;

  const tier = taskToTier(task);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const provider = await selectProvider();
      const result = await provider.chat({
        tier,
        systemPrompt: '',
        messages: [{ role: 'user', content: prompt }],
      });
      if (result?.text) return result.text;

      if (attempt < maxRetries) {
        const delay = attempt * 5000;
        console.log(`     Retrying in ${delay / 1000}s (attempt ${attempt}/${maxRetries})...`);
        await new Promise(r => setTimeout(r, delay));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      if (attempt < maxRetries) {
        console.log(`     Provider error: ${msg} — retrying in ${attempt * 5}s...`);
        await new Promise(r => setTimeout(r, attempt * 5000));
      } else {
        console.error(`     AI provider failed after ${maxRetries} attempts: ${msg}`);
      }
    }
  }

  return null;
}
