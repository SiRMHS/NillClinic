import { prisma } from "@jordan/db";
import { normalizeCrmText, splitCrmLabels } from "@jordan/shared";
import type { TimeRange } from "@jordan/shared";

function treatmentReasons(reasonName: string | null, reasonNames: unknown): string[] {
  if (Array.isArray(reasonNames) && reasonNames.length > 0) {
    return reasonNames.map((r) => normalizeCrmText(String(r))).filter(Boolean);
  }
  return splitCrmLabels(reasonName);
}

function treatmentItemLabel(detail: { treatmentPlanDetailName?: string | null; treatmentItems?: string | null }): string {
  const name = normalizeCrmText(detail.treatmentPlanDetailName) || normalizeCrmText(detail.treatmentItems);
  return name || "بدون نام";
}

export class AnalyticsService {
  private rangeToDate(range: TimeRange): Date | null {
    const now = new Date();
    switch (range) {
      case "24h":
        return new Date(now.getTime() - 24 * 60 * 60 * 1000);
      case "7d":
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case "31d":
        return new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);
      case "all":
        return null;
    }
  }

  async getOverview(range: TimeRange) {
    try {
      const since = this.rangeToDate(range);
      const patientWhere = since ? { createdAt: { gte: since } } : {};
      const leadWhere = since ? { createdAt: { gte: since } } : {};

      const [totalPatients, activeReserves, totalServices, leads, converted] = await Promise.all([
        prisma.patient.count({ where: patientWhere }),
        prisma.reserve.count({ where: { isAccepted: false, ...(since ? { createdAt: { gte: since } } : {}) } }),
        prisma.service.count(),
        prisma.lead.count({ where: leadWhere }),
        prisma.lead.count({ where: { ...leadWhere, status: "CONVERTED" } }),
      ]);

      const leadConversionRate = leads > 0 ? Math.round((converted / leads) * 1000) / 10 : 0;

      return {
        totalPatients,
        activeReserves,
        totalServices,
        leadConversionRate,
        trends: {
          patients: 0,
          reserves: 0,
          services: 0,
          conversion: 0,
        },
      };
    } catch {
      return {
        totalPatients: 0,
        activeReserves: 0,
        totalServices: 0,
        leadConversionRate: 0,
        trends: { patients: 0, reserves: 0, services: 0, conversion: 0 },
      };
    }
  }

  async getPatientGrowth(range: TimeRange) {
    try {
      const since = this.rangeToDate(range);
      const patients = await prisma.patient.findMany({
        where: since ? { createdAt: { gte: since } } : {},
        select: { createdAt: true },
        orderBy: { createdAt: "asc" },
      });

      const buckets = new Map<string, number>();
      for (const p of patients) {
        const key = p.createdAt.toISOString().slice(0, 10);
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }

      return Array.from(buckets.entries()).map(([period, count]) => ({ period, count }));
    } catch {
      return [];
    }
  }

  async getMedicalMatrix() {
    try {
      const treatments = await prisma.treatment.findMany({
        where: { isDeleted: false, reasonName: { not: null } },
        select: { reasonName: true, reasonNames: true, detailsJson: true },
      });

      const diagTreatMap = new Map<string, Map<string, number>>();

      for (const t of treatments) {
        const diagnoses = treatmentReasons(t.reasonName, t.reasonNames);
        const details = t.detailsJson as Array<{ treatmentPlanDetailName?: string | null; treatmentItems?: string | null }> | null;

        for (const diag of diagnoses) {
          if (!diagTreatMap.has(diag)) diagTreatMap.set(diag, new Map());
          const treatMap = diagTreatMap.get(diag)!;

          if (Array.isArray(details)) {
            for (const d of details) {
              const item = treatmentItemLabel(d);
              treatMap.set(item, (treatMap.get(item) ?? 0) + 1);
            }
          }
        }
      }

      const diagnoses = Array.from(diagTreatMap.keys()).sort();
      const allTreatmentSet = new Set<string>();
      for (const treatMap of diagTreatMap.values()) {
        for (const treat of treatMap.keys()) allTreatmentSet.add(treat);
      }
      const treatmentsList = Array.from(allTreatmentSet).sort();

      const matrix = diagnoses.map((diag) => {
        const treatMap = diagTreatMap.get(diag)!;
        return treatmentsList.map((t) => treatMap.get(t) ?? 0);
      });

      const diagnosisTotals = matrix.map((row) => row.reduce((s: number, c) => s + c, 0));
      const treatmentTotals = treatmentsList.map((_, i) => matrix.reduce((s: number, row) => s + (row[i] ?? 0), 0));

      const diagnosisDetails = diagnoses.map((diag, i) => ({
        diagnosis: diag,
        total: diagnosisTotals[i]!,
        treatments: Array.from(diagTreatMap.get(diag)!.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10),
      }));

      const treatmentDetails = treatmentsList.map((treat, i) => ({
        treatment: treat,
        total: treatmentTotals[i]!,
        diagnoses: diagnoses
          .map((diag, j) => ({ diagnosis: diag, count: matrix[j]![i] ?? 0 }))
          .filter((d) => d.count > 0)
          .sort((a, b) => b.count - a.count)
          .slice(0, 10),
      }));

      return {
        diagnoses,
        treatments: treatmentsList,
        matrix,
        diagnosisTotals,
        treatmentTotals,
        diagnosisDetails: diagnosisDetails.filter((d) => d.total > 0),
        treatmentDetails: treatmentDetails.filter((t) => t.total > 0),
      };
    } catch {
      return {
        diagnoses: [],
        treatments: [],
        matrix: [],
        diagnosisTotals: [],
        treatmentTotals: [],
        diagnosisDetails: [],
        treatmentDetails: [],
      };
    }
  }

}
