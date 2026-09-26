import "server-only";

/**
 * One OpenAI-compatible endpoint for every server-side model call. Env:
 * OPENAI_API_KEY (or LLM_API_KEY), LLM_BASE_URL (default OpenAI) and
 * LLM_MODEL (default gpt-4o-mini).
 */
export const llm = {
  baseUrl: (process.env.LLM_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, ""),
  apiKey: process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
  model: process.env.LLM_MODEL ?? "gpt-4o-mini",
};

export const llmReady = () => !!llm.apiKey;

export class LlmError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

/** One chat completion, not streamed. */
export async function complete({ system, user, maxTokens = 500, temperature = 0.2, json = false }: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  /** Ask for a single JSON object back. */
  json?: boolean;
}) {
  if (!llmReady()) throw new LlmError("Add OPENAI_API_KEY to .env.local and restart the dev server.", 503);
  let res: Response;
  try {
    res = await fetch(`${llm.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${llm.apiKey}` },
      body: JSON.stringify({
        model: llm.model,
        max_tokens: maxTokens,
        temperature,
        ...(json ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    throw new LlmError(`Model endpoint unreachable: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) throw new LlmError(`Model endpoint error ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[]; model?: string };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new LlmError("The model returned an empty answer.");
  return { text, model: data.model ?? llm.model };
}
