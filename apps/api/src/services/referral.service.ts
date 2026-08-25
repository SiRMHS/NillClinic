import { prisma } from "@jordan/db";
import {
  jalaliToSqlDate,
  CONSULTATION_SERVICE_PATTERN,
  NON_DOCTOR_NAME_PATTERNS,
  PATIENT_TIER_LABELS,
  type PatientTier,
  type ReferralPatient,
  type ReferralQuery,
  type ReferralReport,
} from "@jordan/shared";

/**
 * "Consulted with one doctor, treated by another."
 *
 * The clinic's senior physician sees a large share of consultations and then
 * hands the actual procedure to a colleague. This report measures that handoff:
 * who was consulted, where the treatment landed, and what it was worth.
 *
 * ## Definition
 *
 * A patient qualifies when both hold:
 *   1. at least one *consultation* line naming the consulting doctor, and
 *   2. at least one *treatment* line, dated on or after that consultation,
 *      naming a practitioner who is not the consulting doctor.
 *
 * The date ordering is the part that is easy to get wrong. Without it, a
 * patient treated by someone else years before they ever met the consulting
 * doctor counts as a referral — which measures the reverse of the intended
 * flow. The comparison is `>=` rather than `>` because same-day consult-then-
 * treat is the normal path through this clinic.
 *
 * ## Matching the doctor name
 *
 * `personnel_name` is multi-valued (`A، B`), so "treated by another doctor" is
 * not simply `personnel_name <> consultant`. A line naming both the consultant
 * and a colleague is shared work, not a referral away, so it is excluded from
 * the treatment side; only lines with no mention of the consultant count.
 */
