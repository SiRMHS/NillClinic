import { randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "@jordan/db";
import bcrypt from "bcryptjs";
import { signJwt } from "../security/jwt.js";
import {
  CSRF_COOKIE,
  clearAuthCookies,
  readCookie,
  setAuthCookies,
  setCsrfCookie,
} from "../security/cookies.js";
import { requireAuth, invalidateTokenVersionCache } from "../middleware/auth.middleware.js";
import { authRateLimit } from "../middleware/rate-limit.middleware.js";
import { expandPermissions } from "../lib/permissions.js";

export const authRouter = Router();

/** Failures against one account before it is locked. */
const MAX_ACCOUNT_ATTEMPTS = 5;
/**
 * Failures from one address before the address is locked. Deliberately much
 * higher than the per-account limit: clinic staff share a single office IP, so
 * an IP threshold of 5 would let one person mistyping their password lock out
 * everyone else. This limit exists to stop password-spraying across many
 * accounts, which the per-account counter alone would never notice.
 */
const MAX_IP_ATTEMPTS = 20;
const LOCKOUT_MINUTES = 15;
const SESSION_SECONDS = 60 * 60 * 8; // 8h — shorter than the old 24h

/**
 * A real bcrypt hash of a value nobody can log in with.
 *
 * An unknown email used to return before any hashing happened, so a wrong
 * address answered measurably faster than a wrong password — a timing oracle
 * that lets an attacker enumerate valid accounts. Every failed login now costs
 * one bcrypt comparison regardless of why it failed.
 */
const DUMMY_HASH = bcrypt.hashSync(randomBytes(32).toString("hex"), 10);

const loginSchema = z.object({
  email: z.string().trim().min(1, "ایمیل را وارد کنید").max(200).toLowerCase(),
  password: z.string().min(1, "رمز عبور را وارد کنید").max(200),
});

function clientIp(req: { headers: Record<string, unknown>; socket: { remoteAddress?: string } }): string {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = typeof forwarded === "string" ? forwarded : req.socket.remoteAddress;
  return (raw ?? "unknown").split(",")[0]?.trim() ?? "unknown";
}

function userAgent(req: { headers: Record<string, unknown> }): string {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" ? ua.slice(0, 300) : "unknown";
}

/**
 * Failed attempts are counted from the audit log rather than an in-process Map.
 * The old counter reset on every deploy or restart and was invisible to any
 * second instance, so the lockout could be cleared simply by waiting for a
 * restart. The `[action, createdAt]` index already exists for this shape.
 */
async function recentFailures(
  email: string,
  ip: string,
): Promise<{ account: number; ip: number }> {
  // The cutoff is computed in SQL as `now() AT TIME ZONE 'UTC'`, NOT from a JS
  // Date and NOT from a bare `now()`.
  //
  // `audit_logs.created_at` is `timestamp` (no zone) and Prisma writes UTC into
  // it, while this database's session zone is Asia/Tehran. A bare `now()` is
  // therefore 3.5 hours ahead of every stored row, and a bound JS Date is
  // converted the same way — both made this window match *nothing*, so the
  // lockout counted zero failures forever and silently protected nobody.
  const rows = await prisma.$queryRawUnsafe<{ account: number; ip: number }[]>(
    `SELECT COUNT(*) FILTER (WHERE metadata->>'email' = $1)::int AS account,
            COUNT(*) FILTER (WHERE ip_address = $2)::int         AS ip
     FROM audit_logs
     WHERE action = 'LOGIN'
       AND resource = 'login:failed'
       AND created_at >= (now() AT TIME ZONE 'UTC') - ($3 || ' minutes')::interval`,
    email,
    ip,
    String(LOCKOUT_MINUTES),
  );
  return { account: rows[0]?.account ?? 0, ip: rows[0]?.ip ?? 0 };
}

async function recordLogin(opts: {
  userId?: string;
  success: boolean;
  email: string;
  ip: string;
  ua: string;
  reason?: string;
}) {
  await prisma.auditLog
    .create({
      data: {
        userId: opts.userId,
        action: "LOGIN",
        resource: opts.success ? "login:success" : "login:failed",
        ipAddress: opts.ip,
        metadata: {
          email: opts.email,
          userAgent: opts.ua,
          ...(opts.reason ? { reason: opts.reason } : {}),
        },
      },
    })
    .catch(() => {
      // Never let audit writes break authentication.
    });
}

authRouter.post("/login", authRateLimit, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    const ip = clientIp(req);
    const ua = userAgent(req);

    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "ورودی نامعتبر" });
      return;
    }
    const { email, password } = parsed.data;

    const failures = await recentFailures(email, ip);
    const accountLocked = failures.account >= MAX_ACCOUNT_ATTEMPTS;
    const ipLocked = failures.ip >= MAX_IP_ATTEMPTS;

    if (accountLocked || ipLocked) {
      await recordLogin({
        success: false,
        email,
        ip,
        ua,
        reason: accountLocked ? "locked_out_account" : "locked_out_ip",
      });
      res.status(429).json({
        error: `به دلیل تلاش‌های ناموفق، ورود موقتاً قفل شده است. ${LOCKOUT_MINUTES} دقیقه دیگر تلاش کنید.`,
      });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });

    // Always spend the same work: compare against the real hash when we have
    // one, against the dummy otherwise.
    const passwordOk = await bcrypt.compare(password, user?.password ?? DUMMY_HASH);
    const canLogin = Boolean(user && user.password && user.isActive && passwordOk);

    if (!canLogin) {
      await recordLogin({
        userId: user?.id,
        success: false,
        email,
        ip,
        ua,
        reason: !user ? "unknown_email" : !user.isActive ? "inactive" : "wrong_password",
      });
      const remaining = Math.max(0, MAX_ACCOUNT_ATTEMPTS - (failures.account + 1));
      res.status(401).json({
        // Deliberately identical for every failure cause so the response cannot
        // be used to check whether an address exists.
        error: "ایمیل یا رمز عبور اشتباه است",
        ...(remaining <= 2 ? { attemptsRemaining: remaining } : {}),
      });
      return;
    }

    const activeUser = user!;
    const permissions = activeUser.role?.permissions ?? [];
    const token = signJwt({
      sub: activeUser.id,
      email: activeUser.email,
      role: activeUser.role?.name ?? "viewer",
      permissions,
      v: activeUser.tokenVersion,
    });
    const csrfToken = randomBytes(32).toString("hex");

    setAuthCookies(res, { token, csrfToken, maxAgeSeconds: SESSION_SECONDS });

    await prisma.user
      .update({ where: { id: activeUser.id }, data: { lastLoginAt: new Date() } })
      .catch(() => {});
    await recordLogin({ userId: activeUser.id, success: true, email, ip, ua });

    res.json({
      // Returned for the double-submit header. The session itself is in an
      // httpOnly cookie and is deliberately NOT in this payload.
      csrfToken,
      user: {
        id: activeUser.id,
        email: activeUser.email,
        fullName: activeUser.fullName,
        role: activeUser.role?.label ?? "مشاهده‌کننده",
        // Expanded, not raw: the web app checks with a plain `includes`, so the
        // rule that "analytics also grants analytics.medical" has to be applied
        // here rather than duplicated in the client.
        permissions: [...expandPermissions(permissions)],
      },
    });
  } catch (e) {
    next(e);
  }
});

