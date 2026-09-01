import type { Request, Response } from "express";
import { prisma, type Prisma } from "@jordan/db";
import { can } from "../middleware/permission.middleware.js";

/**
 * Which leads a request is allowed to touch.
 *
 * A lead carries the name and mobile number of someone who contacted a medical
 * clinic, so "every agent can read every lead" is a larger disclosure than it
 * looks — and no call-centre agent needs a colleague's queue.
 *
 * The rule is the one the app already assumed elsewhere (see the
 * `newUnassigned` / `myActive` split on `/api/leads/counts`): a lead belongs to
 * whoever it is assigned to, and an unassigned lead belongs to nobody and is a
 * shared pool anyone may pick up. Dropping the pool would leave a lead arriving
 * from the webhook invisible to every agent until a supervisor assigned it.
 *
 * `leads.all` lifts the restriction, for the supervisor who needs the board.
 *
 * Lives here rather than in one router because leads are reachable from two
 * places — `/api/leads` and `/api/campaigns/:id/leads` — and a rule enforced on
 * one of them is a lock on one of two doors.
 */
export function leadScope(req: Request): Prisma.LeadWhereInput | null {
  if (can(req, "leads.all")) return null;
  // A request that somehow reached here unauthenticated matches no lead rather
  // than every lead: `assignedUserId: undefined` would drop the clause.
  const userId = req.user?.sub ?? "__no-such-user__";
  return { OR: [{ assignedUserId: userId }, { assignedUserId: null }] };
}

/** A caller's `where`, narrowed to the leads they may see. */
export function scopedLeadWhere(
  req: Request,
  where: Prisma.LeadWhereInput = {},
): Prisma.LeadWhereInput {
  const scope = leadScope(req);
  return scope ? { AND: [where, scope] } : where;
}

/**
 * Confirm this request may act on one lead, by id.
 *
 * Answers 404 rather than 403 for a lead that exists but belongs to someone
 * else: a 403 confirms the id is real, which turns the endpoint into a way of
 * counting the clinic's leads. Returns false once it has already answered, so
 * callers `if (!(await assertLeadAccess(...))) return;`.
 */
export async function assertLeadAccess(
  req: Request,
  res: Response,
  id: string,
): Promise<boolean> {
  const scope = leadScope(req);
  if (!scope) return true;

  const visible = await prisma.lead.findFirst({
    where: { AND: [{ id }, scope] },
    select: { id: true },
  });
  if (visible) return true;

  res.status(404).json({ error: "لید یافت نشد" });
  return false;
}
