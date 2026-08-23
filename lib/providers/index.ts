/**
 * Provider registry + auto-selector.
 *
 * Resolution order (first available wins):
 *   1. AI_PROVIDER env var if set (fails closed if unavailable)
 *   2. Auto-pick: claude-cli → codex-cli → gemini-cli → anthropic → openrouter → gemini
 *
 * The returned provider wraps fallback logic: if .chat() fails on the primary,
 * it automatically tries the next provider in the chain.
 */
import { anthropicProvider } from './anthropic';
import { claudeCliProvider } from './claude-cli';
import { codexCliProvider } from './codex-cli';
import { geminiCliProvider } from './gemini-cli';
import { openrouterProvider } from './openrouter';
import { geminiProvider } from './gemini';
import { openaiProvider } from './openai-compat';
import type { LLMProvider, ProviderAvailability, ProviderId, LLMChatInput, LLMChatResult } from './types';

const ALL: LLMProvider[] = [
  claudeCliProvider,
  codexCliProvider,
  geminiCliProvider,
  anthropicProvider,
  openrouterProvider,
  geminiProvider,
  openaiProvider,
];

export const providers: Record<string, LLMProvider> = {};
for (const p of ALL) {
  providers[p.id] = p;
}

const PREFERENCE_ORDER: ProviderId[] = [
  'claude-cli',
  'codex-cli',
  'gemini-cli',
  'anthropic',
  'openrouter',
  'gemini',
  'openai',
];

/** Survey every provider — status summary. */
export async function detectAll(): Promise<ProviderAvailability[]> {
  return Promise.all(ALL.map((p) => p.availability()));
}

/** Log available providers and current config to console. */
export async function logProviderStatus(): Promise<void> {
  const all = await detectAll();
  const anyAvailable = all.some(a => a.authed);

  if (!anyAvailable) {
    console.log('   ⚠️  No AI providers available. Set GEMINI_API_KEY, OPENROUTER_API_KEY, or ANTHROPIC_API_KEY.');
    return;
  }

  for (const a of all) {
    if (a.authed) {
      console.log(`   ✅ ${a.name}`);
    } else if (a.installed) {
      console.log(`   ⏭  ${a.name} — not authenticated`);
    } else {
      console.log(`   ⚪ ${a.name} — not installed (${a.error || 'check PATH'})`);
    }
  }
}

/**
 * Select the best available provider, with automatic fallback chain.
 *
 * Returns a wrapped provider that tries the selected provider first,
 * then falls through to the next best on failure.
 */
export async function selectProvider(): Promise<LLMProvider> {
  const preferred = process.env.AI_PROVIDER?.toLowerCase().trim() as ProviderId | undefined;
  const all = await detectAll();
  const byId = new Map(all.map((a) => [a.id, a] as const));
  const authedIds = all.filter(a => a.authed).map(a => a.id);

  // Determine the order of providers to try
  const order: ProviderId[] = [];

  if (preferred && providers[preferred]) {
    const av = byId.get(preferred);
    if (av?.authed) {
      order.push(preferred);
    }
  }

  // Add remaining authed providers in preference order
  for (const id of PREFERENCE_ORDER) {
    if (id !== preferred && byId.get(id)?.authed && !order.includes(id)) {
      order.push(id);
    }
  }

  if (order.length === 0) {
    throw new Error(
      'No AI provider available. Set GEMINI_API_KEY, OPENROUTER_API_KEY, or ANTHROPIC_API_KEY in your env / .seoflow/.env.',
    );
  }

  // Build fallback chain
  const primaryProvider = providers[order[0]];
  const fallbacks = order.slice(1).map(id => providers[id]).filter(Boolean);

  if (fallbacks.length === 0) {
    return primaryProvider; // Single provider, no fallback needed
  }

  // Return a wrapped provider with fallback
  return {
    id: primaryProvider.id,
    name: `${primaryProvider.name} + fallback`,
    authMode: primaryProvider.authMode,
    availability: () => primaryProvider.availability(),
    async chat(input: LLMChatInput): Promise<LLMChatResult | null> {
      for (const provider of [primaryProvider, ...fallbacks]) {
        try {
          const result = await provider.chat(input);
          if (result) return result;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.log(`     ⚠️  ${provider.name} failed (${msg.slice(0, 80)}), trying next...`);
        }
      }
      return null;
    },
  };
}

export type { LLMProvider, ProviderAvailability, ProviderId };
export type { LLMChatInput, LLMChatResult, LLMMessage } from './types';