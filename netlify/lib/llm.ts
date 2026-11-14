import OpenAI, { APIError } from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { llmOutputJsonSchema, repairOutputJsonSchema } from "../../lib/schema";

export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

/**
 * Default model. Groq's free tier serves it, and it supports strict JSON
 * schema output (constrained decoding), so replies match our schema.
 */
export const DEFAULT_MODEL = "openai/gpt-oss-120b";

/** The JSON schema the answer must follow, and how long the answer may be. */
export interface ResponseFormat {
  name: string;
  schema: Record<string, unknown>;
  maxCompletionTokens: number;
}

/** The main analysis. */
export const MATCH_FORMAT: ResponseFormat = {
  name: "match_result",
  schema: llmOutputJsonSchema,
  maxCompletionTokens: 4_000,
};

/** The repair pass: a few short quotes, so a much smaller answer. */
export const REPAIR_FORMAT: ResponseFormat = {
  name: "quote_repair",
  schema: repairOutputJsonSchema,
  maxCompletionTokens: 1_500,
};

/**
 * Sends chat messages to the LLM and returns the raw text of its answer.
 * `format` defaults to MATCH_FORMAT.
 */
export type CompleteFn = (messages: ChatCompletionMessageParam[], format?: ResponseFormat) => Promise<string>;

/** Groq kept answering HTTP 429 (rate limited) after all retries. */
export class LlmBusyError extends Error {
  constructor() {
    super("LLM rate limit: still busy after retries");
    this.name = "LlmBusyError";
  }
}

/** Groq refused the request because it is larger than the tokens-per-minute limit. */
export class LlmTooLargeError extends Error {
  constructor() {
    super("LLM request larger than the tokens-per-minute limit");
    this.name = "LlmTooLargeError";
  }
}

/** The model's answer was not valid JSON for our schema. */
export class InvalidLlmOutputError extends Error {
  constructor() {
    super("LLM output was not valid JSON for the schema");
    this.name = "InvalidLlmOutputError";
  }
}

export interface RateLimitRetryOptions {
  /** Retries after the first attempt. The spec asks for 2. */
  maxRetries: number;
  /** Wait used when Groq sends no retry-after header; doubles each retry. */
  baseDelayMs: number;
  /** Never wait longer than this per retry, so we stay inside the function timeout. */
  maxDelayMs: number;
  sleep: (ms: number) => Promise<void>;
}

export const defaultRetryOptions: RateLimitRetryOptions = {
  maxRetries: 2,
  baseDelayMs: 2_000,
  maxDelayMs: 10_000,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

function isHttpStatus(error: unknown, status: number): error is APIError {
  return error instanceof APIError && error.status === status;
}

/** How long to wait before retry number `retry` (0-based), honouring Groq's retry-after header. */
export function retryDelayMs(error: APIError, retry: number, options: RateLimitRetryOptions): number {
  const header = error.headers?.get("retry-after");
  const seconds = header === null || header === undefined ? Number.NaN : Number(header);
  const wait = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : options.baseDelayMs * 2 ** retry;
  return Math.min(wait, options.maxDelayMs);
}

/**
 * Run `call`. On HTTP 429 wait and try again, up to `maxRetries` times,
 * then throw LlmBusyError. Any other error is thrown straight away.
 */
export async function withRateLimitRetry<T>(
  call: () => Promise<T>,
  options: RateLimitRetryOptions = defaultRetryOptions,
): Promise<T> {
  for (let retry = 0; ; retry++) {
    try {
      return await call();
    } catch (error) {
      if (!isHttpStatus(error, 429)) throw error;
      if (retry >= options.maxRetries) throw new LlmBusyError();
      await options.sleep(retryDelayMs(error, retry, options));
    }
  }
}

/** Create a CompleteFn that calls Groq through its OpenAI-compatible API. */
export function createGroqComplete(
  apiKey: string,
  model: string,
  retryOptions: RateLimitRetryOptions = defaultRetryOptions,
  /** Only for tests: replaces the network call. */
  fetchImpl?: typeof fetch,
): CompleteFn {
  // maxRetries: 0 turns off the SDK's own retries; withRateLimitRetry handles 429s.
  const client = new OpenAI({
    apiKey,
    baseURL: GROQ_BASE_URL,
    maxRetries: 0,
    timeout: 25_000,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
  const isGptOss = model.startsWith("openai/gpt-oss");

  // Every call, the main one and the repair pass alike, goes through the same 429 handling.
  return (messages, format = MATCH_FORMAT) =>
    withRateLimitRetry(async () => {
      try {
        const completion = await client.chat.completions.create({
          model,
          messages,
          temperature: 0,
          max_completion_tokens: format.maxCompletionTokens,
          response_format: {
            type: "json_schema",
            json_schema: { name: format.name, strict: true, schema: format.schema },
          },
          // gpt-oss models think before answering; "low" keeps that short, which saves tokens.
          ...(isGptOss ? { reasoning_effort: "low" as const } : {}),
        });
        return completion.choices[0]?.message?.content ?? "";
      } catch (error) {
        if (isHttpStatus(error, 413)) throw new LlmTooLargeError();
        // Groq answers 400 "json_validate_failed" when generated JSON does not fit the schema.
        if (isHttpStatus(error, 400) && error.code === "json_validate_failed") throw new InvalidLlmOutputError();
        throw error;
      }
    }, retryOptions);
}
