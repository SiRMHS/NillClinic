import type { Request, Response, NextFunction } from "express";

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;

    if (!user) {
      res.status(401).json({ error: "احراز هویت نشده" });
      return;
    }

    const perms = user.permissions ?? [];

    if (perms.includes("*") || perms.includes(permission)) {
      next();
      return;
    }

    res.status(403).json({ error: "دسترسی غیرمجاز" });
  };
}
