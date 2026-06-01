import type { Request, Response, NextFunction } from "express";
import { verifyJwt } from "../security/jwt.js";

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

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "توکن احراز هویت یافت نشد" });
      return;
    }

    const token = authHeader.slice(7);
    if (!token) {
      res.status(401).json({ error: "توکن معتبر نیست" });
      return;
    }

    const payload = verifyJwt(token);
    req.user = {
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
      permissions: payload.permissions,
    };

    next();
  } catch {
    res.status(401).json({ error: "توکن منقضی شده یا نامعتبر است" });
  }
}
