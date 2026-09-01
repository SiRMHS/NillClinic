import type { NextFunction, Request, RequestHandler, Response } from "express";
import {
  AMOUNT_FIELDS,
  RATE_FIELDS,
  hideAmountsForSync,
  hideCrmRatesForSync,
  maskFields,
  primeDisplaySettings,
} from "../lib/display-settings.js";

/** What this viewer is not allowed to see. */
export interface DisplayMask {
  amounts: boolean;
  rates: boolean;
}

/**
 * What a route should hide from this request.
 *
 * The CSV exports need the same answer the JSON masking uses — an export is the
 * one place a hidden figure could walk out of the building — so they ask here
 * rather than deciding for themselves.
 */
export function displayMask(req: Request): DisplayMask {
  // `/api/crm-desk` is the one section with switches of its own: the clinic
  // hands the desk the CRM without the money while the dashboard keeps it.
  // Everywhere else answers to the site-wide switch alone.
  const isCrm = req.originalUrl.startsWith("/api/crm-desk");
  return {
    amounts: hideAmountsForSync(req, isCrm ? "crm" : "site"),
    rates: isCrm && hideCrmRatesForSync(req),
  };
}

/**
 * Strip hidden figures from every JSON response the API sends.
 *
 * This used to be opt-in: each route that knew it returned money called a
 * masking helper before `res.json`. Two routers did; fifteen did not. So with
 * «مخفی کردن همه ارقام مالی» switched on the CRM went quiet while
 * `/api/financial/*`, `/api/reports/*` and `/api/analytics/*` kept answering
 * with full revenue — and the setting reads as broken, because from the user's
 * side of the screen it is.
 *
 * Doing it once, here, inverts the failure mode. A new endpoint is covered the
 * moment it is written; forgetting a field name now means a *masked* figure
 * appears somewhere it need not have, which is visible and harmless, rather
 * than a real one appearing where it must not, which is neither.
 *
 * It is deliberately server-side. Hiding a column in the browser leaves the
 * amount sitting in the JSON, and the whole point of the switch is that the
 * account it is aimed at cannot read the figures at all — not from the page,
 * not from the network tab, not from an export.
 */
export const maskDisplayFields: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const original = res.json.bind(res);

  res.json = function patched(body: unknown) {
    /**
     * Decided here rather than in the middleware body, because this is the
     * first moment `req.user` exists: the mask is mounted on `/api` ahead of
     * the routers, and each router applies its own `requireAuth`. Reading the
     * settings from cache keeps this synchronous, which is what every handler
     * calling `res.json` assumes.
     */
    const mask = displayMask(req);
    let out = body;
    if (mask.amounts) out = maskFields(out, AMOUNT_FIELDS);
    if (mask.rates) out = maskFields(out, RATE_FIELDS);
    return original(out);
  } as Response["json"];

  /**
   * Warm the cache so the read above has something current to work from. A
   * failed lookup is not allowed to blank a dashboard that was working:
   * `getDisplaySettings` already falls back to showing figures, and the cached
   * accessor does the same when the cache is cold.
   */
  primeDisplaySettings().then(
    () => next(),
    () => next(),
  );
};
