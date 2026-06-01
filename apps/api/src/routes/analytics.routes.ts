import { Router } from "express";
import { timeRangeSchema } from "@jordan/shared";
import { AnalyticsService } from "../services/analytics.service.js";
import { prisma } from "@jordan/db";

export const analyticsRouter = Router();
const analytics = new AnalyticsService();

analyticsRouter.get("/overview", async (req, res, next) => {
  try {
    const range = timeRangeSchema.parse(req.query.range ?? "31d");
    res.json(await analytics.getOverview(range));
  } catch (e) {
    next(e);
  }
});

analyticsRouter.get("/patient-growth", async (req, res, next) => {
  try {
    const range = timeRangeSchema.parse(req.query.range ?? "31d");
    res.json(await analytics.getPatientGrowth(range));
  } catch (e) {
    next(e);
  }
});

analyticsRouter.get("/treatments", async (req, res, next) => {
  try {
    res.json(await analytics.getTreatmentCategories());
  } catch (e) {
    next(e);
  }
});

analyticsRouter.get("/medical-matrix", async (req, res, next) => {
  try {
    res.json(await analytics.getMedicalMatrix());
  } catch (e) {
    next(e);
  }
});

analyticsRouter.get("/treatment-popularity", async (req, res, next) => {
  try {
    res.json(await analytics.getTreatmentPopularity());
  } catch (e) {
    next(e);
  }
});

analyticsRouter.get("/doctor-performance", async (req, res, next) => {
  try {
    res.json(await analytics.getDoctorPerformance());
  } catch (e) {
    next(e);
  }
});

analyticsRouter.get("/patient-demographics", async (req, res, next) => {
  try {
    const patients = await prisma.patient.findMany({
      select: { gender: true, birthDate: true, job: true },
    });

    const formatter = new Intl.DateTimeFormat("fa-IR", {
      year: "numeric", month: "2-digit", day: "2-digit",
    });

    function getPersianToday() {
      const parts = formatter.formatToParts(new Date());
      const get = (type: string) => parseInt(parts.find((p) => p.type === type)!.value.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))));
      return { year: get("year"), month: get("month"), day: get("day") };
    }

    function persianAge(birthDateStr: string | null): number | null {
      if (!birthDateStr || !/^\d{4}\/\d{2}\/\d{2}$/.test(birthDateStr)) return null;
      const [bYear, bMonth, bDay] = birthDateStr.split("/").map(Number);
      if (!bYear || !bMonth || !bDay) return null;
      const today = getPersianToday();
      let age = today.year - bYear;
      if (today.month < bMonth || (today.month === bMonth && today.day < bDay)) age--;
      return age;
    }

    const genderDist: Record<string, number> = {};
    const ageGroups: Record<string, number> = {};
    const jobDist: Record<string, number> = {};

    for (const p of patients) {
      const gender = p.gender === 1 ? "مرد" : p.gender === 21 ? "زن" : "نامشخص";
      genderDist[gender] = (genderDist[gender] ?? 0) + 1;

      const age = persianAge(p.birthDate);
      if (age !== null) {
        let group = "۶۰+";
        if (age < 18) group = "زیر ۱۸";
        else if (age < 30) group = "۱۸-۲۹";
        else if (age < 45) group = "۳۰-۴۴";
        else if (age < 60) group = "۴۵-۵۹";
        ageGroups[group] = (ageGroups[group] ?? 0) + 1;
      }

      const job = p.job || "نامشخص";
      jobDist[job] = (jobDist[job] ?? 0) + 1;
    }

    res.json({
      genderDistribution: Object.entries(genderDist).map(([name, count]) => ({ name, count })),
      ageDistribution: Object.entries(ageGroups).map(([name, count]) => ({ name, count })),
      jobDistribution: Object.entries(jobDist)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 15),
    });
  } catch (e) {
    next(e);
  }
});

analyticsRouter.get("/doctor-detail/:name", async (req, res, next) => {
  try {
    const name = decodeURIComponent(req.params.name);

    const [reserves, treatments] = await Promise.all([
      prisma.reserve.findMany({
        where: { doctorName: name },
        orderBy: [{ reserveDate: "desc" }, { reserveTime: "desc" }],
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

    const reservesWithPatient = reserves.map((r) => {
      let fullName: string | null = null;
      try { fullName = r.patient?.fullNameEnc ? decrypt(r.patient.fullNameEnc) : null; } catch {}
      return { ...r, patient: r.patient ? { externalCode: r.patient.externalCode, fullName } : null };
    });

    const treatmentsWithPatient = treatments.map((t) => {
      let fullName: string | null = null;
      try { fullName = t.patient?.fullNameEnc ? decrypt(t.patient.fullNameEnc) : null; } catch {}
      return { ...t, patient: t.patient ? { externalCode: t.patient.externalCode, fullName } : null };
    });

    const totalReserves = await prisma.reserve.count({ where: { doctorName: name } });
    const totalTreatments = await prisma.treatment.count({ where: { planUser: name, isDeleted: false } });

    res.json({
      doctorName: name,
      totalReserves,
      totalTreatments,
      reserves: reservesWithPatient,
      treatments: treatmentsWithPatient,
    });
  } catch (e) {
    next(e);
  }
});
