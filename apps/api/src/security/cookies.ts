import type { Request, Response } from "express";

/**
 * Minimal cookie read/write.
 *
 * Express 5 ships no cookie parser and the app has no `cookie-parser`
 * dependency; these two functions are all the auth flow needs, so a dependency
 * (and the install step it would force on every deploy) is not worth it.
 */

export const SESSION_COOKIE = "jc_session";
export const CSRF_COOKIE = "jc_csrf";
export const CSRF_HEADER = "x-csrf-token";

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}

interface CookieOptions {
  maxAgeSeconds: number;
  /** false for the CSRF token, which the browser must be able to read. */
  httpOnly?: boolean;
}

/**
 * `Secure` is set whenever we are not on plain-HTTP localhost, and SameSite is
 * `Lax` rather than `Strict` so that following a link into the dashboard from
 * an external page (e.g. an email) does not land the user on a logged-out
 * screen. State-changing requests are protected by the CSRF token, not by
 * SameSite alone.
 */
function serialize(name: string, value: string, opts: CookieOptions): string {
  const secure = process.env.NODE_ENV === "production" || process.env.COOKIE_SECURE === "true";
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${opts.maxAgeSeconds}`,
    "SameSite=Lax",
  ];
  if (opts.httpOnly !== false) parts.push("HttpOnly");
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function setAuthCookies(
  res: Response,
  opts: { token: string; csrfToken: string; maxAgeSeconds: number },
): void {
  res.append("Set-Cookie", serialize(SESSION_COOKIE, opts.token, { maxAgeSeconds: opts.maxAgeSeconds }));
  res.append(
    "Set-Cookie",
    // Readable by JS on purpose: the double-submit pattern needs the client to
    // echo this value back in a header.
    serialize(CSRF_COOKIE, opts.csrfToken, { maxAgeSeconds: opts.maxAgeSeconds, httpOnly: false }),
  );
}

export function clearAuthCookies(res: Response): void {
  res.append("Set-Cookie", serialize(SESSION_COOKIE, "", { maxAgeSeconds: 0 }));
  res.append("Set-Cookie", serialize(CSRF_COOKIE, "", { maxAgeSeconds: 0, httpOnly: false }));
}
