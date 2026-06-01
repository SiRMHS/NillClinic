import { prisma } from "@jordan/db";
import type { TimeRange } from "@jordan/shared";

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
        select: { reasonName: true, detailsJson: true },
      });

      const diagTreatMap = new Map<string, Map<string, number>>();

      for (const t of treatments) {
        const diag = t.reasonName!;
        if (!diagTreatMap.has(diag)) diagTreatMap.set(diag, new Map());
        const treatMap = diagTreatMap.get(diag)!;

        const details = t.detailsJson as Array<{ treatmentPlanDetailName?: string | null; treatmentItems?: string | null }> | null;
        if (Array.isArray(details)) {
          for (const d of details) {
            const item = d.treatmentPlanDetailName || d.treatmentItems || "بدون نام";
            treatMap.set(item, (treatMap.get(item) ?? 0) + 1);
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

  async getTreatmentPopularity(limit = 10) {
    try {
      const treatments = await prisma.treatment.findMany({
        where: { isDeleted: false },
        select: { reasonName: true },
      });

      const counts = new Map<string, number>();
      for (const t of treatments) {
        const name = t.reasonName ?? "نامشخص";
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }

      return Array.from(counts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
    } catch {
      return [];
    }
  }

  async getTreatmentCategories() {
    try {
      const treatments = await prisma.treatment.findMany({
        where: { isDeleted: false },
        select: { planName: true, reasonName: true, detailsJson: true, planDate: true, planUser: true },
      });

      const categoryCount = new Map<string, number>();
      const reasonCount = new Map<string, number>();
      const itemCount = new Map<string, number>();
      const monthlyTrend = new Map<string, Record<string, number>>();
      const doctorCategory = new Map<string, Record<string, number>>();

      for (const t of treatments) {
        const cat = t.planName || "نامشخص";
        categoryCount.set(cat, (categoryCount.get(cat) ?? 0) + 1);

        const reason = t.reasonName || "نامشخص";
        reasonCount.set(reason, (reasonCount.get(reason) ?? 0) + 1);

        const month = t.planDate?.slice(0, 7) || "نامشخص";
        if (!monthlyTrend.has(month)) monthlyTrend.set(month, {});
        const monthData = monthlyTrend.get(month)!;
        monthData[cat] = (monthData[cat] ?? 0) + 1;

        if (t.planUser) {
          if (!doctorCategory.has(t.planUser)) doctorCategory.set(t.planUser, {});
          const dc = doctorCategory.get(t.planUser)!;
          dc[cat] = (dc[cat] ?? 0) + 1;
        }

        const details = t.detailsJson as Array<{ treatmentPlanDetailName?: string | null; treatmentItems?: string | null }> | null;
        if (Array.isArray(details)) {
          for (const d of details) {
            const itemName = d.treatmentPlanDetailName || d.treatmentItems || "بدون نام";
            itemCount.set(itemName, (itemCount.get(itemName) ?? 0) + 1);
          }
        }
      }

      const sortedCategories = Array.from(categoryCount.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

      const sortedReasons = Array.from(reasonCount.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);

      const sortedItems = Array.from(itemCount.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 30);

      const sortedMonths = Array.from(monthlyTrend.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([period, categories]) => ({ period, ...categories }));

      const doctorBreakdown = Array.from(doctorCategory.entries())
        .map(([doctor, categories]) => ({
          doctor,
          categories: Object.entries(categories)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count),
          total: Object.values(categories).reduce((s, c) => s + c, 0),
        }))
        .sort((a, b) => b.total - a.total);

      return {
        categories: sortedCategories,
        diagnoses: sortedReasons,
        treatmentItems: sortedItems,
        monthlyTrend: sortedMonths,
        doctorBreakdown,
      };
    } catch {
      return {
        categories: [],
        diagnoses: [],
        treatmentItems: [],
        monthlyTrend: [],
        doctorBreakdown: [],
      };
    }
  }

  async getDoctorPerformance() {
    try {
      const reserves = await prisma.reserve.groupBy({
        by: ["doctorName"],
        _count: { id: true },
      });

      const treatments = await prisma.treatment.groupBy({
        by: ["planUser"],
        _count: { id: true },
      });

      const map = new Map<string, { reserveCount: number; treatmentCount: number }>();

      for (const r of reserves) {
        map.set(r.doctorName, { reserveCount: r._count.id, treatmentCount: 0 });
      }
      for (const t of treatments) {
        const existing = map.get(t.planUser) ?? { reserveCount: 0, treatmentCount: 0 };
        existing.treatmentCount = t._count.id;
        map.set(t.planUser, existing);
      }

      return Array.from(map.entries()).map(([doctorName, stats]) => ({
        doctorName,
        ...stats,
      }));
    } catch {
      return [];
    }
  }
}