export class ReferralService {
  private toNumber(value: unknown): number {
    if (value === null || value === undefined) return 0;
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  private doctorNameFilter(alias: string): string {
    const notLike = NON_DOCTOR_NAME_PATTERNS.map((p) => `${alias} NOT LIKE '${p}'`).join(" AND ");
    return `${alias} <> '' AND ${notLike}`;
  }

  async getReport(query: ReferralQuery): Promise<ReferralReport> {
    const params: unknown[] = [];
    let i = 1;
    const bind = (v: unknown): string => {
      params.push(v);
      return `$${i++}`;
    };

    const consultant = bind(`%${query.consultingDoctor}%`);
    const consultPattern = bind(CONSULTATION_SERVICE_PATTERN);
    const from = query.from ? jalaliToSqlDate(query.from) : null;
    const to = query.to ? jalaliToSqlDate(query.to) : null;

    /**
     * The range bounds the *consultation*, not the treatment.
     *
     * Bounding both would drop exactly the cases the report is for: a
     * consultation in the chosen month whose treatment happened the month
     * after. The follow-on treatment is therefore deliberately unbounded on the
     * right.
     */
    const consultRange = [
      from ? `AND ri.reception_at >= ${bind(from)}::timestamp` : "",
      to ? `AND ri.reception_at < (${bind(to)}::timestamp + interval '1 day')` : "",
    ].join(" ");

    const treatingFilter = query.treatingDoctors?.length
      ? `AND btrim(split.raw) = ANY(${bind(query.treatingDoctors)}::text[])`
      : "";

    // Consultations by the named doctor, one row per patient.
    const consultCte = `
      consults AS (
        SELECT
          ri.patient_external_code                  AS code,
          MIN(ri.reception_at)                      AS first_consult_at,
          MIN(ri.reception_date)                    AS first_consult_date,
          COUNT(*)::int                             AS consultation_count,
          COALESCE(SUM(ri.received_price), 0)       AS consultant_received
        FROM reception_items ri
        WHERE ri.patient_external_code IS NOT NULL
          AND ri.reception_at IS NOT NULL
          AND ri.service_name ILIKE ${consultPattern}
          AND ri.personnel_name ILIKE ${consultant}
          ${consultRange}
        GROUP BY 1
      )`;

    // Treatment delivered by anyone other than the consulting doctor, on or
    // after the consultation.
    const treatCte = `
      treatments AS (
        SELECT
          ri.patient_external_code                              AS code,
          COUNT(DISTINCT ri.reception_external_id)::int         AS treatment_count,
          COALESCE(SUM(ri.received_price), 0)                   AS treatment_received,
          MIN(ri.reception_date)                                AS first_treatment_date,
          MAX(ri.reception_date)                                AS last_treatment_date,
          array_agg(DISTINCT btrim(split.raw))                  AS treating_doctors
        FROM reception_items ri
        JOIN consults c ON c.code = ri.patient_external_code
        LEFT JOIN LATERAL unnest(
          string_to_array(COALESCE(ri.personnel_name, ''), '،')
        ) AS split(raw) ON TRUE
        WHERE ri.reception_at IS NOT NULL
          AND ri.reception_at >= c.first_consult_at
          -- Not a consultation: this must be actual delivered treatment.
          AND (ri.service_name IS NULL OR ri.service_name NOT ILIKE ${consultPattern})
          -- The consulting doctor is absent from the whole line, so shared work
          -- is not miscounted as a handover.
          AND COALESCE(ri.personnel_name, '') NOT ILIKE ${consultant}
          AND ${this.doctorNameFilter("btrim(split.raw)")}
          ${treatingFilter}
        GROUP BY 1
      )`;

    const tierFilter = query.tier ? `AND m.tier = ${bind(query.tier)}::"PatientTier"` : "";
    const search = query.search?.trim();
    const searchFilter = search
      ? `AND (p.full_name ILIKE ${bind(`%${search}%`)} OR p.mobile ILIKE ${bind(`%${search}%`)} OR p.external_code::text = ${bind(search)})`
      : "";

    const base = `
      WITH ${consultCte},
      ${treatCte},
      joined AS (
        SELECT
          p.id                        AS patient_id,
          c.code                      AS code,
          p.full_name,
          p.mobile,
          m.tier::text                AS tier,
          COALESCE(m.total_received, 0) AS lifetime_spend,
          c.first_consult_date,
          c.consultation_count,
          c.consultant_received,
          t.treatment_count,
          t.treatment_received,
          t.first_treatment_date,
          t.last_treatment_date,
          t.treating_doctors
        FROM consults c
        JOIN treatments t      ON t.code = c.code
        LEFT JOIN patients p   ON p.external_code = c.code
        LEFT JOIN patient_metrics m ON m.patient_external_code = c.code
        WHERE TRUE ${tierFilter} ${searchFilter}
      )`;

    const SORT_COLUMNS: Record<string, string> = {
      treatmentReceived: "treatment_received",
      lifetimeSpend: "lifetime_spend",
      treatmentCount: "treatment_count",
      consultationDate: "first_consult_date",
      firstTreatmentDate: "first_treatment_date",
      name: "full_name",
    };
    const column = SORT_COLUMNS[query.sort] ?? SORT_COLUMNS.treatmentReceived!;
    const dir = query.direction === "asc" ? "ASC" : "DESC";

    const countRows = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `${base} SELECT COUNT(*)::int AS n FROM joined`,
      ...params,
    );

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `${base}
       SELECT
         patient_id, code, full_name, mobile, tier,
         lifetime_spend::text        AS lifetime_spend,
         first_consult_date, consultation_count,
         consultant_received::text   AS consultant_received,
         treatment_count,
         treatment_received::text    AS treatment_received,
         first_treatment_date, last_treatment_date, treating_doctors
       FROM joined
       ORDER BY ${column} ${dir} NULLS LAST, code ASC
       LIMIT ${bind(query.limit)} OFFSET ${bind(query.offset)}`,
      ...params,
    );

