import { describe, expect, it } from "vitest";
import { FixedWindowRateLimiter } from "../netlify/lib/rateLimit";

describe("FixedWindowRateLimiter", () => {
  it("allows up to the limit, then blocks until the window ends", () => {
    let time = 0;
    const limiter = new FixedWindowRateLimiter(2, 60_000, () => time);
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("a")).toBe(false);
    time = 60_000;
    expect(limiter.allow("a")).toBe(true);
  });

  it("counts each key separately", () => {
    const limiter = new FixedWindowRateLimiter(1, 60_000, () => 0);
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("b")).toBe(true);
    expect(limiter.allow("a")).toBe(false);
  });
});
