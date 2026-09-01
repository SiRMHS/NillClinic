import { z } from "zod";

/**
 * What the dashboard is allowed to *show*, as opposed to who may open it.
 *
 * Access keys answer "may this role reach the CRM at all". They cannot answer
 * "the desk works the CRM every day but must not read what patients paid",
 * because that is not a section boundary — it is a column inside a section the
 * role has to keep. These switches are that second axis, and they are stored
 * once for the whole site rather than per user: the clinic turns figures off
 * for everybody but the owner, and a per-user copy would drift the moment a new
 * account is created.
 *
 * Nobody is exempt, the superadmin included. An exemption for `*` was the
 * original design — someone has to be able to read the books — but it made the
 * switch look broken to the one person most likely to test it: the owner turns
 * "hide every figure" on, sees the dashboard unchanged, and reasonably concludes
 * it does not work. Nothing is lost by dropping it, because the escape hatch is
 * the switch itself: whoever can turn masking on can turn it off, so there is
 * no way to lock the books away from the person who owns them.
 */
export const displaySettingsSchema = z.object({
  /** Hide every monetary figure across the whole dashboard. */
  hideAmounts: z.boolean(),
  /** Hide monetary figures in the CRM sections only. */
  hideCrmAmounts: z.boolean(),
  /** Hide rates and percentages in the CRM sections. */
  hideCrmRates: z.boolean(),
});

export type DisplaySettings = z.infer<typeof displaySettingsSchema>;

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  hideAmounts: false,
  hideCrmAmounts: false,
  hideCrmRates: false,
};

export const displaySettingsUpdateSchema = displaySettingsSchema.partial();

/**
 * What a masked figure reads as.
 *
 * Not an empty cell: a blank looks like missing data and sends staff off to
 * find out why the amount was never recorded. Three em-dashes say the value
 * exists and is not for you.
 */
export const MASKED_FIGURE = "———";

/**
 * Whether the viewer sees money at all, given the site settings.
 *
 * `isSuperadmin` is still accepted so callers do not all have to change at
 * once, but it no longer grants an exemption — see the note above.
 */
export function amountsHidden(
  settings: DisplaySettings,
  opts: { isSuperadmin?: boolean; scope?: "site" | "crm" } = {},
): boolean {
  if (settings.hideAmounts) return true;
  return opts.scope === "crm" && settings.hideCrmAmounts;
}

/** Whether the viewer sees CRM rates and percentages. */
export function crmRatesHidden(
  settings: DisplaySettings,
  _opts: { isSuperadmin?: boolean } = {},
): boolean {
  return settings.hideCrmRates;
}
