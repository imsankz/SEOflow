/**
 * Gemini (Google) API provider.
 *
 * Uses the REST API directly — no SDK dependency.
 */
import type { LLMChatInput, LLMChatResult, LLMProvider, ProviderAvailability } from './types';

const GEMINI_MODEL = 'gemini-3.5-flash';

export const geminiProvider: LLMProvider = {
  id: 'gemini',
  name: 'Gemini 2.5 Flash (Google)',
  authMode: 'api-key',

  async availability(): Promise<ProviderAvailability> {
    return {
      id: 'gemini',
      name: 'Gemini 2.5 Flash (Google)',
      authMode: 'api-key',
      installed: true,
      authed: !!process.env.GEMINI_API_KEY,
    };
  },

  async chat(input: LLMChatInput): Promise<LLMChatResult | null> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;

    const model = input.model || GEMINI_MODEL;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 120_000);

      const parts: Array<{ text: string }> = [];
      if (input.systemPrompt) {
        parts.push({ text: `SYSTEM: ${input.systemPrompt}\n\n` });
      }
      for (const msg of input.messages) {
        parts.push({ text: `${msg.role === 'user' ? 'USER' : 'ASSISTANT'}: ${msg.content}\n\n` });
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature: input.temperature ?? 0.5,
            maxOutputTokens: input.maxTokens ?? 8192,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error(`     Gemini HTTP ${res.status}: ${text.slice(0, 300)}`);
        return null;
      }

      const data = (await res.json()) as any;
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        const reason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason || 'empty';
        console.error(`     Gemini blocked: ${reason}`);
        return null;
      }

      return { text };
    } catch (e) {
      console.error(`     Gemini error: ${e instanceof Error ? e.message : 'Unknown'}`);
      return null;
    }
  },
};
