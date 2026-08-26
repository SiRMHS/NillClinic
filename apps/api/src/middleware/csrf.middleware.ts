import { timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { CSRF_COOKIE, CSRF_HEADER, readCookie } from "../security/cookies.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Kill switch, off by default. Set `CSRF_DISABLED=true` to let every
 * state-changing request through unchecked.
 *
 * This is a temporary escape hatch for a deployment where the client cannot
 * get the token to the server, not a setting to leave on: with it on, any page
 * the signed-in user visits can act as them, because the browser attaches the
 * session cookie on its own and the header that proves the request came from
 * our own page is no longer required. Sibling subdomains count too — they are
 * same-site, so `SameSite=Lax` does not hold them back either.
 */
const CSRF_DISABLED = process.env.CSRF_DISABLED === "true";
if (CSRF_DISABLED) {
  console.warn(
    "[security] CSRF protection is DISABLED (CSRF_DISABLED=true). " +
      "Every cookie-authenticated state-changing request is accepted unchecked.",
  );
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Double-submit CSRF check.
 *
 * The session now lives in an httpOnly cookie, which the browser attaches to
 * cross-site requests automatically — so a state-changing endpoint would
 * otherwise be reachable from any page the user visits. The client must echo
 * the readable `jc_csrf` cookie back in a header; an attacker on another origin
 * can cause the cookie to be *sent* but cannot *read* it to set the header.
 *
 * Requests authenticated with an `Authorization: Bearer` header are exempt:
 * nothing attaches that header automatically, so they are not CSRF-reachable.
 * Safe methods are exempt because they must not change state.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  if (CSRF_DISABLED) {
    next();
    return;
  }

  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    next();
    return;
  }

  const cookieToken = readCookie(req, CSRF_COOKIE);
  // No session cookie at all ⇒ unauthenticated; let requireAuth produce the 401.
  if (!cookieToken) {
    next();
    return;
  }

  const headerToken = req.headers[CSRF_HEADER];
  const provided = Array.isArray(headerToken) ? headerToken[0] : headerToken;

  if (!provided || !safeEqual(cookieToken, provided)) {
    res.status(403).json({
      error: "درخواست نامعتبر است (CSRF). صفحه را تازه کنید و دوباره تلاش کنید.",
    });
    return;
  }

  next();
}
