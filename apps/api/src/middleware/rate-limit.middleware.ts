import type { Request, Response, NextFunction } from "express";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 20;

/** Generic fixed-window limiter keyed by client IP. */
function createRateLimit(opts: { windowMs: number; max: number; message: string; prefix: string }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = (req.headers["x-forwarded-for"] as string || req.socket.remoteAddress || "unknown").split(",")[0]?.trim() ?? "unknown";
    const key = `${opts.prefix}:${ip}`;
    const now = Date.now();

    let entry = store.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + opts.windowMs };
      store.set(key, entry);
    }
    entry.count++;

    res.setHeader("X-RateLimit-Limit", String(opts.max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, opts.max - entry.count)));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > opts.max) {
      res.setHeader("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      res.status(429).json({ error: opts.message });
      return;
    }
    next();
  };
}

/**
 * Login/logout limiter. The per-account lockout in auth.routes stops password
 * guessing against one user; this stops a single host hammering many accounts,
 * which that lockout would never trigger.
 */
export const authRateLimit = createRateLimit({
  prefix: "auth",
  windowMs: 60_000,
  max: 10,
  message: "تلاش بیش از حد برای ورود. یک دقیقه دیگر تلاش کنید",
});

/** Broad backstop for the rest of the API. */
export const apiRateLimit = createRateLimit({
  prefix: "api",
  windowMs: 60_000,
  max: 300,
  message: "درخواست بیش از حد مجاز. لطفاً کمی بعد تلاش کنید",
});

export function webhookRateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = (req.headers["x-forwarded-for"] as string || req.socket.remoteAddress || "unknown").split(",")[0]?.trim() ?? "unknown";
  const now = Date.now();

  let entry = store.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    store.set(ip, entry);
  }

  entry.count++;

  res.setHeader("X-RateLimit-Limit", String(MAX_REQUESTS));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, MAX_REQUESTS - entry.count)));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

  if (entry.count > MAX_REQUESTS) {
    res.status(429).json({ error: "درخواست بیش از حد مجاز. لطفاً بعداً تلاش کنید" });
    return;
  }

  next();
}

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
}, 300_000);
