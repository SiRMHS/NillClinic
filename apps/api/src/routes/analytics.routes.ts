import { Router } from "express";
import { timeRangeSchema } from "@jordan/shared";
import { AnalyticsService } from "../services/analytics.service.js";
import { ClinicAnalyticsService } from "../services/clinic-analytics.service.js";
import { financialRangeSchema } from "@jordan/shared";
import { prisma } from "@jordan/db";
import { requirePermission } from "../middleware/permission.middleware.js";

export const analyticsRouter = Router();
const analytics = new AnalyticsService();
const clinic = new ClinicAnalyticsService();

analyticsRouter.get("/overview", requirePermission("analytics"), async (req, res, next) => {
  try {
    const range = timeRangeSchema.parse(req.query.range ?? "31d");
    res.json(await analytics.getOverview(range));
  } catch (e) {
    next(e);
  }
});

analyticsRouter.get("/patient-growth", requirePermission("analytics"), async (req, res, next) => {
  try {
    const range = timeRangeSchema.parse(req.query.range ?? "31d");
    res.json(await analytics.getPatientGrowth(range));
  } catch (e) {
    next(e);
  }
});

analyticsRouter.get("/medical-matrix", requirePermission("analytics.medical"), async (req, res, next) => {
  try {
    res.json(await analytics.getMedicalMatrix());
  } catch (e) {
    next(e);
  }
});

const introductionLabels: Record<number, string> = {
  132: "اینستاگرام",
  133: "وب‌سایت",
  134: "تلویزیون",
  135: "دوستان و آشنایان",
  136: "سایر",
};

analyticsRouter.get("/crm/patients", requirePermission("crm"), async (_req, res, next) => {
  try {
    const [totalPatients, genders, countries, residentStatuses, introductions, jobs] = await Promise.all([
      prisma.patient.count(),
      prisma.patient.groupBy({ by: ["gender"], _count: { _all: true } }),
      prisma.patient.groupBy({ by: ["residentCountry"], _count: { _all: true } }),
      prisma.patient.groupBy({ by: ["isResident"], _count: { _all: true } }),
      prisma.patient.groupBy({ by: ["introduction"], _count: { _all: true } }),
      prisma.patient.groupBy({ by: ["job"], _count: { _all: true } }),
    ]);

    const withPercent = (items: Array<{ name: string; count: number }>) => Array.from(
      items.reduce((totals, item) => {
        totals.set(item.name, (totals.get(item.name) ?? 0) + item.count);
        return totals;
      }, new Map<string, number>()),
      ([name, count]) => ({
        name,
        count,
        percent: totalPatients > 0 ? Math.round((count / totalPatients) * 10_000) / 100 : 0,
      }),
    )
      .sort((a, b) => b.count - a.count);

    const genderLabel = (gender: number | null): string => {
      if (gender === 20 || gender === 1) return "مرد";
      if (gender === 21) return "زن";
      return gender === null ? "ثبت نشده" : `کد ${gender}`;
    };

    const occupationLabel = (job: string | null): string => {
      const value = job?.trim().replace(/\s+/g, " ") || "ثبت نشده";
      return value === "ازاد" || value === "آزاد" ? "آزاد" : value;
    };

    res.json({
      totalPatients,
      generatedAt: new Date().toISOString(),
      genderDistribution: withPercent(genders.map((item) => ({
        name: genderLabel(item.gender),
        count: item._count._all,
      }))),
      residenceDistribution: withPercent(countries.map((item) => ({
        name: item.residentCountry?.trim() || "ایران",
        count: item._count._all,
      }))),
      residentStatusDistribution: withPercent(residentStatuses.map((item) => ({
        name: item.isResident === true ? "مقیم" : item.isResident === false ? "غیرمقیم" : "ثبت نشده",
        count: item._count._all,
      }))),
      introductionDistribution: withPercent(introductions.map((item) => ({
        name: item.introduction === null
          ? "ثبت نشده"
          : introductionLabels[item.introduction] ?? `کد ${item.introduction}`,
        count: item._count._all,
      }))),
      occupationDistribution: withPercent(jobs.map((item) => ({
        name: occupationLabel(item.job),
        count: item._count._all,
      }))),
    });
  } catch (e) {
    next(e);
  }
});

analyticsRouter.get("/doctor-detail/:name", requirePermission("analytics.doctors"), async (req, res, next) => {
  try {
    const name = decodeURIComponent(req.params.name);

    const [receptions, treatments] = await Promise.all([
      prisma.reception.findMany({
        where: { userName: name },
        orderBy: { receptionDate: "desc" },
        take: 100,
        include: { patient: { select: { externalCode: true, fullNameEnc: true } } },
      }),
      prisma.treatment.findMany({
        where: { planUser: name, isDeleted: false },
        orderBy: { planDate: "desc" },
        take: 100,
        include: { patient: { select: { externalCode: true, fullNameEnc: true } } },
      }),
    ]);

    const decrypt = (await import("../security/encryption.js")).decrypt;

    const receptionsWithPatient = receptions.map((r) => {
      let fullName: string | null = null;
      try { fullName = r.patient?.fullNameEnc ? decrypt(r.patient.fullNameEnc) : null; } catch {}
      return { ...r, patient: r.patient ? { externalCode: r.patient.externalCode, fullName } : null };
    });

    const treatmentsWithPatient = treatments.map((t) => {
      let fullName: string | null = null;
      try { fullName = t.patient?.fullNameEnc ? decrypt(t.patient.fullNameEnc) : null; } catch {}
      return { ...t, patient: t.patient ? { externalCode: t.patient.externalCode, fullName } : null };
    });

    const totalReceptions = await prisma.reception.count({ where: { userName: name } });
    const totalTreatments = await prisma.treatment.count({ where: { planUser: name, isDeleted: false } });

    res.json({
      doctorName: name,
      totalReceptions,
      totalTreatments,
      receptions: receptionsWithPatient,
      treatments: treatmentsWithPatient,
    });
  } catch (e) {
    next(e);
  }
});

// ─── Value-weighted clinic analytics ───
// These answer "what is each group worth", replacing count-only charts that
// could not support a decision.

analyticsRouter.get("/acquisition-channels", requirePermission("analytics"), async (_req, res, next) => {
  try {
    res.json(await clinic.getAcquisitionChannels());
  } catch (e) {
    next(e);
  }
});

analyticsRouter.get("/demographic-value", requirePermission("analytics"), async (_req, res, next) => {
  try {
    res.json(await clinic.getDemographicValue());
  } catch (e) {
    next(e);
  }
});

analyticsRouter.get("/cohorts", requirePermission("analytics"), async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 24) || 24, 120);
    res.json(await clinic.getAcquisitionCohorts(limit));
  } catch (e) {
    next(e);
  }
});

analyticsRouter.get("/booking-follow-through", requirePermission("analytics"), async (req, res, next) => {
  try {
    res.json(await clinic.getBookingFollowThrough(financialRangeSchema.parse(req.query ?? {})));
  } catch (e) {
    next(e);
  }
});

/** Scope of the treatment-plan dataset, so plan-based reports can disclose it. */
analyticsRouter.get("/treatment-plan-coverage", requirePermission("analytics.medical"), async (_req, res, next) => {
  try {
    res.json(await clinic.getTreatmentPlanCoverage());
  } catch (e) {
    next(e);
  }
});
