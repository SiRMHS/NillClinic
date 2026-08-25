import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

/**
 * Central error handler.
 *
 * Validation failures must not surface as 500 "خطای داخلی سرور": that told the
 * user the server broke when in fact their input was rejected, and it hid which
 * field was at fault. Zod errors become 400 with the offending fields named;
 * everything else stays a 500 with details kept server-side.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    const fields = err.issues.map((i) => ({
      field: i.path.join(".") || "(root)",
      message: i.message,
    }));
    const summary = fields.map((f) => `${f.field}: ${f.message}`).join("، ");
    console.warn("[api validation]", summary);
    res.status(400).json({ error: `ورودی نامعتبر — ${summary}`, fields });
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  console.error("[api error]", message, err);
  res.status(500).json({ error: "خطای داخلی سرور" });
}
