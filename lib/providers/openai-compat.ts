/**
 * OpenAI-compatible provider — talks to any OpenAI Chat Completions-shaped
 * endpoint (OpenAI itself, or a self-hosted/local gateway).
 *
 * Configure via:
 *   OPENAI_API_KEY   (required to activate this provider)
 *   OPENAI_BASE_URL  (optional, defaults to https://api.openai.com/v1)
 *   OPENAI_MODEL     (optional, defaults to gpt-4o-mini)
 *
 * Some gateways stream by default even with `stream: false` set, or ignore
 * the flag entirely. This provider tolerates both plain JSON responses and
 * SSE (`data: {...}`) responses by falling back to manual SSE parsing when
 * the body isn't valid JSON.
 */
import type { LLMChatInput, LLMChatResult, LLMProvider, ProviderAvailability } from './types';

function parseChatCompletion(raw: string): string | null {
  try {
    const data = JSON.parse(raw);
    return data?.choices?.[0]?.message?.content ?? null;
  } catch {
    // Fall back to SSE: concat streamed `delta.content` chunks.
    const lines = raw
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .filter((l) => l && l !== '[DONE]');

    let combined = '';
    for (const line of lines) {
      try {
        const chunk = JSON.parse(line);
        const delta = chunk?.choices?.[0]?.delta?.content ?? chunk?.choices?.[0]?.message?.content;
        if (delta) combined += delta;
      } catch {
        // skip malformed chunk
      }
    }
    return combined || null;
  }
}

export const openaiProvider: LLMProvider = {
  id: 'openai',
  name: 'OpenAI-compatible gateway',
  authMode: 'api-key',

  async availability(): Promise<ProviderAvailability> {
    return {
      id: 'openai',
      name: 'OpenAI-compatible gateway',
      authMode: 'api-key',
      installed: true,
      authed: !!process.env.OPENAI_API_KEY,
    };
  },

  async chat(input: LLMChatInput): Promise<LLMChatResult | null> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;

    const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const model = input.model || process.env.OPENAI_MODEL || 'gpt-4o-mini';

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 120_000);

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          stream: false,
          messages: [
            { role: 'system', content: input.systemPrompt },
            ...input.messages.map((m) => ({ role: m.role, content: m.content })),
          ],
          temperature: input.temperature ?? 0.5,
          max_tokens: input.maxTokens ?? 8192,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error(`     OpenAI-compatible gateway HTTP ${res.status}: ${text.slice(0, 300)}`);
        return null;
      }

      const raw = await res.text();
      const text = parseChatCompletion(raw);
      if (!text) return null;

      return { text };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      console.error(`     OpenAI-compatible gateway error: ${msg}`);
      return null;
    }
  },
};
