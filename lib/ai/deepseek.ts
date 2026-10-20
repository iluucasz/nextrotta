/**
 * DeepSeek chat API (OpenAI-compatible), with function calling. The key comes from DEEPSEEK_API_KEY.
 */

const BASE_URL = 'https://api.deepseek.com';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

export class DeepSeekError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

export type ToolDefinition = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ChatUsage = { promptTokens: number; completionTokens: number };

export function isDeepSeekConfigured() {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

export async function chat(messages: ChatMessage[], tools: ToolDefinition[]) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new DeepSeekError('Assistente de IA não configurado: falta DEEPSEEK_API_KEY.', 503);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages, tools, temperature: 0.2, max_tokens: 2000 }),
      signal: controller.signal,
      cache: 'no-store',
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message = data?.error?.message || `DeepSeek respondeu ${response.status}.`;
      throw new DeepSeekError(message, response.status);
    }
    const choice = data?.choices?.[0];
    return {
      message: choice?.message as { content: string | null; tool_calls?: ToolCall[] },
      usage: { promptTokens: Number(data?.usage?.prompt_tokens ?? 0), completionTokens: Number(data?.usage?.completion_tokens ?? 0) } as ChatUsage,
    };
  } catch (error) {
    if (error instanceof DeepSeekError) throw error;
    if ((error as Error).name === 'AbortError') throw new DeepSeekError('O assistente demorou demais para responder. Tente de novo.', 504);
    throw new DeepSeekError('Não foi possível falar com o assistente agora. Tente de novo.', 502);
  } finally {
    clearTimeout(timeout);
  }
}
