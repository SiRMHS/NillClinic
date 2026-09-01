import { prisma } from "@jordan/db";
import { jalaliToSqlDate, dateToJalali, type FinancialRange } from "@jordan/shared";

/**
 * Visitor analytics over reception line items.
 *
 * The clinic's funnel is visible in the service catalogue itself: everything
 * named ویزیت/مشاوره is an entry point (ویزیت alone accounts for ~36k lines and
 * مشاوره ~7k, nearly all in the عمومی section), and every other service is
 * billable work. That single distinction drives conversion, doctor ranking and
 * return-rate reporting, so it is defined once here rather than guessed per
 * query.
 */
const CONSULTATION_PATTERN = "(ویزیت|مشاوره)";

/** SQL predicate marking a line as an entry point rather than billable work. */
const IS_CONSULTATION = `(service_name ~ '${CONSULTATION_PATTERN}')`;
const IS_PROCEDURE = `(service_name IS NOT NULL AND service_name !~ '${CONSULTATION_PATTERN}')`;

export interface ServicePopularity {
  serviceExternalId: number | null;
  serviceName: string;
  sectionName: string | null;
  kind: "consultation" | "procedure";
  receptionCount: number;
  patientCount: number;
  revenue: number;
  averagePrice: number;
  /** Share of all procedure lines in the period. */
  share: number;
}

export interface ConversionSummary {
  consultedPatients: number;
  convertedPatients: number;
  conversionRate: number;
  /** Median days from first consultation to first procedure. */
  medianDaysToConvert: number | null;
  consultationLines: number;
  procedureLines: number;
  /** Revenue earned from patients who converted. */
  convertedRevenue: number;
  /** Mean procedure revenue per converted patient. */
  revenuePerConverted: number;
}

export interface ConversionByType {
  consultationName: string;
  consultedPatients: number;
  convertedPatients: number;
  conversionRate: number;
  revenueAfter: number;
}

export interface DoctorRanking {
  personnelName: string;
  revenue: number;
  patientCount: number;
  receptionCount: number;
  procedureLines: number;
  consultationLines: number;
  averageTicket: number;
  /** Share of this doctor's patients who came back at least once. */
  repeatPatientRate: number;
  /** Of patients this doctor consulted, share that went on to a procedure. */
  conversionRate: number | null;
  revenueShare: number;
}

export interface RetentionSummary {
  totalPatients: number;
  returningPatients: number;
  returnRate: number;
  averageVisitsPerPatient: number;
  /** Median days between consecutive visits. */
  medianDaysBetweenVisits: number | null;
  singleVisitPatients: number;
}

export interface VisitFrequencyBucket {
  visits: string;
  patientCount: number;
  revenue: number;
}

export interface FollowUpCandidate {
  patientExternalCode: number;
  patientId: string | null;
  fullName: string | null;
  mobile: string | null;
  lastVisitDate: string | null;
  daysSinceLastVisit: number;
  visitCount: number;
  totalReceived: number;
  lastServices: string | null;
}

export class VisitorAnalyticsService {
  private rangeClause(range: FinancialRange, param: { i: number }, alias = "") {
    const prefix = alias ? `${alias}.` : "";
    const params: unknown[] = [];
    const parts: string[] = [`${prefix}reception_at IS NOT NULL`];

    const from = range.from ? jalaliToSqlDate(range.from) : null;
    const to = range.to ? jalaliToSqlDate(range.to) : null;

    if (from) {
      parts.push(`${prefix}reception_at >= $${param.i++}::timestamp`);
      params.push(from);
    }
    if (to) {
      parts.push(`${prefix}reception_at < ($${param.i++}::timestamp + interval '1 day')`);
      params.push(to);
    }
    return { sql: `WHERE ${parts.join(" AND ")}`, params };
  }

