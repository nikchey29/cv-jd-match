import { DEFAULT_MODEL } from "./llm";

export interface LlmConfig {
  apiKey: string;
  model: string;
}

/** Read the LLM settings from environment variables. Null when the key is missing. */
export function getLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig | null {
  const apiKey = env.GROQ_API_KEY?.trim();
  if (!apiKey) return null;
  const model = env.LLM_MODEL?.trim() || DEFAULT_MODEL;
  return { apiKey, model };
}
