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
  /** Widens the cookie to sibling subdomains; see `csrfCookieDomain`. */
  domain?: string;
}

/**
 * Set when the dashboard and the API are on different hosts of one domain
 * (`dash.example.com` calling `api.example.com`). Without it the CSRF cookie is
 * host-only on the API's hostname: the browser still sends it — same site — but
 * the dashboard's JavaScript cannot read it, so it cannot echo it back in the
 * header and every state-changing request fails the double-submit check.
 *
 * Only the CSRF token is widened. The session cookie stays host-only on the
 * API's hostname, so a widened scope never puts the session itself within reach
 * of another subdomain; the CSRF token is not a credential and is meant to be
 * readable anyway.
 *
 * Format: the shared suffix, e.g. `COOKIE_DOMAIN=.example.com`.
 */
function csrfCookieDomain(): string | undefined {
  const domain = process.env.COOKIE_DOMAIN?.trim();
  return domain ? domain : undefined;
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
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
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
    serialize(CSRF_COOKIE, opts.csrfToken, {
      maxAgeSeconds: opts.maxAgeSeconds,
      httpOnly: false,
      domain: csrfCookieDomain(),
    }),
  );
  dropHostOnlyCsrfCookie(res);
}

/**
 * Deletes a host-only `jc_csrf` left over from before `COOKIE_DOMAIN` was set.
 *
 * It and the widened cookie are two distinct cookies with the same name, so the
 * browser would send both and the server would compare the header against
 * whichever came first — a mismatch the client has no way to see or fix.
 */
function dropHostOnlyCsrfCookie(res: Response): void {
  if (!csrfCookieDomain()) return;
  res.append("Set-Cookie", serialize(CSRF_COOKIE, "", { maxAgeSeconds: 0, httpOnly: false }));
}

/**
 * Re-issues only the readable CSRF cookie, leaving the session cookie alone.
 * Used by the token endpoint that lets a client recover when it cannot read
 * the cookie itself (the API on a different host than the page, a cookie the
 * browser declined to store) — the value handed back is the one the
 * double-submit check will compare against.
 */
export function setCsrfCookie(res: Response, csrfToken: string, maxAgeSeconds: number): void {
  res.append(
    "Set-Cookie",
    serialize(CSRF_COOKIE, csrfToken, { maxAgeSeconds, httpOnly: false, domain: csrfCookieDomain() }),
  );
  dropHostOnlyCsrfCookie(res);
}

export function clearAuthCookies(res: Response): void {
  res.append("Set-Cookie", serialize(SESSION_COOKIE, "", { maxAgeSeconds: 0 }));
  // Both scopes: whichever of the two the browser is holding has to go.
  res.append("Set-Cookie", serialize(CSRF_COOKIE, "", { maxAgeSeconds: 0, httpOnly: false }));
  if (csrfCookieDomain()) {
    res.append(
      "Set-Cookie",
      serialize(CSRF_COOKIE, "", { maxAgeSeconds: 0, httpOnly: false, domain: csrfCookieDomain() }),
    );
  }
}
