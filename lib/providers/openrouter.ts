/**
 * OpenRouter provider — access 300+ models via one API.
 *
 * Uses the OpenAI-compatible chat completions endpoint.
 */
import { getSiteUrl, loadConfig } from '../config';
import type { LLMChatInput, LLMChatResult, LLMProvider, ProviderAvailability } from './types';

const BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';

export const openrouterProvider: LLMProvider = {
  id: 'openrouter',
  name: 'OpenRouter (300+ models)',
  authMode: 'api-key',

  async availability(): Promise<ProviderAvailability> {
    return {
      id: 'openrouter',
      name: 'OpenRouter (300+ models)',
      authMode: 'api-key',
      installed: true,
      authed: !!process.env.OPENROUTER_API_KEY,
    };
  },

  async chat(input: LLMChatInput): Promise<LLMChatResult | null> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return null;

    let siteUrl = '';
    let siteName = '';
    try {
      siteUrl = getSiteUrl();
      siteName = (loadConfig() as any).siteName;
    } catch { /* config not loaded */ }

    const model = input.model ?? 'google/gemini-2.5-flash-001';

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 120_000);

      const res = await fetch(BASE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': siteUrl ? `https://${siteUrl}` : 'https://seoflow',
          'X-Title': siteName ? `${siteName} SeoFlow` : 'SeoFlow',
        },
        body: JSON.stringify({
          model,
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
        console.error(`     OpenRouter HTTP ${res.status}: ${text.slice(0, 300)}`);
        return null;
      }

      const data = (await res.json()) as any;
      const text = data?.choices?.[0]?.message?.content;
      if (!text) return null;

      return { text };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      console.error(`     OpenRouter error: ${msg}`);
      return null;
    }
  },
};
