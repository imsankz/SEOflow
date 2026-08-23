/**
 * Unified LLM provider abstraction for SeoFlow.
 *
 * Inspired by SEO Office's provider system but simplified for CLI use.
 * All providers share one interface — callers never know which backend resolved the request.
 */

export type ProviderId = 'gemini' | 'openrouter' | 'anthropic' | 'claude-cli' | 'codex-cli' | 'gemini-cli' | 'openai';

export type AuthMode = 'api-key' | 'subscription';

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMChatInput {
  /** 'synthesis' → best model, 'routing' → fastest/cheapest */
  tier: 'synthesis' | 'routing';
  /** Optional explicit model override */
  model?: string;
  systemPrompt: string;
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Hard timeout in ms. Default: 5 minutes. */
  timeoutMs?: number;
  /** Abort signal */
  signal?: AbortSignal;
}

export interface LLMChatResult {
  /** The model's text response */
  text: string;
  /** Best-effort cost in USD */
  costUsd?: number;
  /** Token counts when known */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  /** Which model answered */
  model?: string;
  /** Wall-clock duration of the call */
  durationMs?: number;
}

/** Typed error for provider failures */
export class LLMProviderError extends Error {
  constructor(
    message: string,
    public readonly code: 'rate_limited' | 'upstream_unavailable' | 'timeout' | 'auth' | 'invalid_request' | 'overloaded' | 'unknown',
    public readonly status: number,
  ) {
    super(message);
    this.name = 'LLMProviderError';
  }
}

/** Provider availability — cheap "are you ready?" check */
export interface ProviderAvailability {
  id: ProviderId;
  name: string;
  authMode: AuthMode;
  /** CLI/SDK present on this machine? */
  installed: boolean;
  /** Key set or CLI logged in? */
  authed: boolean;
  /** Version string if known */
  version?: string;
  error?: string;
}

/** Main provider interface */
export interface LLMProvider {
  readonly id: ProviderId;
  readonly name: string;
  readonly authMode: AuthMode;

  /** Quick readiness check */
  availability(): Promise<ProviderAvailability>;

  /** Do the chat call. Throws or returns null on failure. */
  chat(input: LLMChatInput): Promise<LLMChatResult | null>;
}
