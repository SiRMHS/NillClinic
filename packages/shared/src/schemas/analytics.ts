import { z } from "zod";

/** Layer 3 — Analytics API response contracts (read-only aggregates) */

export const timeRangeSchema = z.enum(["24h", "7d", "31d", "all"]);
export type TimeRange = z.infer<typeof timeRangeSchema>;

export const overviewMetricsSchema = z.object({
  totalPatients: z.number(),
  activeReserves: z.number(),
  totalServices: z.number(),
  leadConversionRate: z.number(),
  trends: z.object({
    patients: z.number(),
    reserves: z.number(),
    services: z.number(),
    conversion: z.number(),
  }),
});

export const revenueTrendPointSchema = z.object({
  period: z.string(),
  revenue: z.number(),
});

export const patientGrowthPointSchema = z.object({
  period: z.string(),
  count: z.number(),
});

export const treatmentPopularitySchema = z.object({
  name: z.string(),
  count: z.number(),
});

export const doctorPerformanceSchema = z.object({
  doctorName: z.string(),
  reserveCount: z.number(),
  treatmentCount: z.number(),
});

export type OverviewMetrics = z.infer<typeof overviewMetricsSchema>;
