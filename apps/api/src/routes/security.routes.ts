import { Router } from "express";
import { z } from "zod";
import { prisma } from "@jordan/db";
import { requirePermission } from "../middleware/permission.middleware.js";

export const securityRouter = Router();

// Login history exposes who accessed the system and from where; restrict it to
// whoever manages users rather than everyone with a dashboard login.
securityRouter.use(requirePermission("settings.login-log"));

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  outcome: z.enum(["all", "success", "failed"]).default("all"),
  search: z.string().trim().min(1).max(200).optional(),
});

interface LoginRow {
  id: string;
  created_at: Date;
  resource: string | null;
  ip_address: string | null;
  metadata: Record<string, unknown> | null;
  user_id: string | null;
  full_name: string | null;
  user_email: string | null;
}

securityRouter.get("/login-log", async (req, res, next) => {
  try {
    const { limit, offset, outcome, search } = querySchema.parse(req.query);

    const where: string[] = [`a.action IN ('LOGIN', 'LOGOUT')`];
    const params: unknown[] = [];
    let i = 1;

    if (outcome === "success") where.push(`a.resource = 'login:success'`);
    if (outcome === "failed") where.push(`a.resource = 'login:failed'`);
    if (search) {
      where.push(`(a.metadata->>'email' ILIKE $${i} OR a.ip_address ILIKE $${i} OR u.full_name ILIKE $${i})`);
      params.push(`%${search}%`);
      i += 1;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;

    const [countRows, rows] = await Promise.all([
      prisma.$queryRawUnsafe<{ n: number }[]>(
        `SELECT COUNT(*)::int AS n FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id ${whereSql}`,
        ...params,
      ),
      prisma.$queryRawUnsafe<LoginRow[]>(
        `SELECT a.id, a.created_at, a.resource, a.ip_address, a.metadata, a.user_id,
                u.full_name, u.email AS user_email
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id
         ${whereSql}
         ORDER BY a.created_at DESC
         LIMIT $${i} OFFSET $${i + 1}`,
        ...params,
        limit,
        offset,
      ),
    ]);

    res.json({
      total: countRows[0]?.n ?? 0,
      entries: rows.map((r) => {
        const meta = (r.metadata ?? {}) as Record<string, unknown>;
        return {
          id: r.id,
          at: r.created_at,
          outcome:
            r.resource === "login:success" ? "success"
            : r.resource === "logout" ? "logout"
            : "failed",
          reason: typeof meta.reason === "string" ? meta.reason : null,
          email: typeof meta.email === "string" ? meta.email : (r.user_email ?? null),
          userAgent: typeof meta.userAgent === "string" ? meta.userAgent : null,
          ipAddress: r.ip_address,
          userId: r.user_id,
          fullName: r.full_name,
        };
      }),
    });
  } catch (e) {
    next(e);
  }
});

/** Headline numbers for the security page. */
securityRouter.get("/login-summary", async (_req, res, next) => {
  try {
    // Windows use `now() AT TIME ZONE 'UTC'`: created_at is a zoneless column
    // holding UTC, so a bare now() would be offset by the session timezone.
    const [rows] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT
         COUNT(*) FILTER (WHERE resource = 'login:success' AND created_at >= (now() AT TIME ZONE 'UTC') - interval '24 hours')::int AS success_24h,
         COUNT(*) FILTER (WHERE resource = 'login:failed'  AND created_at >= (now() AT TIME ZONE 'UTC') - interval '24 hours')::int AS failed_24h,
         COUNT(*) FILTER (WHERE resource = 'login:failed'  AND created_at >= (now() AT TIME ZONE 'UTC') - interval '7 days')::int   AS failed_7d,
         COUNT(DISTINCT ip_address) FILTER (WHERE resource = 'login:failed' AND created_at >= (now() AT TIME ZONE 'UTC') - interval '24 hours')::int AS failing_ips_24h,
         COUNT(DISTINCT user_id) FILTER (WHERE resource = 'login:success' AND created_at >= (now() AT TIME ZONE 'UTC') - interval '24 hours')::int   AS active_users_24h
       FROM audit_logs
       WHERE action = 'LOGIN'`,
    );

    // Addresses worth looking at: repeated failures and no success at all.
    const suspicious = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT ip_address,
              COUNT(*)::int AS failures,
              MAX(created_at) AS last_attempt,
              COUNT(DISTINCT metadata->>'email')::int AS distinct_emails
       FROM audit_logs
       WHERE action = 'LOGIN' AND resource = 'login:failed'
         AND created_at >= (now() AT TIME ZONE 'UTC') - interval '7 days'
         AND ip_address IS NOT NULL
       GROUP BY ip_address
       HAVING COUNT(*) >= 3
       ORDER BY COUNT(*) DESC
       LIMIT 10`,
    );

    const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

    res.json({
      success24h: num(rows?.success_24h),
      failed24h: num(rows?.failed_24h),
      failed7d: num(rows?.failed_7d),
      failingIps24h: num(rows?.failing_ips_24h),
      activeUsers24h: num(rows?.active_users_24h),
      suspiciousIps: suspicious.map((s) => ({
        ipAddress: String(s.ip_address),
        failures: num(s.failures),
        distinctEmails: num(s.distinct_emails),
        lastAttempt: s.last_attempt,
      })),
    });
  } catch (e) {
    next(e);
  }
});
