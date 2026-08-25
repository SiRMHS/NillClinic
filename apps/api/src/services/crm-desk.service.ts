import { prisma, type Prisma } from "@jordan/db";
import {
  CRM_RATING_SCORE,
  NON_DOCTOR_NAME_PATTERNS,
  churnRisk,
  jalaliToDate,
  jalaliToSqlDate,
  loyaltyScore,
  npsBucket,
  npsScore,
  riskLevel,
  satisfactionPercent,
  type CrmContactInput,
  type CrmContactQuery,
  type CrmLikelihood,
  type CrmRating,
  type CrmRatingField,
} from "@jordan/shared";
import { createEncryptFn, decrypt } from "../security/encryption.js";

const encrypt = createEncryptFn();

type ContactRow = Prisma.CrmContactGetPayload<{
  include: { createdBy: { select: { id: true; fullName: true } } };
}>;

/** Shape returned to the client: decrypted identity plus the derived scores. */
export interface CrmContactView {
  id: string;
  kind: ContactRow["kind"];
  patientId: string | null;
  patientExternalCode: number | null;
  patientName: string | null;
  patientMobile: string | null;
  doctorName: string | null;
  visitDate: string | null;
  contactDate: string;
  serviceName: string | null;
  amountText: string | null;
  amount: number | null;
  schedulingRating: CrmRating | null;
  doctorRating: CrmRating | null;
  assistantRating: CrmRating | null;
  receptionRating: CrmRating | null;
  hygieneRating: CrmRating | null;
  referralLikelihood: CrmLikelihood | null;
  revisitLikelihood: CrmLikelihood | null;
  channels: ContactRow["channels"];
  callResult: ContactRow["callResult"];
  suggestion: string | null;
  notes: string | null;
  rebookNote: string | null;
  resultsOnset: string | null;
  sideEffect: string | null;
  overallOpinion: string | null;
  painSwelling: string | null;
  delayComplaint: string | null;
  positiveNote: string | null;
  doctorReferral: string | null;
  patientSummary: string | null;
  callCenterReferral: string | null;
  resurveyDate: string | null;
  resurveyResult: string | null;
  createdBy: { id: string; fullName: string | null } | null;
  createdAt: Date;
  // Derived — computed here so the table, the CSV and the KPI tiles cannot
  // disagree about what a row scores.
  satisfaction: number | null;
  npsBucket: ReturnType<typeof npsBucket>;
  churnRisk: number | null;
  riskLevel: ReturnType<typeof riskLevel>;
  loyalty: number | null;
}

export class CrmDeskService {
  private decryptOr(enc: string | null, plain: string | null): string | null {
    if (plain) return plain;
    if (!enc) return null;
    try {
      return decrypt(enc);
    } catch {
      return null;
    }
  }

