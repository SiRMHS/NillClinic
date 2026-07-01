import { Router } from "express";
import { prisma, type Prisma } from "@jordan/db";
import { z } from "zod";
import { createEncryptFn, decrypt } from "../security/encryption.js";

export const patientsRouter = Router();

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
});

patientsRouter.get("/", async (req, res, next) => {
  try {
    const { page, pageSize, search } = paginationSchema.parse(req.query);
    const skip = (page - 1) * pageSize;

    const where: Prisma.PatientWhereInput = {};
    if (search) {
      const code = Number(search);
      if (!Number.isNaN(code)) {
        where.externalCode = { equals: code };
      } else {
        where.OR = [
          { fullName: { contains: search, mode: "insensitive" } },
          { mobile: { contains: search } },
        ];
      }
    }

    const [total, raw] = await Promise.all([
      prisma.patient.count({ where }),
      prisma.patient.findMany({
        where,
        orderBy: { syncedAt: "desc" },
        skip,
        take: pageSize,
        include: {
          _count: { select: { treatments: true, reserves: true } },
        },
      }),
    ]);

    const decrypted = raw.map((p) => {
      try {
        return {
          ...p,
          fullName: p.fullName ?? decrypt(p.fullNameEnc),
          mobile: p.mobile ?? (p.mobileEnc ? decrypt(p.mobileEnc) : null),
          tel: p.telEnc ? decrypt(p.telEnc) : null,
          address: p.addressEnc ? decrypt(p.addressEnc) : null,
          fatherName: p.fatherNameEnc ? decrypt(p.fatherNameEnc) : null,
          hasTreatments: p._count.treatments > 0,
          hasReserves: p._count.reserves > 0,
          _count: undefined,
          fullNameEnc: undefined,
          mobileEnc: undefined,
          telEnc: undefined,
          addressEnc: undefined,
          fatherNameEnc: undefined,
        };
      } catch {
        return {
          ...p,
          fullName: p.fullName ?? `[encrypted] #${p.externalCode}`,
          mobile: null,
          tel: null,
          address: null,
          fatherName: null,
          hasTreatments: p._count.treatments > 0,
          hasReserves: p._count.reserves > 0,
          _count: undefined,
          fullNameEnc: undefined,
          mobileEnc: undefined,
          telEnc: undefined,
          addressEnc: undefined,
          fatherNameEnc: undefined,
        };
      }
    });

    res.json({
      data: decrypted,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (e) {
    next(e);
  }
});

patientsRouter.get("/:id", async (req, res, next) => {
  try {
    const patient = await prisma.patient.findUnique({
      where: { id: req.params.id },
      include: {
        treatments: { orderBy: { planDate: "desc" }, take: 50 },
        reserves: { orderBy: { reserveDate: "desc" }, take: 50 },
        receptions: { orderBy: { receptionDate: "desc" }, take: 50 },
      },
    });

    if (!patient) {
      res.status(404).json({ error: "بیمار یافت نشد" });
      return;
    }

    let fullName: string;
    let mobile: string | null = null;
    let tel: string | null = null;
    let address: string | null = null;
    let fatherName: string | null = null;
    try {
      fullName = patient.fullName ?? decrypt(patient.fullNameEnc);
      mobile = patient.mobile ?? (patient.mobileEnc ? decrypt(patient.mobileEnc) : null);
      tel = patient.telEnc ? decrypt(patient.telEnc) : null;
      address = patient.addressEnc ? decrypt(patient.addressEnc) : null;
      fatherName = patient.fatherNameEnc ? decrypt(patient.fatherNameEnc) : null;
    } catch {
      fullName = patient.fullName ?? `[encrypted] #${patient.externalCode}`;
    }

    res.json({
      ...patient,
      fullNameEnc: undefined,
      mobileEnc: undefined,
      telEnc: undefined,
      addressEnc: undefined,
      fatherNameEnc: undefined,
      fullName,
      mobile,
      tel,
      address,
      fatherName,
    });
  } catch (e) {
    next(e);
  }
});
