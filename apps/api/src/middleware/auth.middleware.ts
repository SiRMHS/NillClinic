import type { Request, Response, NextFunction } from "express";
import { prisma } from "@jordan/db";
import { verifyJwt } from "../security/jwt.js";
import { SESSION_COOKIE, readCookie } from "../security/cookies.js";

export interface AuthUser {
  sub: string;
  email?: string;
  role?: string;
  permissions?: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Cached `User.tokenVersion` *and* the role's permission list, so neither
 * revocation nor an access check costs a database round trip on every request.
 *
 * Permissions are read from the database rather than trusted from the token:
 * a token issued before a role was edited still carries the old key list, and
 * re-reading them here means an access change takes effect within the TTL
 * instead of only after the user logs in again. The TTL is likewise the
 * worst-case delay before a logout or password change stops an issued token.
 */
const VERSION_TTL_MS = 30_000;
interface CachedIdentity {
  version: number;
  role: string | null;
  permissions: string[];
  expires: number;
}
const versionCache = new Map<string, CachedIdentity>();

async function currentIdentity(userId: string): Promise<CachedIdentity | null> {
  const cached = versionCache.get(userId);
  if (cached && cached.expires > Date.now()) return cached;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      tokenVersion: true,
      isActive: true,
      role: { select: { name: true, permissions: true } },
    },
  });
  if (!user || !user.isActive) return null;

  const identity: CachedIdentity = {
    version: user.tokenVersion,
    role: user.role?.name ?? null,
    permissions: user.role?.permissions ?? [],
    expires: Date.now() + VERSION_TTL_MS,
  };
  versionCache.set(userId, identity);
  return identity;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of versionCache) {
    if (entry.expires <= now) versionCache.delete(key);
  }
}, 60_000).unref?.();

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    // Cookie first: that is where the browser session lives now. The Bearer
    // header remains supported for API clients and scripts, which are not
    // CSRF-reachable because nothing attaches that header automatically.
    const cookieToken = readCookie(req, SESSION_COOKIE);
    const authHeader = req.headers.authorization;
    const token =
      cookieToken ?? (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);

    if (!token) {
      res.status(401).json({ error: "توکن احراز هویت یافت نشد" });
      return;
    }

    const payload = verifyJwt(token);

    const identity = await currentIdentity(payload.sub);
    if (identity === null) {
      res.status(401).json({ error: "کاربر یافت نشد یا غیرفعال است" });
      return;
    }
    if (typeof payload.v === "number" && payload.v !== identity.version) {
      res.status(401).json({ error: "نشست شما باطل شده است. دوباره وارد شوید" });
      return;
    }

    req.user = {
      sub: payload.sub,
      email: payload.email,
      role: identity.role ?? payload.role,
      permissions: identity.permissions,
    };

    next();
  } catch {
    res.status(401).json({ error: "توکن منقضی شده یا نامعتبر است" });
  }
}

/** Drops a user's cached identity so revocation takes effect immediately. */
export function invalidateTokenVersionCache(userId: string): void {
  versionCache.delete(userId);
}

/**
 * Drops every cached identity. Called after a role's permissions change, since
 * that edit affects every user holding the role and there is no cheap way to
 * name them here.
 */
export function invalidateAllIdentityCache(): void {
  versionCache.clear();
}
