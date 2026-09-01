import type { Request } from "express";
import { prisma } from "@jordan/db";
import {
  DEFAULT_DISPLAY_SETTINGS,
  amountsHidden,
  crmRatesHidden,
  type DisplaySettings,
} from "@jordan/shared";

/**
 * Site-wide display switches, read on nearly every request that returns money.
 *
 * The row is a singleton that changes when someone toggles a checkbox in
 * settings — perhaps twice a year. Hitting the database for it on every CRM
 * list would be a query per request for a value that is almost never different,
 * so it is cached briefly. The window is short enough that an operator who
 * turns masking on sees it take effect while they are still looking at the
 * page, and the write path clears the cache anyway.
 */
const CACHE_TTL_MS = 10_000;

let cached: { value: DisplaySettings; at: number } | null = null;

export function invalidateDisplaySettings(): void {
  cached = null;
}

export async function getDisplaySettings(): Promise<DisplaySettings> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  let value = DEFAULT_DISPLAY_SETTINGS;
  try {
    const row = await prisma.displaySettings.findUnique({ where: { id: 1 } });
    if (row) {
      value = {
        hideAmounts: row.hideAmounts,
        hideCrmAmounts: row.hideCrmAmounts,
        hideCrmRates: row.hideCrmRates,
      };
    }
  } catch {
    // A database restored from a dump that predates the table must not take
    // the whole dashboard down; showing figures is the pre-existing behaviour.
    value = DEFAULT_DISPLAY_SETTINGS;
  }

  cached = { value, at: Date.now() };
  return value;
}

/**
 * The cached settings without awaiting.
 *
 * The masking middleware primes the cache before the route runs and then reads
 * it again at the moment the response is serialised — the only point at which
 * `req.user` is populated, because each router applies its own `requireAuth`.
 * Reading it synchronously there keeps `res.json` synchronous, which is what
 * every handler in this codebase assumes.
 *
 * Falls back to showing figures if the cache is cold, which it cannot be after
 * `primeDisplaySettings` has resolved.
 */
export function cachedDisplaySettings(): DisplaySettings {
  return cached?.value ?? DEFAULT_DISPLAY_SETTINGS;
}

/** Fill the cache so `cachedDisplaySettings` has something to return. */
export async function primeDisplaySettings(): Promise<void> {
  await getDisplaySettings();
}

/**
 * Retained so the call sites keep reading as "who is asking", but it no longer
 * grants an exemption — see the note on `amountsHidden` in @jordan/shared.
 */
const isSuperadmin = (req: Pick<Request, "user">) => req.user?.permissions?.includes("*") === true;

/** Whether this caller sees figures, decided from the already-cached settings. */
export function hideAmountsForSync(
  req: Pick<Request, "user">,
  scope: "site" | "crm" = "site",
): boolean {
  return amountsHidden(cachedDisplaySettings(), { isSuperadmin: isSuperadmin(req), scope });
}

/** Whether this caller sees CRM rates, decided from the already-cached settings. */
export function hideCrmRatesForSync(req: Pick<Request, "user">): boolean {
  return crmRatesHidden(cachedDisplaySettings(), { isSuperadmin: isSuperadmin(req) });
}

/**
 * Whether this caller's response should have its money stripped.
 *
 * Asked on the server rather than left to the browser: a figure that is only
 * hidden by CSS is still in the JSON, and the point of the setting is that the
 * account it is aimed at cannot read the amounts at all.
 */
export async function hideAmountsFor(
  req: Pick<Request, "user">,
  scope: "site" | "crm" = "site",
): Promise<boolean> {
  return amountsHidden(await getDisplaySettings(), { isSuperadmin: isSuperadmin(req), scope });
}

/** Whether CRM rates and percentages should be stripped for this caller. */
export async function hideCrmRatesFor(req: Pick<Request, "user">): Promise<boolean> {
  return crmRatesHidden(await getDisplaySettings(), { isSuperadmin: isSuperadmin(req) });
}

/**
 * Null out the named fields wherever they appear in a response.
 *
 * A walk rather than a per-endpoint rewrite: these payloads nest (a KPI block
 * holds a trend array, a doctor scorecard holds its own totals), and an
 * endpoint that grew a new money field later would otherwise start leaking it
 * silently. Nulling rather than deleting keeps the response shape stable, so
 * the client renders a masked cell instead of an undefined one.
 */
export function maskFields<T>(value: T, keys: readonly string[]): T {
  const hidden = new Set(keys);

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== "object") return node;
    // Dates and Decimals are values, not records to descend into.
    if (node instanceof Date) return node;

    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      out[key] = hidden.has(key) ? null : walk(child);
    }
    return out;
  };

  return walk(value) as T;
}

/**
 * Every field name in this API that carries a monetary figure.
 *
 * One list for the whole surface, not a per-endpoint selection. The masking
 * runs as middleware over all of `/api`, so a new endpoint is covered the day
 * it is written as long as it names its money field the way the rest of the
 * codebase does — which is the point: an opt-in list is always one endpoint
 * behind, and the endpoint it is behind on is the one nobody remembered.
 *
 * `amountText` is here because the CRM stored amounts as prose
 * («۱۰ میلیون و ۹۰۰ هزار تومان»); it is money in a string, and dropping only
 * the numeric twin would leak the same figure spelled out.
 *
 * Deliberately absent: `platinumMin` / `goldMin` / `silverMin` / `bronzeMin`.
 * Those are the tier thresholds — configuration the operator types in, not
 * anything a patient paid — and nulling them would leave the settings form
 * unable to show or save what it is editing. `minSpend` on the tier *summary*
 * IS masked, because there it is rendered as a figure on a report.
 */
export const AMOUNT_FIELDS = [
  // Raw amounts
  "amount",
  "amountText",
  "received",
  "discount",
  "outstanding",
  "deposit",
  "tariff",
  // `receptions.details_json` is stored verbatim as the upstream CRM sends it,
  // and every line inside it carries what was paid. The mask walks nested
  // objects, so naming the upstream keys here covers that column too — the
  // reception panel does not render them, but they were still in the response.
  "receivedPrice",
  "remainPrice",
  "depositPrice",
  "totalPrice",
  "unitPrice",
  "price",
  // What the clinic spends, not what a patient paid — money either way.
  "budget",
  // Totals
  "totalReceived",
  "totalDiscount",
  "totalOutstanding",
  "totalDeposit",
  "totalRevenue",
  "grossBilled",
  // Revenue, in the shapes the reports return it
  "revenue",
  "revenueAfter",
  "revenueShare",
  "revenuePerConverted",
  "revenuePerPatient",
  "revenuePerPayingPatient",
  "convertedRevenue",
  "treatmentRevenue",
  "treatmentReceived",
  "consultingDoctorReceived",
  // Per-unit averages — an average is still a figure
  "averagePrice",
  "averageTicket",
  "avgTicket",
  "averageSpend",
  "averagePerPatient",
  "averagePerReception",
  "averagePerReferral",
  // Per-patient worth
  "lifetimeSpend",
  "minSpend",
] as const;

/** Rate and percentage fields the CRM sections report. */
export const RATE_FIELDS = [
  "answerRate",
  "rebookRate",
  "conversionRate",
  "returnRate",
  "repeatPatientRate",
  "revenueShare",
] as const;
