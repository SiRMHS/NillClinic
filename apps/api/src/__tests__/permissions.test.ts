import { describe, it, expect } from "vitest";
import {
  AVAILABLE_PERMISSIONS,
  ALL_PERMISSION_KEYS,
  expandPermissions,
  hasPermission,
  hasAnyPermission,
} from "../lib/permissions.js";

describe("permission catalogue", () => {
  it("has no duplicate keys", () => {
    expect(new Set(ALL_PERMISSION_KEYS).size).toBe(ALL_PERMISSION_KEYS.length);
  });

  it("never offers the superadmin wildcard as a grantable key", () => {
    expect(ALL_PERMISSION_KEYS).not.toContain("*");
  });

  it("gives every key a label and a group", () => {
    for (const p of AVAILABLE_PERMISSIONS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.group.length).toBeGreaterThan(0);
    }
  });

  it("only implies keys that exist in the catalogue", () => {
    for (const key of ALL_PERMISSION_KEYS) {
      for (const implied of expandPermissions([key])) {
        expect(ALL_PERMISSION_KEYS).toContain(implied);
      }
    }
  });
});

describe("hasPermission", () => {
  it("grants everything to the wildcard", () => {
    for (const key of ALL_PERMISSION_KEYS) {
      expect(hasPermission(["*"], key)).toBe(true);
    }
  });

  it("denies when the role has nothing", () => {
    expect(hasPermission([], "dashboard")).toBe(false);
    expect(hasPermission(undefined, "dashboard")).toBe(false);
  });

  it("grants the key itself", () => {
    expect(hasPermission(["crm"], "crm")).toBe(true);
  });

  it("grants a parent's implied children", () => {
    expect(hasPermission(["analytics"], "analytics.medical")).toBe(true);
    expect(hasPermission(["analytics"], "reports.doctors")).toBe(true);
    expect(hasPermission(["patients"], "patients.view")).toBe(true);
    expect(hasPermission(["financial"], "financial.patients")).toBe(true);
  });

  it("does not grant a parent from one of its children", () => {
    expect(hasPermission(["patients.view"], "patients")).toBe(false);
    expect(hasPermission(["analytics.medical"], "analytics")).toBe(false);
  });

  // The reason the catalogue was split: reporting access must not carry money.
  it("keeps financial access out of general reporting", () => {
    const analyst = ["dashboard", "patients.view", "crm", "analytics"];
    expect(hasPermission(analyst, "financial")).toBe(false);
    expect(hasPermission(analyst, "financial.patients")).toBe(false);
    expect(hasPermission(analyst, "financial.tiers")).toBe(false);
    expect(hasPermission(analyst, "financial.export")).toBe(false);
    // …while the non-money reports it is meant to reach still work.
    expect(hasPermission(analyst, "reports.doctors")).toBe(true);
  });

  it("keeps destructive sync actions off the read key", () => {
    expect(hasPermission(["sync"], "sync.purge")).toBe(false);
    expect(hasPermission(["sync"], "sync.settings")).toBe(false);
    expect(hasPermission(["sync"], "sync.run")).toBe(true);
  });

  it("keeps role editing separate from user management", () => {
    expect(hasPermission(["settings.users"], "settings.roles")).toBe(false);
    expect(hasPermission(["settings.roles"], "settings.users")).toBe(false);
  });

  it("terminates on the implication graph rather than looping", () => {
    // Guards against a future edit introducing a cycle in PERMISSION_IMPLIES.
    expect(() => expandPermissions(ALL_PERMISSION_KEYS)).not.toThrow();
  });
});

describe("hasAnyPermission", () => {
  it("passes when one of the listed keys is held", () => {
    expect(hasAnyPermission(["leads"], ["patients.view", "leads"])).toBe(true);
  });

  it("fails when none are", () => {
    expect(hasAnyPermission(["crm"], ["patients.view", "leads"])).toBe(false);
  });
});

describe("lead isolation", () => {
  it("does not let `leads` imply `leads.all`", () => {
    // `leads` is an agent's own queue plus the unassigned pool. If the coarse
    // key implied the wide one, every agent would be back to reading every
    // colleague's leads — the exact disclosure the split exists to remove.
    expect(hasPermission(["leads"], "leads.all")).toBe(false);
    expect(hasPermission(["leads", "leads.all"], "leads.all")).toBe(true);
    expect(hasPermission(["*"], "leads.all")).toBe(true);
  });

  it("keeps the keys an agent still needs", () => {
    // Claiming a lead out of the pool is an assignment, so agents keep it.
    expect(hasPermission(["leads"], "leads.assign")).toBe(true);
    expect(hasPermission(["leads"], "campaigns")).toBe(true);
  });
});
