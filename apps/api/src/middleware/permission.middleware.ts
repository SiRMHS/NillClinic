import type { Request, Response, NextFunction } from "express";
import { hasPermission, hasAnyPermission } from "../lib/permissions.js";

const DENIED = { error: "دسترسی غیرمجاز" };
const UNAUTHENTICATED = { error: "احراز هویت نشده" };

/**
 * Guards take a deliberately narrow `req` rather than Express's `Request`.
 *
 * Express infers a route's `params` type from its path, but only when every
 * handler in the chain agrees on it — a guard typed as `RequestHandler` votes
 * for the catch-all `ParamsDictionary` and drags `req.params.id` down to
 * `string | string[] | undefined` in the *real* handler beside it. Naming only
 * the field the guard actually reads keeps it out of that inference entirely,
 * so `router.get("/:id", requirePermission("x"), handler)` still types `id` as
 * a plain string.
 */
type GuardRequest = Pick<Request, "user" | "method">;
type Guard = (req: GuardRequest, res: Response, next: NextFunction) => void;

/** Blocks the request unless the caller holds `permission` (or `*`). */
export function requirePermission(permission: string): Guard {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json(UNAUTHENTICATED);
      return;
    }
    if (hasPermission(req.user.permissions, permission)) {
      next();
      return;
    }
    res.status(403).json(DENIED);
  };
}

/**
 * Passes when the caller holds *any* of the listed keys. Used where one
 * endpoint legitimately serves two sections — reception rows, for instance,
 * are read both from a patient's file and from the lead panel.
 */
export function requireAnyPermission(...permissions: string[]): Guard {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json(UNAUTHENTICATED);
      return;
    }
    if (hasAnyPermission(req.user.permissions, permissions)) {
      next();
      return;
    }
    res.status(403).json(DENIED);
  };
}

/**
 * Splits a section into looking and changing: any of `read` opens the GETs,
 * while anything that mutates additionally needs `write`. Mounted with
 * `router.use(path, ...)` so one line covers a whole sub-resource.
 */
export function requireReadWrite(read: string[], write: string): Guard {
  const readGuard = requireAnyPermission(...read, write);
  const writeGuard = requirePermission(write);
  return (req, res, next) => {
    const isRead = req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS";
    (isRead ? readGuard : writeGuard)(req, res, next);
  };
}

/** Superadmin-only (`*`), for operations no individual key should unlock. */
export function requireSuperAdmin(): Guard {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json(UNAUTHENTICATED);
      return;
    }
    if (req.user.permissions?.includes("*")) {
      next();
      return;
    }
    res.status(403).json({ error: "فقط مدیر سیستم به این بخش دسترسی دارد" });
  };
}

/** Same check as the guards, for use inside a handler. */
export function can(req: GuardRequest, permission: string): boolean {
  return hasPermission(req.user?.permissions, permission);
}