/** Invalidates every token issued to this user, not just this browser's copy. */
authRouter.post("/logout", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user?.sub;
    if (userId) {
      await prisma.user
        .update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } })
        .catch(() => {});
      // Without this the old version stays cached for up to the TTL, leaving a
      // just-revoked token briefly usable.
      invalidateTokenVersionCache(userId);
      await prisma.auditLog
        .create({
          data: {
            userId,
            action: "LOGOUT",
            resource: "logout",
            ipAddress: clientIp(req),
            metadata: { userAgent: userAgent(req) },
          },
        })
        .catch(() => {});
    }
    clearAuthCookies(res);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/**
 * Hands the current CSRF token back to an authenticated client.
 *
 * The double-submit pattern normally has the page read the `jc_csrf` cookie
 * itself, but that only works when the cookie is visible to the page's own
 * JavaScript. When the API lives on a different host than the page — a
 * sibling subdomain, say — the browser still *sends* the cookie (same site)
 * while `document.cookie` cannot *read* it, and every state-changing request
 * would fail the check with no way for the client to recover. This endpoint
 * closes that gap: it is a safe method, requires the session cookie, and only
 * ever discloses the token to the session that owns it.
 */
authRouter.get("/csrf", requireAuth, (req, res) => {
  let csrfToken = readCookie(req, CSRF_COOKIE);
  if (!csrfToken) {
    csrfToken = randomBytes(32).toString("hex");
    setCsrfCookie(res, csrfToken, SESSION_SECONDS);
  }
  res.json({ csrfToken });
});

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.sub },
      include: { role: true },
    });

    if (!user || !user.isActive) {
      clearAuthCookies(res);
      res.status(401).json({ error: "کاربر یافت نشد یا غیرفعال است" });
      return;
    }

    res.json({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role?.label ?? "مشاهده‌کننده",
      permissions: [...expandPermissions(user.role?.permissions ?? [])],
      lastLoginAt: user.lastLoginAt,
    });
  } catch (e) {
    next(e);
  }
});
