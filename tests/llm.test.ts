import { APIError } from "openai";
import { describe, expect, it, vi } from "vitest";
import {
  createGroqComplete,
  defaultRetryOptions,
  LlmBusyError,
  MATCH_FORMAT,
  REPAIR_FORMAT,
  retryDelayMs,
  withRateLimitRetry,
  type RateLimitRetryOptions,
} from "../netlify/lib/llm";

function rateLimitError(retryAfter?: string): APIError {
  const headers = new Headers(retryAfter === undefined ? {} : { "retry-after": retryAfter });
  return new APIError(429, { message: "rate limited" }, "rate limited", headers);
}

function options(): RateLimitRetryOptions & { sleep: ReturnType<typeof vi.fn> } {
  return { maxRetries: 2, baseDelayMs: 2_000, maxDelayMs: 10_000, sleep: vi.fn(async () => {}) };
}

describe("withRateLimitRetry", () => {
  it("returns the result when the first call succeeds", async () => {
    const opts = options();
    await expect(withRateLimitRetry(async () => "ok", opts)).resolves.toBe("ok");
    expect(opts.sleep).not.toHaveBeenCalled();
  });

  it("retries after a 429 and then succeeds", async () => {
    const opts = options();
    const call = vi.fn().mockRejectedValueOnce(rateLimitError("1")).mockResolvedValueOnce("ok");
    await expect(withRateLimitRetry(call, opts)).resolves.toBe("ok");
    expect(call).toHaveBeenCalledTimes(2);
    expect(opts.sleep).toHaveBeenCalledWith(1_000);
  });

  it("gives up with LlmBusyError after 2 retries (3 calls in total)", async () => {
    const opts = options();
    const call = vi.fn().mockRejectedValue(rateLimitError());
    await expect(withRateLimitRetry(call, opts)).rejects.toBeInstanceOf(LlmBusyError);
    expect(call).toHaveBeenCalledTimes(3);
    expect(opts.sleep).toHaveBeenCalledTimes(2);
  });

  it("does not retry other errors", async () => {
    const opts = options();
    const call = vi.fn().mockRejectedValue(new APIError(500, {}, "server error", new Headers()));
    await expect(withRateLimitRetry(call, opts)).rejects.toMatchObject({ status: 500 });
    expect(call).toHaveBeenCalledTimes(1);
  });
});

describe("retryDelayMs", () => {
  it("uses the retry-after header in seconds", () => {
    expect(retryDelayMs(rateLimitError("3"), 0, options())).toBe(3_000);
  });

  it("falls back to exponential backoff without a header", () => {
    expect(retryDelayMs(rateLimitError(), 0, options())).toBe(2_000);
    expect(retryDelayMs(rateLimitError(), 1, options())).toBe(4_000);
  });

  it("never waits longer than maxDelayMs", () => {
    expect(retryDelayMs(rateLimitError("3600"), 0, options())).toBe(10_000);
  });
});

describe("createGroqComplete (fake fetch, no network)", () => {
  const completion = (content: string) =>
    new Response(
      JSON.stringify({
        id: "c1",
        object: "chat.completion",
        created: 0,
        model: "openai/gpt-oss-120b",
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  const tooMany = () =>
    new Response(JSON.stringify({ error: { message: "rate limited" } }), {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": "1" },
    });

  function setup(...responses: Array<() => Response>) {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return responses.shift()!();
    });
    const sleep = vi.fn(async () => {});
    const complete = createGroqComplete("test-key", "openai/gpt-oss-120b", { ...defaultRetryOptions, sleep }, fetchImpl as unknown as typeof fetch);
    return { complete, bodies, sleep };
  }

  it("uses the match schema by default", async () => {
    const { complete, bodies } = setup(() => completion("{}"));
    expect(await complete([{ role: "user", content: "hi" }])).toBe("{}");
    const format = bodies[0]!.response_format as { json_schema: { name: string; strict: boolean } };
    expect(format.json_schema.name).toBe(MATCH_FORMAT.name);
    expect(format.json_schema.strict).toBe(true);
    expect(bodies[0]!.max_completion_tokens).toBe(MATCH_FORMAT.maxCompletionTokens);
  });

  it("sends the repair schema and its smaller token limit for the repair pass", async () => {
    const { complete, bodies } = setup(() => completion('{"answers":[]}'));
    await complete([{ role: "user", content: "hi" }], REPAIR_FORMAT);
    const format = bodies[0]!.response_format as { json_schema: { name: string; schema: unknown } };
    expect(format.json_schema.name).toBe("quote_repair");
    expect(format.json_schema.schema).toEqual(REPAIR_FORMAT.schema);
    expect(bodies[0]!.max_completion_tokens).toBe(1_500);
  });

  it("retries a rate-limited repair call using retry-after, like the main call", async () => {
    const { complete, sleep } = setup(tooMany, () => completion('{"answers":[]}'));
    expect(await complete([{ role: "user", content: "hi" }], REPAIR_FORMAT)).toBe('{"answers":[]}');
    expect(sleep).toHaveBeenCalledWith(1_000);
  });

  it("gives up with LlmBusyError after 2 retries", async () => {
    const { complete } = setup(tooMany, tooMany, tooMany);
    await expect(complete([{ role: "user", content: "hi" }], REPAIR_FORMAT)).rejects.toBeInstanceOf(LlmBusyError);
  });
});
