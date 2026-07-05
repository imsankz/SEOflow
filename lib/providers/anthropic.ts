/**
 * Anthropic (Claude) API provider.
 *
 * Direct API access via fetch — no SDK dependency to keep SeoFlow lightweight.
 */
import type { LLMChatInput, LLMChatResult, LLMProvider, ProviderAvailability } from './types';

const BASE_URL = 'https://api.anthropic.com/v1/messages';

/** Default model per tier */
const MODELS: Record<string, string> = {
  'synthesis': 'claude-3-5-sonnet-20241022',
  'routing': 'claude-3-5-haiku-20241022',
};

export const anthropicProvider: LLMProvider = {
  id: 'anthropic',
  name: 'Anthropic Claude (direct API)',
  authMode: 'api-key',

  async availability(): Promise<ProviderAvailability> {
    return {
      id: 'anthropic',
      name: 'Anthropic Claude (direct API)',
      authMode: 'api-key',
      installed: true,
      authed: !!process.env.ANTHROPIC_API_KEY,
    };
  },

  async chat(input: LLMChatInput): Promise<LLMChatResult | null> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;

    const model = input.model || MODELS[input.tier] || MODELS['synthesis'];
    const started = Date.now();

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 120_000);

      const messages = input.messages.map((m) => ({ role: m.role, content: m.content }));
      if (input.systemPrompt) {
        // Anthropic API uses top-level system param, not a system message
      }

      const body: any = {
        model,
        max_tokens: input.maxTokens ?? 4096,
        temperature: input.temperature ?? 0.5,
        messages,
        ...(input.systemPrompt ? { system: input.systemPrompt } : {}),
      };

      const res = await fetch(BASE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error(`     Anthropic HTTP ${res.status}: ${text.slice(0, 300)}`);
        return null;
      }

      const data = (await res.json()) as any;
      const text = data?.content?.[0]?.text;
      if (!text) return null;

      const costUsd =
        data.usage?.input_tokens && data.usage?.output_tokens
          ? (data.usage.input_tokens + data.usage.output_tokens) * 0.000003
          : undefined;

      return {
        text,
        costUsd,
        model,
        durationMs: Date.now() - started,
      };
    } catch (e) {
      console.error(`     Anthropic error: ${e instanceof Error ? e.message : 'Unknown'}`);
      return null;
    }
  },
};
