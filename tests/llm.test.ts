import { APIError } from "openai";
import { describe, expect, it, vi } from "vitest";
import { LlmBusyError, retryDelayMs, withRateLimitRetry, type RateLimitRetryOptions } from "../netlify/lib/llm";

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