    const patients: ReferralPatient[] = rows.map((r) => {
      const tier = r.tier === null ? null : (String(r.tier) as PatientTier);
      return {
        patientId: r.patient_id === null ? null : String(r.patient_id),
        patientExternalCode: this.toNumber(r.code),
        fullName: r.full_name === null ? null : String(r.full_name),
        mobile: r.mobile === null ? null : String(r.mobile),
        tier,
        tierLabel: tier ? (PATIENT_TIER_LABELS[tier] ?? tier) : null,
        consultationDate: r.first_consult_date === null ? null : String(r.first_consult_date),
        consultationCount: this.toNumber(r.consultation_count),
        treatingDoctors: Array.isArray(r.treating_doctors)
          ? (r.treating_doctors as unknown[]).map(String).filter(Boolean)
          : [],
        treatmentCount: this.toNumber(r.treatment_count),
        treatmentReceived: this.toNumber(r.treatment_received),
        consultingDoctorReceived: this.toNumber(r.consultant_received),
        firstTreatmentDate: r.first_treatment_date === null ? null : String(r.first_treatment_date),
        lastTreatmentDate: r.last_treatment_date === null ? null : String(r.last_treatment_date),
        lifetimeSpend: this.toNumber(r.lifetime_spend),
      };
    });

    const [summary, byDoctor] = await Promise.all([
      this.getSummary(query),
      this.getByTreatingDoctor(query),
    ]);

    return {
      patients,
      total: countRows[0]?.n ?? 0,
      summary,
      byTreatingDoctor: byDoctor,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Denominators for the referral rate.
   *
   * `retained` counts patients the consulting doctor also treated personally.
   * It is not the complement of `referredOut` — a patient can be treated by
   * both — so the two are reported separately rather than as a split.
   */
  private async getSummary(query: ReferralQuery): Promise<ReferralReport["summary"]> {
    const params: unknown[] = [];
    let i = 1;
    const bind = (v: unknown): string => {
      params.push(v);
      return `$${i++}`;
    };

    const consultant = bind(`%${query.consultingDoctor}%`);
    const consultPattern = bind(CONSULTATION_SERVICE_PATTERN);
    const from = query.from ? jalaliToSqlDate(query.from) : null;
    const to = query.to ? jalaliToSqlDate(query.to) : null;
    const consultRange = [
      from ? `AND ri.reception_at >= ${bind(from)}::timestamp` : "",
      to ? `AND ri.reception_at < (${bind(to)}::timestamp + interval '1 day')` : "",
    ].join(" ");

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `WITH consults AS (
         SELECT ri.patient_external_code AS code, MIN(ri.reception_at) AS first_consult_at
         FROM reception_items ri
         WHERE ri.patient_external_code IS NOT NULL
           AND ri.reception_at IS NOT NULL
           AND ri.service_name ILIKE ${consultPattern}
           AND ri.personnel_name ILIKE ${consultant}
           ${consultRange}
         GROUP BY 1
       ),
       -- Must apply exactly the same practitioner filter as the row list.
       -- Accepting any non-empty personnel_name here counted patients whose
       -- only follow-on "treatment" was booked against a service name leaking
       -- into that column, so the headline read 6,924 against a 6,903-row
       -- table — a discrepancy with no visible cause.
       referred AS (
         SELECT c.code, COALESCE(SUM(ri.received_price), 0) AS received
         FROM consults c
         JOIN reception_items ri
           ON ri.patient_external_code = c.code
          AND ri.reception_at >= c.first_consult_at
          AND (ri.service_name IS NULL OR ri.service_name NOT ILIKE ${consultPattern})
          AND COALESCE(ri.personnel_name, '') NOT ILIKE ${consultant}
         WHERE EXISTS (
           SELECT 1
           FROM unnest(string_to_array(COALESCE(ri.personnel_name, ''), '،')) AS split(raw)
           WHERE ${this.doctorNameFilter("btrim(split.raw)")}
         )
         GROUP BY 1
       ),
       retained AS (
         SELECT DISTINCT c.code
         FROM consults c
         JOIN reception_items ri
           ON ri.patient_external_code = c.code
          AND ri.reception_at >= c.first_consult_at
          AND (ri.service_name IS NULL OR ri.service_name NOT ILIKE ${consultPattern})
          AND ri.personnel_name ILIKE ${consultant}
       )
       SELECT
         (SELECT COUNT(*)::int FROM consults)                       AS total_consulted,
         (SELECT COUNT(*)::int FROM referred)                       AS referred_out,
         (SELECT COUNT(*)::int FROM retained)                       AS retained,
         (SELECT COALESCE(SUM(received), 0)::text FROM referred)    AS treatment_revenue`,
      ...params,
    );

    const r = rows[0] ?? {};
    const totalConsulted = this.toNumber(r.total_consulted);
    const referredOut = this.toNumber(r.referred_out);
    const treatmentRevenue = this.toNumber(r.treatment_revenue);

    return {
      consultingDoctor: query.consultingDoctor,
      totalConsulted,
      referredOut,
      retained: this.toNumber(r.retained),
      referralRate: totalConsulted > 0 ? referredOut / totalConsulted : 0,
      treatmentRevenue,
      averagePerReferral: referredOut > 0 ? treatmentRevenue / referredOut : 0,
    };
  }

