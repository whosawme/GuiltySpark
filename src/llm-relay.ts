/**
 * LLM Relay — thin forwarding layer to LLM provider APIs.
 *
 * Intentionally thin: does not inspect or modify content.
 * Decouples provider-specific API shapes from the rest of the system.
 *
 * Currently supports: Anthropic (claude-*), OpenAI-compatible APIs.
 */

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface RelayRequest {
  provider: 'anthropic' | 'openai' | 'openai-compatible';
  model: string;
  messages: Message[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  apiKey: string;
  baseUrl?: string; // for openai-compatible providers
}

export interface RelayResponse {
  content: string;
  model: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export async function relayToLLM(request: RelayRequest): Promise<RelayResponse> {
  switch (request.provider) {
    case 'anthropic':
      return relayToAnthropic(request);
    case 'openai':
    case 'openai-compatible':
      return relayToOpenAI(request);
    default:
      throw new Error(`Unsupported provider: ${request.provider}`);
  }
}

async function relayToAnthropic(request: RelayRequest): Promise<RelayResponse> {
  const body = {
    model: request.model,
    max_tokens: request.maxTokens ?? 4096,
    temperature: request.temperature ?? 0.7,
    system: request.systemPrompt,
    messages: request.messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role, content: m.content })),
  };

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': request.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Anthropic API error ${resp.status}: ${err}`);
  }

  const data = await resp.json() as {
    content: Array<{ type: string; text: string }>;
    model: string;
    usage: { input_tokens: number; output_tokens: number };
  };

  return {
    content: data.content.filter(b => b.type === 'text').map(b => b.text).join(''),
    model: data.model,
    usage: {
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
    },
  };
}

async function relayToOpenAI(request: RelayRequest): Promise<RelayResponse> {
  const baseUrl = request.baseUrl ?? 'https://api.openai.com';
  const messages = request.systemPrompt
    ? [{ role: 'system' as const, content: request.systemPrompt }, ...request.messages]
    : request.messages;

  const body = {
    model: request.model,
    messages,
    max_tokens: request.maxTokens ?? 4096,
    temperature: request.temperature ?? 0.7,
  };

  const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${request.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI API error ${resp.status}: ${err}`);
  }

  const data = await resp.json() as {
    choices: Array<{ message: { content: string } }>;
    model: string;
    usage: { prompt_tokens: number; completion_tokens: number };
  };

  return {
    content: data.choices[0]?.message?.content ?? '',
    model: data.model,
    usage: {
      inputTokens: data.usage.prompt_tokens,
      outputTokens: data.usage.completion_tokens,
    },
  };
}