  private toNumber(value: Prisma.Decimal | null): number | null {
    if (value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  private toView(row: ContactRow): CrmContactView {
    const ratings = {
      schedulingRating: row.schedulingRating,
      doctorRating: row.doctorRating,
      assistantRating: row.assistantRating,
      receptionRating: row.receptionRating,
      hygieneRating: row.hygieneRating,
    };
    const risk = churnRisk({ ...ratings, revisitLikelihood: row.revisitLikelihood });

    return {
      id: row.id,
      kind: row.kind,
      patientId: row.patientId,
      patientExternalCode: row.patientExternalCode,
      patientName: this.decryptOr(row.patientNameEnc, row.patientName),
      patientMobile: this.decryptOr(row.patientMobileEnc, row.patientMobile),
      doctorName: row.doctorName,
      visitDate: row.visitDate,
      contactDate: row.contactDate,
      serviceName: row.serviceName,
      amountText: row.amountText,
      amount: this.toNumber(row.amount),
      ...ratings,
      referralLikelihood: row.referralLikelihood,
      revisitLikelihood: row.revisitLikelihood,
      channels: row.channels,
      callResult: row.callResult,
      suggestion: row.suggestion,
      notes: row.notes,
      rebookNote: row.rebookNote,
      resultsOnset: row.resultsOnset,
      sideEffect: row.sideEffect,
      overallOpinion: row.overallOpinion,
      painSwelling: row.painSwelling,
      delayComplaint: row.delayComplaint,
      positiveNote: row.positiveNote,
      doctorReferral: row.doctorReferral,
      patientSummary: row.patientSummary,
      callCenterReferral: row.callCenterReferral,
      resurveyDate: row.resurveyDate,
      resurveyResult: row.resurveyResult,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      satisfaction: satisfactionPercent(ratings),
      npsBucket: npsBucket(row.referralLikelihood),
      churnRisk: risk,
      riskLevel: riskLevel(risk),
      loyalty: loyaltyScore({
        ...ratings,
        referralLikelihood: row.referralLikelihood,
        revisitLikelihood: row.revisitLikelihood,
      }),
    };
  }

  /**
   * Segment filters that need a derived score are applied after the query.
   *
   * Churn risk and loyalty are weighted blends of five nullable enum columns —
   * expressible in SQL only as a large CASE tree that would then have to be
   * kept in step with the TypeScript version by hand. Filtering in memory keeps
   * one definition of the score; the cost is bounded because these segments run
   * against a date-windowed set, not the whole table.
   */
  private static readonly DERIVED_SEGMENTS = new Set(["risky", "promoters", "detractors"]);

  private buildWhere(q: CrmContactQuery): Prisma.CrmContactWhereInput {
    const where: Prisma.CrmContactWhereInput = {};
    if (q.kind) where.kind = q.kind;
    if (q.doctorName) where.doctorName = { contains: q.doctorName, mode: "insensitive" };
    if (q.callResult) where.callResult = q.callResult;

    const from = q.from ? jalaliToSqlDate(q.from) : null;
    const to = q.to ? jalaliToSqlDate(q.to) : null;
    if (from || to) {
      where.contactAt = {};
      if (from) where.contactAt.gte = new Date(`${from}T00:00:00.000Z`);
      // Inclusive upper bound: the range picker's `to` is a day the user means
      // to see, and a bare `lte` on midnight would drop everything logged that day.
      if (to) where.contactAt.lte = new Date(`${to}T23:59:59.999Z`);
    }

    if (q.search) {
      const code = Number(q.search);
      where.OR = [
        { patientName: { contains: q.search, mode: "insensitive" } },
        { patientMobile: { contains: q.search } },
        { doctorName: { contains: q.search, mode: "insensitive" } },
        { serviceName: { contains: q.search, mode: "insensitive" } },
        { notes: { contains: q.search, mode: "insensitive" } },
        ...(Number.isInteger(code) && code > 0 ? [{ patientExternalCode: code }] : []),
      ];
    }

    if (q.segment === "unanswered") {
      where.callResult = { in: ["NO_ANSWER", "UNREACHABLE", "UNAVAILABLE", "WRONG_NUMBER"] };
    } else if (q.segment === "rebook") {
      where.rebookNote = { not: null };
    }

    return where;
  }

  private matchesSegment(view: CrmContactView, segment: CrmContactQuery["segment"]): boolean {
    if (segment === "risky") return view.riskLevel === "HIGH";
    if (segment === "promoters") return view.npsBucket === "PROMOTER";
    if (segment === "detractors") return view.npsBucket === "DETRACTOR";
    return true;
  }

  async list(q: CrmContactQuery): Promise<{
    data: CrmContactView[];
    pagination: { page: number; pageSize: number; total: number; totalPages: number };
  }> {
    const where = this.buildWhere(q);
    const include = { createdBy: { select: { id: true, fullName: true } } } as const;
    const orderBy: Prisma.CrmContactOrderByWithRelationInput[] = [
      { contactAt: "desc" },
      { createdAt: "desc" },
    ];

    if (CrmDeskService.DERIVED_SEGMENTS.has(q.segment)) {
      const rows = await prisma.crmContact.findMany({ where, orderBy, include, take: 5000 });
      const filtered = rows.map((r) => this.toView(r)).filter((v) => this.matchesSegment(v, q.segment));
      const total = filtered.length;
      const start = (q.page - 1) * q.pageSize;
      return {
        data: filtered.slice(start, start + q.pageSize),
        pagination: {
          page: q.page,
          pageSize: q.pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
        },
      };
    }

    const [total, rows] = await Promise.all([
      prisma.crmContact.count({ where }),
      prisma.crmContact.findMany({
        where,
        orderBy,
        include,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);

    return {
      data: rows.map((r) => this.toView(r)),
      pagination: {
        page: q.page,
        pageSize: q.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
      },
    };
  }

  /** Every matching row, for the CSV export. Capped so one click cannot pull the table into memory. */
  async listAll(q: CrmContactQuery, cap = 5000): Promise<CrmContactView[]> {
    const rows = await prisma.crmContact.findMany({
      where: this.buildWhere(q),
      orderBy: [{ contactAt: "desc" }, { createdAt: "desc" }],
      include: { createdBy: { select: { id: true, fullName: true } } },
      take: cap,
    });
    return rows.map((r) => this.toView(r)).filter((v) => this.matchesSegment(v, q.segment));
  }

  async get(id: string): Promise<CrmContactView | null> {
    const row = await prisma.crmContact.findUnique({
      where: { id },
      include: { createdBy: { select: { id: true, fullName: true } } },
    });
    return row ? this.toView(row) : null;
  }

  /**
   * Resolve the patient a contact refers to.
   *
   * The desk types a file number; everything else about the patient (name,
   * mobile, and the link used to open their record) is filled from the synced
   * patient so a typo in the name does not create a second identity for
   * someone the system already knows.
   */
  private async resolvePatient(input: Partial<CrmContactInput>) {
    if (input.patientId) {
      const p = await prisma.patient.findUnique({ where: { id: input.patientId } });
      if (p) return p;
    }
    if (input.patientExternalCode) {
      const p = await prisma.patient.findUnique({
        where: { externalCode: input.patientExternalCode },
      });
      if (p) return p;
    }
    return null;
  }

  private async toWriteData(
    input: Partial<CrmContactInput>,
  ): Promise<Prisma.CrmContactUncheckedUpdateInput> {
    const data: Prisma.CrmContactUncheckedUpdateInput = {};

    const patient = await this.resolvePatient(input);
    if (patient) {
      data.patientId = patient.id;
      data.patientExternalCode = patient.externalCode;
    } else {
      if (input.patientId !== undefined) data.patientId = input.patientId;
      if (input.patientExternalCode !== undefined) {
        data.patientExternalCode = input.patientExternalCode;
      }
    }

    const name =
      (patient ? (patient.fullName ?? this.decryptOr(patient.fullNameEnc, null)) : null) ??
      input.patientName ??
      null;
    if (name !== null || input.patientName !== undefined) {
      data.patientName = name;
      data.patientNameEnc = name ? encrypt(name) : null;
    }

    const mobile =
      (patient ? (patient.mobile ?? this.decryptOr(patient.mobileEnc, null)) : null) ??
      input.patientMobile ??
      null;
    if (mobile !== null || input.patientMobile !== undefined) {
      data.patientMobile = mobile;
      data.patientMobileEnc = mobile ? encrypt(mobile) : null;
    }

    if (input.contactDate !== undefined) {
      data.contactDate = input.contactDate;
      data.contactAt = input.contactDate ? jalaliToDate(input.contactDate) : null;
    }

    const passthrough = [
      "kind", "doctorName", "visitDate", "serviceName", "amountText", "amount",
      "schedulingRating", "doctorRating", "assistantRating", "receptionRating", "hygieneRating",
      "referralLikelihood", "revisitLikelihood", "channels", "callResult",
      "suggestion", "notes", "rebookNote",
      "resultsOnset", "sideEffect", "overallOpinion",
      "painSwelling", "delayComplaint", "positiveNote", "doctorReferral",
      "patientSummary", "callCenterReferral", "resurveyDate", "resurveyResult",
    ] as const;

    for (const key of passthrough) {
      if (input[key] !== undefined) {
        (data as Record<string, unknown>)[key] = input[key];
      }
    }

    return data;
  }

  async create(input: CrmContactInput, userId: string | null): Promise<CrmContactView> {
    const data = await this.toWriteData(input);
    const created = await prisma.crmContact.create({
      data: {
        ...(data as Prisma.CrmContactUncheckedCreateInput),
        kind: input.kind,
        contactDate: input.contactDate,
        contactAt: jalaliToDate(input.contactDate),
        createdById: userId,
      },
      include: { createdBy: { select: { id: true, fullName: true } } },
    });
    return this.toView(created);
  }

  async update(id: string, input: Partial<CrmContactInput>): Promise<CrmContactView | null> {
    const existing = await prisma.crmContact.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return null;

    const updated = await prisma.crmContact.update({
      where: { id },
      data: await this.toWriteData(input),
      include: { createdBy: { select: { id: true, fullName: true } } },
    });
    return this.toView(updated);
  }

  async remove(id: string): Promise<boolean> {
    const existing = await prisma.crmContact.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return false;
    await prisma.crmContact.delete({ where: { id } });
    return true;
  }

  // ─── Aggregates ───

  /** The `نمودار و KPI` sheet. */
  async kpi(q: Pick<CrmContactQuery, "from" | "to" | "kind">) {
    const rows = await this.listAll(
      { ...q, segment: "all", page: 1, pageSize: 1 } as CrmContactQuery,
      20000,
    );

    const rated = rows.filter((r) => r.satisfaction !== null);
    const answered = rows.filter((r) => r.callResult === "ANSWERED" || r.kind === "SURVEY");
    const rebooks = rows.filter((r) => Boolean(r.rebookNote));
    const atRisk = rows.filter((r) => r.riskLevel === "HIGH");
    const revenue = rows.reduce((sum, r) => sum + (r.amount ?? 0), 0);

    const dimensionAverages = (
      [
        ["schedulingRating", "وقت‌دهی"],
        ["doctorRating", "پزشک"],
        ["assistantRating", "دستیار"],
        ["receptionRating", "پذیرش"],
        ["hygieneRating", "بهداشت"],
      ] as const
    ).map(([key, label]) => {
      const scores = rows
        .map((r) => r[key])
        .filter((v): v is CrmRating => Boolean(v))
        .map((v) => CRM_RATING_SCORE[v]);
      return {
        key,
        label,
        average: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : null,
        responses: scores.length,
      };
    });

    // Month-by-month trend, keyed on the Jalali year/month the contact was
    // logged in — the unit the clinic actually reviews these in.
    const byMonth = new Map<string, { contacts: number; satisfaction: number[]; nps: (CrmLikelihood | null)[] }>();
    for (const r of rows) {
      const key = r.contactDate.split("/").slice(0, 2).join("/");
      const entry = byMonth.get(key) ?? { contacts: 0, satisfaction: [], nps: [] };
      entry.contacts += 1;
      if (r.satisfaction !== null) entry.satisfaction.push(r.satisfaction);
      if (r.referralLikelihood) entry.nps.push(r.referralLikelihood);
      byMonth.set(key, entry);
    }

    const trend = [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, e]) => ({
        period,
        contacts: e.contacts,
        satisfaction: e.satisfaction.length
          ? Math.round((e.satisfaction.reduce((a, b) => a + b, 0) / e.satisfaction.length) * 10) / 10
          : null,
        nps: npsScore(e.nps),
      }));

    const channelCounts = new Map<string, number>();
    for (const r of rows) {
      for (const c of r.channels) channelCounts.set(c, (channelCounts.get(c) ?? 0) + 1);
    }

    return {
      totalContacts: rows.length,
      ratedContacts: rated.length,
      answeredContacts: answered.length,
      answerRate: rows.length ? Math.round((answered.length / rows.length) * 1000) / 10 : null,
      satisfaction: rated.length
        ? Math.round((rated.reduce((s, r) => s + (r.satisfaction ?? 0), 0) / rated.length) * 10) / 10
        : null,
      nps: npsScore(rows.map((r) => r.referralLikelihood)),
      rebookRate: rows.length ? Math.round((rebooks.length / rows.length) * 1000) / 10 : null,
      rebookCount: rebooks.length,
      atRiskCount: atRisk.length,
      revenue,
      dimensionAverages,
      trend,
      channels: [...channelCounts.entries()]
        .map(([channel, count]) => ({ channel, count }))
        .sort((a, b) => b.count - a.count),
    };
  }

  /** The `امتیاز دهی بیماران` sheet: one scorecard row per doctor. */
  async doctorScores(q: Pick<CrmContactQuery, "from" | "to" | "kind">) {
    const rows = await this.listAll(
      { ...q, segment: "all", page: 1, pageSize: 1 } as CrmContactQuery,
      20000,
    );

    const byDoctor = new Map<string, CrmContactView[]>();
    for (const r of rows) {
      const name = r.doctorName?.trim();
      if (!name) continue;
      const list = byDoctor.get(name) ?? [];
      list.push(r);
      byDoctor.set(name, list);
    }

    const mean = (values: number[]) =>
      values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100 : null;

    return [...byDoctor.entries()]
      .map(([doctorName, list]) => {
        const dimension = (key: CrmRatingField) =>
          mean(
            list
              .map((r) => r[key])
              .filter((v): v is CrmRating => Boolean(v))
              .map((v) => CRM_RATING_SCORE[v]),
          );

        const dims = {
          scheduling: dimension("schedulingRating"),
          doctor: dimension("doctorRating"),
          assistant: dimension("assistantRating"),
          reception: dimension("receptionRating"),
          hygiene: dimension("hygieneRating"),
        };

        const loyalties = list.map((r) => r.loyalty).filter((v): v is number => v !== null);
        const risks = list.map((r) => r.churnRisk).filter((v): v is number => v !== null);
        const satisfactions = list.map((r) => r.satisfaction).filter((v): v is number => v !== null);
        const avgLoyalty = mean(loyalties);
        const nps = npsScore(list.map((r) => r.referralLikelihood));

        return {
          doctorName,
          contacts: list.length,
          patients: new Set(
            list.map((r) => r.patientExternalCode ?? r.patientName ?? r.id),
          ).size,
          satisfaction: mean(satisfactions),
          ...dims,
          nps,
          churnRisk: mean(risks),
          highRiskCount: list.filter((r) => r.riskLevel === "HIGH").length,
          loyalty: avgLoyalty,
          // "VIP" in the sheet flagged doctors whose patients both score them
          // highly and say they will come back — worth investing behind.
          vip: avgLoyalty !== null && avgLoyalty >= 85 && (nps ?? 0) >= 50,
          revenue: list.reduce((s, r) => s + (r.amount ?? 0), 0),
        };
      })
      // By volume, not by score: the sheet's doctor names are free text, so
      // typos and one-off spellings each produce a single-contact row that
      // would otherwise sit at the top of the table on a perfect 100.
      .sort((a, b) => b.contacts - a.contacts || (b.satisfaction ?? 0) - (a.satisfaction ?? 0));
  }

  // ─── Doctor weekday schedule ───

  async schedule() {
    return prisma.crmDoctorSchedule.findMany({
      orderBy: [{ doctorName: "asc" }, { weekday: "asc" }],
    });
  }

  /**
   * Replace the whole grid in one transaction.
   *
   * The sheet was edited as a grid, and saving cell-by-cell would leave the
   * table half-updated if the request failed midway. Blank notes are deleted
   * rather than stored, so "not in" and "in, no note" stay distinguishable.
   */
  async saveSchedule(entries: { doctorName: string; weekday: number; note: string | null }[]) {
    await prisma.$transaction(async (tx) => {
      await tx.crmDoctorSchedule.deleteMany({});
      const kept = entries.filter((e) => e.note && e.note.trim() !== "");
      if (kept.length > 0) {
        await tx.crmDoctorSchedule.createMany({
          data: kept.map((e) => ({
            doctorName: e.doctorName.trim(),
            weekday: e.weekday,
            note: e.note!.trim(),
          })),
          skipDuplicates: true,
        });
      }
    });
    return this.schedule();
  }

  /**
   * Doctor names offered in the filters and the entry form.
   *
   * `personnelName` on a billed line is not always a person — the column also
   * carries acquisition channels and procedure categories ("‌. تلویزیون",
   * "مشاوره…"), which is what `NON_DOCTOR_NAME_PATTERNS` exists to strip.
   * Without it the dropdown listed 316 entries, most of them not doctors.
   */
  async doctorNames(): Promise<string[]> {
    const [fromContacts, fromItems] = await Promise.all([
      prisma.crmContact.findMany({
        where: { doctorName: { not: null } },
        select: { doctorName: true },
        distinct: ["doctorName"],
        take: 500,
      }),
      prisma.receptionItem.findMany({
        where: { personnelName: { not: null } },
        select: { personnelName: true },
        distinct: ["personnelName"],
        take: 500,
      }),
    ]);

    // The shared patterns are SQL LIKE forms; `%` is a trailing wildcard.
    const excluded = NON_DOCTOR_NAME_PATTERNS.map((p) => p.replace(/%$/, ""));
    // A one-character cell is punctuation left in the column, not a name.
    const isDoctor = (name: string) => name.length > 1 && !excluded.some((p) => name.startsWith(p));

    // `personnel_name` is multi-valued ("A، B") for shared work, so the raw
    // column yields combined entries that match no single doctor. Splitting
    // gives the list of individuals the filter is actually asking for.
    const names = new Set<string>();
    const add = (raw: string | null) => {
      for (const part of (raw ?? "").split(/[،,]/)) {
        const n = part.trim();
        if (n && isDoctor(n)) names.add(n);
      }
    };
    for (const r of fromContacts) add(r.doctorName);
    for (const r of fromItems) add(r.personnelName);
    return [...names].sort((a, b) => a.localeCompare(b, "fa"));
  }
}
