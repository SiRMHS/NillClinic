import { prisma, type Prisma } from "@jordan/db";
import {
  CRM_RATING_SCORE,
  NON_DOCTOR_NAME_PATTERNS,
  churnRisk,
  jalaliToDate,
  jalaliToSqlDate,
  joinCrmLabels,
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

/**
 * Trim, drop blanks, and de-duplicate a picked service list.
 *
 * The picker cannot produce duplicates, but an import or an API caller can, and
 * a service counted twice on one contact would inflate every per-service tally
 * that follows.
 */
function normalizeServiceList(values: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const raw of values) {
    const name = raw.trim();
    if (name) seen.add(name);
  }
  return [...seen];
}

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
  serviceNames: string[];
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
  referredDoctorName: string | null;
  treatmentDoctorName: string | null;
  treatmentServiceNames: string[];
  treatmentDate: string | null;
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
      serviceNames: row.serviceNames,
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
      referredDoctorName: row.referredDoctorName,
      treatmentDoctorName: row.treatmentDoctorName,
      treatmentServiceNames: row.treatmentServiceNames,
      treatmentDate: row.treatmentDate,
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
    if (q.referredDoctorName) {
      where.referredDoctorName = { contains: q.referredDoctorName, mode: "insensitive" };
    }
    // A service can sit on either side of the row — what the visit was for, or
    // what the referred treatment delivered — and the filter means "this row is
    // about that service", so both are searched. `serviceName` rather than the
    // array covers the imported rows whose services were never split out.
    if (q.serviceName) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        {
          OR: [
            { serviceNames: { has: q.serviceName } },
            { treatmentServiceNames: { has: q.serviceName } },
            { serviceName: { contains: q.serviceName, mode: "insensitive" } },
          ],
        },
      ];
    }
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
    } else if (q.segment === "referred") {
      where.referredDoctorName = { not: null };
    } else if (q.segment === "referred-pending") {
      // Sent on, nothing recorded back. This is the desk's own worklist: the
      // billed-lines report cannot show it, because a referral that never
      // turned into a treatment leaves no line to report on.
      where.referredDoctorName = { not: null };
      where.treatmentDoctorName = null;
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
      "kind", "doctorName", "visitDate", "amountText", "amount",
      "schedulingRating", "doctorRating", "assistantRating", "receptionRating", "hygieneRating",
      "referralLikelihood", "revisitLikelihood", "channels", "callResult",
      "suggestion", "notes", "rebookNote",
      "resultsOnset", "sideEffect", "overallOpinion",
      "painSwelling", "delayComplaint", "positiveNote", "doctorReferral",
      "patientSummary", "callCenterReferral", "resurveyDate", "resurveyResult",
      "referredDoctorName", "treatmentDoctorName", "treatmentDate",
    ] as const;

    for (const key of passthrough) {
      if (input[key] !== undefined) {
        (data as Record<string, unknown>)[key] = input[key];
      }
    }

    /**
     * The picked services and their text rendering are written together.
     *
     * `serviceName` stays the single searchable, exportable form — every filter
     * and every CSV column already reads it, and the rows imported from the
     * spreadsheet only ever had it. Deriving it from the picked list here means
     * the two cannot drift, and a client that sends only `serviceNames` gets a
     * correct text column without having to build the string itself.
     *
     * A caller that sends `serviceName` alone (the CSV importer, and any old
     * client) still writes it verbatim — free text is not thrown away just
     * because it does not match the catalogue.
     */
    if (input.serviceNames !== undefined) {
      const names = normalizeServiceList(input.serviceNames);
      data.serviceNames = names;
      data.serviceName = names.length > 0 ? joinCrmLabels(names) : (input.serviceName ?? null);
    } else if (input.serviceName !== undefined) {
      data.serviceName = input.serviceName;
    }

    if (input.treatmentServiceNames !== undefined) {
      data.treatmentServiceNames = normalizeServiceList(input.treatmentServiceNames);
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

  /**
   * Bulk insert from an uploaded file.
   *
   * Rows go in one at a time rather than through `createMany`, because each one
   * still has to resolve its patient by file number — that lookup is what stops
   * an import from creating a second identity for a patient the clinic already
   * knows. The whole batch runs in a transaction: a file that fails halfway
   * leaves nothing behind, so the operator re-uploads the corrected file
   * instead of hunting for which rows made it in.
   */
  async createMany(inputs: CrmContactInput[], userId: string | null): Promise<number> {
    if (inputs.length === 0) return 0;

    const prepared = await Promise.all(
      inputs.map(async (input) => ({
        ...((await this.toWriteData(input)) as Prisma.CrmContactUncheckedCreateInput),
        kind: input.kind,
        contactDate: input.contactDate,
        contactAt: jalaliToDate(input.contactDate),
        createdById: userId,
      })),
    );

    await prisma.$transaction(
      prepared.map((data) => prisma.crmContact.create({ data, select: { id: true } })),
    );
    return prepared.length;
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
   * Fold imported rows into the existing grid.
   *
   * Unlike `saveSchedule`, which is the grid editor saving what is on screen,
   * an import speaks only about the doctors in the file — anyone absent from it
   * keeps the shifts they already had. `replace` is offered for the other
   * reading, where the file *is* the new schedule.
   */
  async mergeSchedule(
    entries: { doctorName: string; weekday: number; note: string | null }[],
    mode: "merge" | "replace" = "merge",
  ) {
    const kept = entries
      .filter((e) => e.note && e.note.trim() !== "")
      .map((e) => ({ doctorName: e.doctorName.trim(), weekday: e.weekday, note: e.note!.trim() }));

    await prisma.$transaction(async (tx) => {
      if (mode === "replace") {
        await tx.crmDoctorSchedule.deleteMany({});
      } else if (kept.length > 0) {
        // Only the doctors the file mentions are cleared, so a doctor whose row
        // dropped a day in Excel loses that day rather than keeping a stale one.
        await tx.crmDoctorSchedule.deleteMany({
          where: { doctorName: { in: [...new Set(kept.map((e) => e.doctorName))] } },
        });
      }
      if (kept.length > 0) {
        await tx.crmDoctorSchedule.createMany({ data: kept, skipDuplicates: true });
      }
    });

    return this.schedule();
  }

  // ─── Referral reporting ───

  /**
   * Where consultations were sent, and what came back.
   *
   * Distinct from `ReferralService`, which reconstructs the same journey from
   * billed lines. That report is authoritative on money and blind to anything
   * unbilled; this one is the desk's own record, so it sees the referral the
   * day it is made — including the ones that never turn into a treatment,
   * which are precisely the rows worth chasing.
   */
  async referrals(q: Pick<CrmContactQuery, "from" | "to" | "kind">) {
    const rows = (
      await this.listAll({ ...q, segment: "all", page: 1, pageSize: 1 } as CrmContactQuery, 20000)
    ).filter((r) => Boolean(r.referredDoctorName?.trim()));

    interface Bucket {
      referredDoctorName: string;
      referrals: number;
      treated: number;
      pending: number;
      /** Consulting doctors who sent patients here, biggest sender first. */
      fromDoctors: Map<string, number>;
      /** Who actually delivered the treatment — not always who it was sent to. */
      treatedBy: Map<string, number>;
      services: Map<string, number>;
      patients: Set<string>;
    }

    const buckets = new Map<string, Bucket>();
    const bump = (map: Map<string, number>, key: string | null | undefined) => {
      const name = key?.trim();
      if (name) map.set(name, (map.get(name) ?? 0) + 1);
    };

    for (const r of rows) {
      const to = r.referredDoctorName!.trim();
      const bucket = buckets.get(to) ?? {
        referredDoctorName: to,
        referrals: 0,
        treated: 0,
        pending: 0,
        fromDoctors: new Map<string, number>(),
        treatedBy: new Map<string, number>(),
        services: new Map<string, number>(),
        patients: new Set<string>(),
      };

      bucket.referrals += 1;
      // Falls back to the row id so an anonymous walk-in still counts as one
      // patient rather than collapsing every one of them into a single entry.
      bucket.patients.add(String(r.patientExternalCode ?? r.patientName ?? r.id));
      bump(bucket.fromDoctors, r.doctorName);

      if (r.treatmentDoctorName?.trim()) {
        bucket.treated += 1;
        bump(bucket.treatedBy, r.treatmentDoctorName);
      } else {
        bucket.pending += 1;
      }
      for (const service of r.treatmentServiceNames) bump(bucket.services, service);

      buckets.set(to, bucket);
    }

    const rank = (map: Map<string, number>, limit = 10) =>
      [...map.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fa"))
        .slice(0, limit)
        .map(([name, count]) => ({ name, count }));

    const byDoctor = [...buckets.values()]
      .map((b) => ({
        referredDoctorName: b.referredDoctorName,
        referrals: b.referrals,
        patients: b.patients.size,
        treated: b.treated,
        pending: b.pending,
        // Of the referrals sent here, how many produced a recorded treatment.
        completionRate: b.referrals > 0 ? Math.round((b.treated / b.referrals) * 1000) / 10 : null,
        fromDoctors: rank(b.fromDoctors),
        treatedBy: rank(b.treatedBy),
        services: rank(b.services),
      }))
      .sort((a, b) => b.referrals - a.referrals);

    const treated = rows.filter((r) => Boolean(r.treatmentDoctorName?.trim()));
    const serviceTotals = new Map<string, number>();
    for (const r of rows) for (const service of r.treatmentServiceNames) bump(serviceTotals, service);

    return {
      totalReferrals: rows.length,
      treatedCount: treated.length,
      pendingCount: rows.length - treated.length,
      completionRate: rows.length ? Math.round((treated.length / rows.length) * 1000) / 10 : null,
      /**
       * Referrals whose treatment was delivered by someone other than the doctor
       * they were sent to. Small numbers are normal (cover, scheduling); a large
       * share means the referral is not landing where the consultant intends.
       */
      redirectedCount: treated.filter(
        (r) => r.treatmentDoctorName!.trim() !== r.referredDoctorName!.trim(),
      ).length,
      byDoctor,
      topServices: rank(serviceTotals, 20),
    };
  }

  // ─── Reference data for the entry form ───

  /**
   * The clinic's service catalogue, grouped by section.
   *
   * The form used to take services as free text, which meant the same procedure
   * arrived spelled four ways and could not be grouped afterwards. The list is
   * the synced `services` table — the same names the billing lines carry — so a
   * CRM row and a reception line agree on what a service is called.
   */
  async serviceCatalogue(): Promise<{ section: string; services: string[] }[]> {
    const rows = await prisma.service.findMany({
      select: { name: true, sectionName: true },
      orderBy: [{ sectionName: "asc" }, { name: "asc" }],
    });

    const bySection = new Map<string, Set<string>>();
    for (const row of rows) {
      const name = row.name.trim();
      if (!name) continue;
      // The synced section is nullable-ish (blank on some rows); an unlabelled
      // service still has to be pickable, so it gets its own group rather than
      // being dropped.
      const section = row.sectionName?.trim() || "سایر";
      const set = bySection.get(section) ?? new Set<string>();
      set.add(name);
      bySection.set(section, set);
    }

    return [...bySection.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "fa"))
      .map(([section, names]) => ({
        section,
        services: [...names].sort((a, b) => a.localeCompare(b, "fa")),
      }));
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
