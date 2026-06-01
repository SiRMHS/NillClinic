import { Router } from "express";
import { prisma } from "@jordan/db";
import bcrypt from "bcryptjs";
import { signJwt, verifyJwt } from "../security/jwt.js";

export const authRouter = Router();

const loginAttempts = new Map<string, { count: number; lockedUntil: number }>();

function cleanupLoginAttempts() {
  const now = Date.now();
  for (const [key, entry] of loginAttempts) {
    if (now > entry.lockedUntil) loginAttempts.delete(key);
  }
}
setInterval(cleanupLoginAttempts, 60_000);

const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000;

authRouter.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const ip = (req.headers["x-forwarded-for"] as string || req.socket.remoteAddress || "unknown").split(",")[0]?.trim() ?? "unknown";
    const lockKey = `${ip}:${email?.toLowerCase()}`;

    if (!email || !password) {
      res.status(400).json({ error: "ایمیل و رمز عبور را وارد کنید" });
      return;
    }

    // Check rate limiting
    const attempt = loginAttempts.get(lockKey);
    if (attempt && Date.now() < attempt.lockedUntil) {
      const remaining = Math.ceil((attempt.lockedUntil - Date.now()) / 1000 / 60);
      res.status(429).json({
        error: `حساب شما به دلیل تلاش‌های ناموفق قفل شده است. ${remaining} دقیقه دیگر تلاش کنید`,
      });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { role: true },
    });

    if (!user || !user.password || !user.isActive) {
      // Record failed attempt
      const entry = loginAttempts.get(lockKey) || { count: 0, lockedUntil: 0 };
      entry.count++;
      if (entry.count >= MAX_ATTEMPTS) {
        entry.lockedUntil = Date.now() + LOCKOUT_DURATION;
      } else {
        entry.lockedUntil = Date.now() + 1000;
      }
      loginAttempts.set(lockKey, entry);

      await prisma.auditLog.create({
        data: {
          action: "LOGIN",
          resource: `login:failed`,
          ipAddress: ip,
          metadata: { email: email.toLowerCase(), reason: "invalid_credentials", attempts: entry.count },
        },
      });

      res.status(401).json({ error: "ایمیل یا رمز عبور اشتباه است" });
      return;
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      const entry = loginAttempts.get(lockKey) || { count: 0, lockedUntil: 0 };
      entry.count++;
      if (entry.count >= MAX_ATTEMPTS) {
        entry.lockedUntil = Date.now() + LOCKOUT_DURATION;
      } else {
        entry.lockedUntil = Date.now() + 1000;
      }
      loginAttempts.set(lockKey, entry);

      await prisma.auditLog.create({
        data: {
          action: "LOGIN",
          resource: `login:failed`,
          ipAddress: ip,
          metadata: { email: email.toLowerCase(), reason: "wrong_password", attempts: entry.count },
        },
      });

      res.status(401).json({ error: "ایمیل یا رمز عبور اشتباه است" });
      return;
    }

    // Successful login - reset attempts
    loginAttempts.delete(lockKey);

    const permissions = user.role?.permissions ?? [];
    const token = signJwt({
      sub: user.id,
      email: user.email,
      role: user.role?.name ?? "viewer",
      permissions,
    });

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "LOGIN",
        resource: `login:success`,
        ipAddress: ip,
        metadata: { email: user.email },
      },
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role?.label ?? "مشاهده‌کننده",
        permissions,
      },
    });
  } catch (e) {
    next(e);
  }
});

authRouter.get("/me", async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "توکن یافت نشد" });
      return;
    }

    const payload = verifyJwt(authHeader.slice(7));
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { role: true },
    });

    if (!user || !user.isActive) {
      res.status(401).json({ error: "کاربر یافت نشد یا غیرفعال است" });
      return;
    }

    res.json({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role?.label ?? "مشاهده‌کننده",
      permissions: user.role?.permissions ?? [],
    });
  } catch {
    res.status(401).json({ error: "توکن نامعتبر است" });
  }
});