  /** Where the referred-out work actually landed. */
  private async getByTreatingDoctor(
    query: ReferralQuery,
  ): Promise<ReferralReport["byTreatingDoctor"]> {
    const params: unknown[] = [];
    let i = 1;
    const bind = (v: unknown): string => {
      params.push(v);
      return `$${i++}`;
    };

    const consultant = bind(`%${query.consultingDoctor}%`);
    const consultPattern = bind(CONSULTATION_SERVICE_PATTERN);
    const from = query.from ? jalaliToSqlDate(query.from) : null;
    const to = query.to ? jalaliToSqlDate(query.to) : null;
    const consultRange = [
      from ? `AND ri.reception_at >= ${bind(from)}::timestamp` : "",
      to ? `AND ri.reception_at < (${bind(to)}::timestamp + interval '1 day')` : "",
    ].join(" ");

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `WITH consults AS (
         SELECT ri.patient_external_code AS code, MIN(ri.reception_at) AS first_consult_at
         FROM reception_items ri
         WHERE ri.patient_external_code IS NOT NULL
           AND ri.reception_at IS NOT NULL
           AND ri.service_name ILIKE ${consultPattern}
           AND ri.personnel_name ILIKE ${consultant}
           ${consultRange}
         GROUP BY 1
       )
       SELECT
         btrim(split.raw)                                       AS doctor_name,
         COUNT(DISTINCT ri.patient_external_code)::int          AS patient_count,
         COUNT(DISTINCT ri.reception_external_id)::int          AS treatment_count,
         COALESCE(SUM(ri.received_price), 0)::text              AS received
       FROM consults c
       JOIN reception_items ri
         ON ri.patient_external_code = c.code
        AND ri.reception_at >= c.first_consult_at
        AND (ri.service_name IS NULL OR ri.service_name NOT ILIKE ${consultPattern})
        AND COALESCE(ri.personnel_name, '') NOT ILIKE ${consultant}
       JOIN LATERAL unnest(
         string_to_array(COALESCE(ri.personnel_name, ''), '،')
       ) AS split(raw) ON ${this.doctorNameFilter("btrim(split.raw)")}
       GROUP BY 1
       ORDER BY SUM(ri.received_price) DESC NULLS LAST
       LIMIT 50`,
      ...params,
    );

    return rows.map((r) => ({
      doctorName: String(r.doctor_name),
      patientCount: this.toNumber(r.patient_count),
      treatmentCount: this.toNumber(r.treatment_count),
      received: this.toNumber(r.received),
    }));
  }
}
