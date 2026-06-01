/**
 * Resolves conflicts when local data diverges from CRM during upsert.
 * Default policy: CRM wins (source of truth for clinical data).
 */

export type ConflictPolicy = "crm_wins" | "local_wins" | "newest_timestamp";

export interface ConflictContext<T> {
  local: T;
  remote: T;
  localSyncedAt: Date;
  remoteSyncedAt: Date;
}

export class ConflictResolver {
  constructor(private readonly policy: ConflictPolicy = "crm_wins") {}

  resolve<T>(ctx: ConflictContext<T>): T {
    switch (this.policy) {
      case "crm_wins":
        return ctx.remote;
      case "local_wins":
        return ctx.local;
      case "newest_timestamp":
        return ctx.remoteSyncedAt >= ctx.localSyncedAt ? ctx.remote : ctx.local;
      default:
        return ctx.remote;
    }
  }
}