  private num(value: unknown): number {
    if (value === null || value === undefined) return 0;
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Most and least performed services.
   * Consultations are reported separately: ویزیت outnumbers every real service
   * several-fold, so leaving it in makes the "popular services" list useless.
   */
  async getServicePopularity(
    range: FinancialRange = {},
    opts: { limit?: number; kind?: "procedure" | "consultation" | "all" } = {},
  ): Promise<{ top: ServicePopularity[]; bottom: ServicePopularity[] }> {
    const limit = opts.limit ?? 10;
    const kind = opts.kind ?? "procedure";
    const p = { i: 1 };
    const { sql: where, params } = this.rangeClause(range, p);

    const kindFilter =
      kind === "procedure" ? ` AND ${IS_PROCEDURE}`
      : kind === "consultation" ? ` AND ${IS_CONSULTATION}`
      : "";

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT service_external_id,
              COALESCE(service_name, 'نامشخص')            AS service_name,
              MIN(section_name)                           AS section_name,
              ${IS_CONSULTATION}                          AS is_consultation,
              COUNT(DISTINCT reception_external_id)::int  AS reception_count,
              COUNT(DISTINCT patient_external_code)::int  AS patient_count,
              COALESCE(SUM(received_price), 0)::text      AS revenue
       FROM reception_items
       ${where}${kindFilter}
       GROUP BY service_external_id, COALESCE(service_name, 'نامشخص'), ${IS_CONSULTATION}
       ORDER BY reception_count DESC`,
      ...params,
    );

    const total = rows.reduce((sum, r) => sum + this.num(r.reception_count), 0);

    const mapped: ServicePopularity[] = rows.map((r) => {
      const receptionCount = this.num(r.reception_count);
      const revenue = this.num(r.revenue);
      return {
        serviceExternalId: r.service_external_id === null ? null : this.num(r.service_external_id),
        serviceName: String(r.service_name),
        sectionName: r.section_name === null ? null : String(r.section_name),
        kind: r.is_consultation === true ? "consultation" : "procedure",
        receptionCount,
        patientCount: this.num(r.patient_count),
        revenue,
        averagePrice: receptionCount > 0 ? revenue / receptionCount : 0,
        share: total > 0 ? receptionCount / total : 0,
      };
    });

    return {
      top: mapped.slice(0, limit),
      // Least-performed, but still actually performed — a service with zero
      // receptions in the period simply is not in the result set.
      bottom: mapped.slice(-limit).reverse(),
    };
  }

  /**
   * Consultation → procedure conversion.
   *
   * A patient counts as converted when they received a billable procedure on or
   * after the day of their first consultation. Same-day counts: at this clinic
   * the consultation and the procedure frequently share one reception.
   */
  async getConversionSummary(range: FinancialRange = {}): Promise<ConversionSummary> {
    const p = { i: 1 };
    const { sql: where, params } = this.rangeClause(range, p);

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `WITH scoped AS (
         SELECT patient_external_code AS pid, reception_at, received_price,
                ${IS_CONSULTATION} AS is_cons
         FROM reception_items ${where} AND patient_external_code IS NOT NULL
       ),
       cons AS (
         SELECT pid, MIN(reception_at) AS first_cons FROM scoped WHERE is_cons GROUP BY pid
       ),
       proc AS (
         SELECT pid, MIN(reception_at) AS first_proc,
                SUM(received_price) AS proc_revenue
         FROM scoped WHERE NOT is_cons GROUP BY pid
       ),
       joined AS (
         SELECT c.pid, c.first_cons, pr.first_proc, pr.proc_revenue
         FROM cons c
         LEFT JOIN proc pr ON pr.pid = c.pid AND pr.first_proc >= c.first_cons::date
       )
       SELECT
         COUNT(*)::int                                                AS consulted,
         COUNT(*) FILTER (WHERE first_proc IS NOT NULL)::int          AS converted,
         COALESCE(SUM(proc_revenue) FILTER (WHERE first_proc IS NOT NULL), 0)::text AS converted_revenue,
         PERCENTILE_CONT(0.5) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM (first_proc - first_cons)) / 86400
         ) FILTER (WHERE first_proc IS NOT NULL)                      AS median_days,
         (SELECT COUNT(*) FROM scoped WHERE is_cons)::int             AS consultation_lines,
         (SELECT COUNT(*) FROM scoped WHERE NOT is_cons)::int         AS procedure_lines
       FROM joined`,
      ...params,
    );

    const r = rows[0] ?? {};
    const consulted = this.num(r.consulted);
    const converted = this.num(r.converted);
    const convertedRevenue = this.num(r.converted_revenue);

    return {
      consultedPatients: consulted,
      convertedPatients: converted,
      conversionRate: consulted > 0 ? converted / consulted : 0,
      medianDaysToConvert: r.median_days === null || r.median_days === undefined
        ? null
        : Math.round(this.num(r.median_days)),
      consultationLines: this.num(r.consultation_lines),
      procedureLines: this.num(r.procedure_lines),
      convertedRevenue,
      revenuePerConverted: converted > 0 ? convertedRevenue / converted : 0,
    };
  }

  /** Conversion broken out per consultation type (ویزیت vs مشاوره زیبایی…). */
  async getConversionByType(range: FinancialRange = {}): Promise<ConversionByType[]> {
    const p = { i: 1 };
    const { sql: where, params } = this.rangeClause(range, p);

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `WITH scoped AS (
         SELECT patient_external_code AS pid, reception_at, received_price, service_name,
                ${IS_CONSULTATION} AS is_cons
         FROM reception_items ${where} AND patient_external_code IS NOT NULL
       ),
       cons AS (
         SELECT pid, service_name, MIN(reception_at) AS first_cons
         FROM scoped WHERE is_cons GROUP BY pid, service_name
       ),
       proc AS (
         SELECT pid, MIN(reception_at) AS first_proc, SUM(received_price) AS rev
         FROM scoped WHERE NOT is_cons GROUP BY pid
       )
       SELECT c.service_name                                              AS consultation_name,
              COUNT(DISTINCT c.pid)::int                                  AS consulted,
              COUNT(DISTINCT c.pid) FILTER (
                WHERE pr.first_proc IS NOT NULL AND pr.first_proc >= c.first_cons::date
              )::int                                                      AS converted,
              COALESCE(SUM(pr.rev) FILTER (
                WHERE pr.first_proc IS NOT NULL AND pr.first_proc >= c.first_cons::date
              ), 0)::text                                                 AS revenue_after
       FROM cons c
       LEFT JOIN proc pr ON pr.pid = c.pid
       GROUP BY c.service_name
       HAVING COUNT(DISTINCT c.pid) > 0
       ORDER BY consulted DESC`,
      ...params,
    );

    return rows.map((r) => {
      const consulted = this.num(r.consulted);
      const converted = this.num(r.converted);
      return {
        consultationName: String(r.consultation_name ?? "نامشخص"),
        consultedPatients: consulted,
        convertedPatients: converted,
        conversionRate: consulted > 0 ? converted / consulted : 0,
        revenueAfter: this.num(r.revenue_after),
      };
    });
  }

  /**
   * Doctor ranking on outcome measures rather than raw activity: revenue,
   * distinct patients, whether those patients return, and consultation
   * conversion.
   */
  async getDoctorRanking(range: FinancialRange = {}, limit = 50): Promise<DoctorRanking[]> {
    const p = { i: 1 };
    const { sql: where, params } = this.rangeClause(range, p);

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `WITH scoped AS (
         SELECT personnel_name, patient_external_code AS pid, reception_external_id AS rid,
                received_price, ${IS_CONSULTATION} AS is_cons
         FROM reception_items ${where} AND personnel_name IS NOT NULL
       ),
       per_patient AS (
         SELECT personnel_name, pid, COUNT(DISTINCT rid)::int AS visits
         FROM scoped WHERE pid IS NOT NULL GROUP BY personnel_name, pid
       ),
       -- Did a consulted patient later receive billable work anywhere in the clinic?
       any_proc AS (
         SELECT DISTINCT patient_external_code AS pid
         FROM reception_items ${where} AND ${IS_PROCEDURE} AND patient_external_code IS NOT NULL
       ),
       consulted AS (
         SELECT DISTINCT personnel_name, pid FROM scoped WHERE is_cons AND pid IS NOT NULL
       )
       SELECT s.personnel_name,
              COALESCE(SUM(s.received_price), 0)::text     AS revenue,
              COUNT(DISTINCT s.pid)::int                   AS patient_count,
              COUNT(DISTINCT s.rid)::int                   AS reception_count,
              COUNT(*) FILTER (WHERE NOT s.is_cons)::int   AS procedure_lines,
              COUNT(*) FILTER (WHERE s.is_cons)::int       AS consultation_lines,
              (SELECT COUNT(*) FROM per_patient pp
                 WHERE pp.personnel_name = s.personnel_name AND pp.visits > 1)::int AS repeat_patients,
              (SELECT COUNT(*) FROM consulted c
                 WHERE c.personnel_name = s.personnel_name)::int                    AS consulted_patients,
              (SELECT COUNT(*) FROM consulted c JOIN any_proc a ON a.pid = c.pid
                 WHERE c.personnel_name = s.personnel_name)::int                    AS converted_patients
       FROM scoped s
       GROUP BY s.personnel_name
       ORDER BY SUM(s.received_price) DESC NULLS LAST
       LIMIT $${p.i}`,
      // The range clause appears twice in this statement but reuses the same
      // placeholders, so its parameters are supplied once — passing them per
      // occurrence shifts LIMIT onto a date and fails with "argument of LIMIT
      // must be type bigint".
      ...params,
      limit,
    );

    const totalRevenue = rows.reduce((sum, r) => sum + this.num(r.revenue), 0);

    return rows.map((r) => {
      const revenue = this.num(r.revenue);
      const patientCount = this.num(r.patient_count);
      const receptionCount = this.num(r.reception_count);
      const consulted = this.num(r.consulted_patients);
      return {
        personnelName: String(r.personnel_name),
        revenue,
        patientCount,
        receptionCount,
        procedureLines: this.num(r.procedure_lines),
        consultationLines: this.num(r.consultation_lines),
        averageTicket: receptionCount > 0 ? revenue / receptionCount : 0,
        repeatPatientRate: patientCount > 0 ? this.num(r.repeat_patients) / patientCount : 0,
        conversionRate: consulted > 0 ? this.num(r.converted_patients) / consulted : null,
        revenueShare: totalRevenue > 0 ? revenue / totalRevenue : 0,
      };
    });
  }

  /** Return rate and visit cadence. */
  async getRetentionSummary(range: FinancialRange = {}): Promise<RetentionSummary> {
    const p = { i: 1 };
    const { sql: where, params } = this.rangeClause(range, p);

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `WITH visits AS (
         SELECT DISTINCT patient_external_code AS pid, reception_at::date AS visit_day
         FROM reception_items ${where} AND patient_external_code IS NOT NULL
       ),
       per_patient AS (
         SELECT pid, COUNT(*)::int AS visit_count FROM visits GROUP BY pid
       ),
       gaps AS (
         SELECT visit_day - LAG(visit_day) OVER (PARTITION BY pid ORDER BY visit_day) AS gap
         FROM visits
       )
       SELECT COUNT(*)::int                                        AS total_patients,
              COUNT(*) FILTER (WHERE visit_count > 1)::int         AS returning_patients,
              COUNT(*) FILTER (WHERE visit_count = 1)::int         AS single_visit,
              AVG(visit_count)                                     AS avg_visits,
              (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY gap)
                 FROM gaps WHERE gap IS NOT NULL)                  AS median_gap
       FROM per_patient`,
      ...params,
    );

    const r = rows[0] ?? {};
    const total = this.num(r.total_patients);
    const returning = this.num(r.returning_patients);

    return {
      totalPatients: total,
      returningPatients: returning,
      returnRate: total > 0 ? returning / total : 0,
      averageVisitsPerPatient: this.num(r.avg_visits),
      medianDaysBetweenVisits:
        r.median_gap === null || r.median_gap === undefined ? null : Math.round(this.num(r.median_gap)),
      singleVisitPatients: this.num(r.single_visit),
    };
  }

  /** Distribution of patients by number of visits. */
  async getVisitFrequency(range: FinancialRange = {}): Promise<VisitFrequencyBucket[]> {
    const p = { i: 1 };
    const { sql: where, params } = this.rangeClause(range, p);

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `WITH visits AS (
         SELECT DISTINCT patient_external_code AS pid, reception_at::date AS visit_day
         FROM reception_items ${where} AND patient_external_code IS NOT NULL
       ),
       per_patient AS (SELECT pid, COUNT(*)::int AS v FROM visits GROUP BY pid),
       spend AS (
         SELECT patient_external_code AS pid, SUM(received_price) AS rev
         FROM reception_items ${where} AND patient_external_code IS NOT NULL
         GROUP BY 1
       )
       SELECT CASE WHEN pp.v = 1 THEN '۱'
                   WHEN pp.v = 2 THEN '۲'
                   WHEN pp.v = 3 THEN '۳'
                   WHEN pp.v BETWEEN 4 AND 5 THEN '۴-۵'
                   WHEN pp.v BETWEEN 6 AND 10 THEN '۶-۱۰'
                   ELSE '+۱۰' END                       AS bucket,
              MIN(pp.v)                                 AS sort_key,
              COUNT(*)::int                             AS patient_count,
              COALESCE(SUM(s.rev), 0)::text             AS revenue
       FROM per_patient pp LEFT JOIN spend s ON s.pid = pp.pid
       GROUP BY bucket
       ORDER BY sort_key`,
      // Same reason as above: two occurrences, one set of placeholders.
      ...params,
    );

    return rows.map((r) => ({
      visits: String(r.bucket),
      patientCount: this.num(r.patient_count),
      revenue: this.num(r.revenue),
    }));
  }

  /**
   * Patients overdue for contact: they received billable work, have not been
   * back for `minDays`, and are ordered by what they were worth.
   */
  async getFollowUpCandidates(
    opts: { minDays?: number; maxDays?: number; limit?: number } = {},
  ): Promise<{ asOf: string; candidates: FollowUpCandidate[] }> {
    const minDays = opts.minDays ?? 180;
    const maxDays = opts.maxDays ?? 1095;
    const limit = opts.limit ?? 100;

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `WITH last_visit AS (
         SELECT ri.patient_external_code AS pid,
                MAX(ri.reception_at)     AS last_at,
                MAX(ri.reception_date)   AS last_date,
                COUNT(DISTINCT ri.reception_external_id)::int AS visit_count,
                SUM(ri.received_price)   AS total_received
         FROM reception_items ri
         WHERE ri.patient_external_code IS NOT NULL AND ri.reception_at IS NOT NULL
         GROUP BY ri.patient_external_code
       )
       SELECT lv.pid, lv.last_date, lv.visit_count,
              lv.total_received::text AS total_received,
              (CURRENT_DATE - lv.last_at::date)::int AS days_since,
              p.id AS patient_id, p.full_name, p.mobile,
              (SELECT string_agg(DISTINCT ri2.service_name, '، ')
                 FROM reception_items ri2
                WHERE ri2.patient_external_code = lv.pid
                  AND ri2.reception_at = lv.last_at) AS last_services
       FROM last_visit lv
       LEFT JOIN patients p ON p.external_code = lv.pid
       WHERE (CURRENT_DATE - lv.last_at::date) BETWEEN $1 AND $2
         AND lv.total_received > 0
       ORDER BY lv.total_received DESC NULLS LAST
       LIMIT $3`,
      minDays,
      maxDays,
      limit,
    );

    return {
      asOf: dateToJalali(new Date()),
      candidates: rows.map((r) => ({
        patientExternalCode: this.num(r.pid),
        patientId: r.patient_id === null ? null : String(r.patient_id),
        fullName: r.full_name === null ? null : String(r.full_name),
        mobile: r.mobile === null ? null : String(r.mobile),
        lastVisitDate: r.last_date === null ? null : String(r.last_date),
        daysSinceLastVisit: this.num(r.days_since),
        visitCount: this.num(r.visit_count),
        totalReceived: this.num(r.total_received),
        lastServices: r.last_services === null ? null : String(r.last_services),
      })),
    };
  }

  /**
   * Everything known about one patient, for the ranking drill-down.
   */
  async getPatientDetail(externalCode: number) {
    const [patient] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT p.id, p.external_code, p.full_name, p.mobile, p.gender, p.birth_date,
              p.job, p.introduction,
              p.vip_flag::text AS vip_flag, p.vip_note, p.vip_set_at,
              m.tier::text AS tier,
              m.visit_count, m.total_received::text AS total_received,
              m.total_discount::text AS total_discount,
              m.total_outstanding::text AS total_outstanding,
              m.avg_ticket::text AS avg_ticket,
              m.first_visit_date, m.last_visit_date, m.recency_days,
              m.recency_score, m.frequency_score, m.monetary_score,
              m.rfm_score, m.segment::text AS segment
       FROM patients p
       LEFT JOIN patient_metrics m ON m.patient_id = p.id
       WHERE p.external_code = $1`,
      externalCode,
    );

    if (!patient) return null;

    const visits = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT r.external_id, r.reception_date, r.reception_no, r.user_name,
              r.total_received::text AS total_received,
              r.total_discount::text AS total_discount,
              r.item_count,
              (SELECT string_agg(DISTINCT ri.service_name, '، ')
                 FROM reception_items ri WHERE ri.reception_external_id = r.external_id) AS services,
              (SELECT string_agg(DISTINCT ri.personnel_name, '، ')
                 FROM reception_items ri WHERE ri.reception_external_id = r.external_id) AS personnel
       FROM receptions r
       WHERE r.patient_external_code = $1
       ORDER BY r.reception_at DESC NULLS LAST
       LIMIT 50`,
      externalCode,
    );

    const topServices = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT COALESCE(service_name, 'نامشخص') AS service_name,
              COUNT(*)::int AS times,
              COALESCE(SUM(received_price), 0)::text AS revenue
       FROM reception_items
       WHERE patient_external_code = $1
       GROUP BY 1 ORDER BY SUM(received_price) DESC NULLS LAST LIMIT 10`,
      externalCode,
    );

    const reserves = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT reserve_date, reserve_time, doctor_name, services_raw, is_accepted
       FROM reserves WHERE patient_external_code = $1
       ORDER BY reserve_date DESC LIMIT 20`,
      externalCode,
    );

    return {
      patient: {
        id: String(patient.id),
        externalCode: this.num(patient.external_code),
        fullName: patient.full_name === null ? null : String(patient.full_name),
        mobile: patient.mobile === null ? null : String(patient.mobile),
        gender: patient.gender === null ? null : this.num(patient.gender),
        birthDate: patient.birth_date === null ? null : String(patient.birth_date),
        job: patient.job === null ? null : String(patient.job),
        // Manual standing sits on the patient rather than in `metrics`: it is
        // asserted by a person and survives every recompute, whereas everything
        // under `metrics` is derived and rebuilt after each sync.
        vipFlag: patient.vip_flag === null ? null : String(patient.vip_flag),
        vipNote: patient.vip_note === null ? null : String(patient.vip_note),
        vipSetAt: patient.vip_set_at === null ? null : new Date(patient.vip_set_at as string).toISOString(),
        tier: patient.tier === null ? null : String(patient.tier),
      },
      metrics: patient.visit_count === null ? null : {
        visitCount: this.num(patient.visit_count),
        totalReceived: this.num(patient.total_received),
        totalDiscount: this.num(patient.total_discount),
        totalOutstanding: this.num(patient.total_outstanding),
        averageTicket: this.num(patient.avg_ticket),
        firstVisitDate: patient.first_visit_date === null ? null : String(patient.first_visit_date),
        lastVisitDate: patient.last_visit_date === null ? null : String(patient.last_visit_date),
        recencyDays: patient.recency_days === null ? null : this.num(patient.recency_days),
        recencyScore: this.num(patient.recency_score),
        frequencyScore: this.num(patient.frequency_score),
        monetaryScore: this.num(patient.monetary_score),
        rfmScore: this.num(patient.rfm_score),
        segment: String(patient.segment ?? "NEW"),
      },
      visits: visits.map((v) => ({
        externalId: this.num(v.external_id),
        receptionDate: v.reception_date === null ? null : String(v.reception_date),
        receptionNo: v.reception_no === null ? null : this.num(v.reception_no),
        userName: v.user_name === null ? null : String(v.user_name),
        totalReceived: this.num(v.total_received),
        totalDiscount: this.num(v.total_discount),
        itemCount: this.num(v.item_count),
        services: v.services === null ? null : String(v.services),
        personnel: v.personnel === null ? null : String(v.personnel),
      })),
      topServices: topServices.map((s) => ({
        serviceName: String(s.service_name),
        times: this.num(s.times),
        revenue: this.num(s.revenue),
      })),
      reserves: reserves.map((r) => ({
        reserveDate: r.reserve_date === null ? null : String(r.reserve_date),
        reserveTime: r.reserve_time === null ? null : String(r.reserve_time),
        doctorName: r.doctor_name === null ? null : String(r.doctor_name),
        services: r.services_raw === null ? null : String(r.services_raw),
        isAccepted: r.is_accepted === true,
      })),
    };
  }

  /**
   * Which slice of history the analytics actually cover.
   * RFM scores computed mid-backfill are misleading — every patient looks
   * "recent" if only recent receptions exist — so the UI needs to be able to
   * say what the numbers are based on.
   */
  async getCoverage() {
    const [rows] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT MIN(reception_date) AS oldest, MAX(reception_date) AS newest,
              COUNT(*)::int AS receptions,
              (SELECT COUNT(*) FROM reception_items)::int AS lines,
              (SELECT MAX(computed_at) FROM patient_metrics) AS metrics_computed_at,
              (SELECT COUNT(*) FROM patient_metrics)::int AS ranked_patients
       FROM receptions`,
    );

    const job = await prisma.syncJobState.findUnique({ where: { entity: "RECEPTIONS" } });

    return {
      oldestReceptionDate: rows?.oldest === null || rows?.oldest === undefined ? null : String(rows.oldest),
      newestReceptionDate: rows?.newest === null || rows?.newest === undefined ? null : String(rows.newest),
      receptionCount: this.num(rows?.receptions),
      lineCount: this.num(rows?.lines),
      rankedPatients: this.num(rows?.ranked_patients),
      metricsComputedAt: rows?.metrics_computed_at instanceof Date
        ? (rows.metrics_computed_at as Date).toISOString()
        : null,
      syncComplete: job?.reachedEnd === true,
      syncStatus: job?.status ?? "IDLE",
      syncCursorDate: job?.cursorDate ?? null,
    };
  }
}
