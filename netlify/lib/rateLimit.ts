/**
 * A small fixed-window rate limiter kept in memory: at most `limit` requests
 * per key (the client IP) in each window of `windowMs`.
 *
 * Serverless functions can run in several instances, each with its own
 * memory, so this is a best-effort guard. In production, Netlify's built-in
 * per-IP rate limit (the `rateLimit` option in each function's config) is
 * the main protection; this one also works under `netlify dev`.
 */
export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Record one request for `key`. Returns false when the key is over the limit. */
  allow(key: string): boolean {
    const time = this.now();
    if (this.windows.size > 10_000) this.removeExpired(time);

    const window = this.windows.get(key);
    if (!window || time - window.start >= this.windowMs) {
      this.windows.set(key, { start: time, count: 1 });
      return true;
    }
    if (window.count >= this.limit) return false;
    window.count += 1;
    return true;
  }

  private removeExpired(time: number): void {
    for (const [key, window] of this.windows) {
      if (time - window.start >= this.windowMs) this.windows.delete(key);
    }
  }
}
