import { prisma } from "@jordan/db";
import { jalaliToSqlDate, jalaliToday, parseJalali, type FinancialRange } from "@jordan/shared";

/**
 * Clinic-level analytics that tie patient attributes to money.
 *
 * These replace count-only charts (how many patients are women, how many came
 * from Instagram) with the version that supports a decision: what each group is
 * actually worth. A channel that delivers the most patients and a channel that
 * delivers the most revenue turn out not to be the same channel.
 */

/**
 * Mirrors `/api/Basic/IntroductionType` from the CRM. Kept as a constant rather
 * than a synced table because it is five stable rows; unknown ids fall back to
 * their number so a new CRM value shows up rather than silently merging into
 * "other".
 */
const INTRODUCTION_LABELS: Record<number, string> = {
  132: "اینستاگرام",
  133: "وب‌سایت",
  134: "تلویزیون",
  135: "دوستان و آشنایان",
  136: "سایر",
};

/** The catch-all channel id; legacy `0` rows are folded into it. */
const INTRODUCTION_OTHER = 136;

/**
 * Some older patient rows carry `introduction = 0`, which is not a value the
 * CRM's IntroductionType list defines. Folded into "سایر" in SQL so the two do
 * not appear as separate channels splitting one bucket's numbers.
 */
const NORMALIZED_INTRODUCTION = `CASE WHEN p.introduction = 0 THEN ${INTRODUCTION_OTHER} ELSE p.introduction END`;

export interface AcquisitionChannel {
  introductionId: number | null
  channel: string
  /** Patients attributed to this channel. */
  patients: number
  /** Of those, how many ever paid for anything. */
  payingPatients: number
  /** payingPatients / patients — how well the channel qualifies. */
  activationRate: number
  revenue: number
  /** Revenue ÷ every patient acquired, the channel's true yield. */
  revenuePerPatient: number
  /** Revenue ÷ paying patients. */
  revenuePerPayingPatient: number
}

export interface DemographicValue {
  bucket: string
  patients: number
  payingPatients: number
  revenue: number
  averageSpend: number
  revenueShare: number
}

export interface AcquisitionCohort {
  cohort: string
  newPatients: number
  returnedPatients: number
  returnRate: number
  revenue: number
  revenuePerPatient: number
}

export interface BookingFollowThrough {
  totalReserves: number
  acceptedReserves: number
  acceptanceRate: number
  /** Past reserves that have a reception for the same patient that day. */
  matchedReserves: number
  matchableReserves: number
  followThroughRate: number
  /** Reserves carrying no patient code — unattributable to a visit. */
  unidentifiedReserves: number
}

export class ClinicAnalyticsService {
  private num(value: unknown): number {
    if (value === null || value === undefined) return 0;
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  private rangeClause(range: FinancialRange, param: { i: number }, column: string) {
    const params: unknown[] = [];
    const parts: string[] = [];
    const from = range.from ? jalaliToSqlDate(range.from) : null;
    const to = range.to ? jalaliToSqlDate(range.to) : null;

    if (from) {
      parts.push(`${column} >= $${param.i++}::timestamp`);
      params.push(from);
    }
    if (to) {
      parts.push(`${column} < ($${param.i++}::timestamp + interval '1 day')`);
      params.push(to);
    }
    return { sql: parts.length ? ` AND ${parts.join(" AND ")}` : "", params };
  }

  /**
   * Which acquisition channels actually pay for themselves.
   *
   * Volume and value diverge sharply here, which is the whole point of the
   * report: a channel can dominate patient counts while converting a small
   * fraction of them into paying visits.
   */
  async getAcquisitionChannels(): Promise<AcquisitionChannel[]> {
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT ${NORMALIZED_INTRODUCTION}                            AS intro,
              COUNT(*)::int                                         AS patients,
              COUNT(m.patient_id) FILTER (WHERE m.total_received > 0)::int AS paying,
              COALESCE(SUM(m.total_received), 0)::text              AS revenue
       FROM patients p
       LEFT JOIN patient_metrics m ON m.patient_id = p.id
       GROUP BY ${NORMALIZED_INTRODUCTION}
       ORDER BY COALESCE(SUM(m.total_received), 0) DESC`,
    );

    return rows.map((r) => {
      const introId = r.intro === null ? null : this.num(r.intro);
      const patients = this.num(r.patients);
      const paying = this.num(r.paying);
      const revenue = this.num(r.revenue);

      return {
        introductionId: introId,
        channel:
          introId === null
            ? "ثبت‌نشده"
            : (INTRODUCTION_LABELS[introId] ?? `کد ${introId}`),
        patients,
        payingPatients: paying,
        activationRate: patients > 0 ? paying / patients : 0,
        revenue,
        revenuePerPatient: patients > 0 ? revenue / patients : 0,
        revenuePerPayingPatient: paying > 0 ? revenue / paying : 0,
      };
    });
  }

  /**
   * Gender and age bands weighted by spend.
   *
   * Age is derived in SQL from the Jalali birth-year, with the current Jalali
   * year supplied by the caller — pulling 121k rows into Node merely to bucket
   * them, as the previous demographics endpoint did, is wasteful.
   */
  async getDemographicValue(): Promise<{ gender: DemographicValue[]; age: DemographicValue[] }> {
    const currentJalaliYear = parseJalali(jalaliToday())?.jy ?? 1405;

    const genderRows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT CASE WHEN p.gender = 21 THEN 'زن'
                   WHEN p.gender IN (20, 1) THEN 'مرد'
                   ELSE 'نامشخص' END                                AS bucket,
              COUNT(*)::int                                         AS patients,
              COUNT(m.patient_id) FILTER (WHERE m.total_received > 0)::int AS paying,
              COALESCE(SUM(m.total_received), 0)::text              AS revenue
       FROM patients p LEFT JOIN patient_metrics m ON m.patient_id = p.id
       GROUP BY 1 ORDER BY SUM(m.total_received) DESC NULLS LAST`,
    );

    const ageRows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `WITH aged AS (
         SELECT p.id,
                CASE WHEN p.birth_date ~ '^[0-9]{4}/[0-9]{2}/[0-9]{2}$'
                     THEN $1::int - substring(p.birth_date, 1, 4)::int
                     ELSE NULL END AS age
         FROM patients p
       )
       SELECT CASE WHEN a.age IS NULL THEN 'نامشخص'
                   WHEN a.age < 18 THEN 'زیر ۱۸'
                   WHEN a.age < 30 THEN '۱۸-۲۹'
                   WHEN a.age < 45 THEN '۳۰-۴۴'
                   WHEN a.age < 60 THEN '۴۵-۵۹'
                   ELSE '۶۰+' END                                   AS bucket,
              MIN(COALESCE(a.age, 999))                             AS sort_key,
              COUNT(*)::int                                         AS patients,
              COUNT(m.patient_id) FILTER (WHERE m.total_received > 0)::int AS paying,
              COALESCE(SUM(m.total_received), 0)::text              AS revenue
       FROM aged a LEFT JOIN patient_metrics m ON m.patient_id = a.id
       GROUP BY 1 ORDER BY sort_key`,
      currentJalaliYear,
    );

    const shape = (rows: Record<string, unknown>[]): DemographicValue[] => {
      const total = rows.reduce((s, r) => s + this.num(r.revenue), 0);
      return rows.map((r) => {
        const patients = this.num(r.patients);
        const revenue = this.num(r.revenue);
        return {
          bucket: String(r.bucket),
          patients,
          payingPatients: this.num(r.paying),
          revenue,
          averageSpend: patients > 0 ? revenue / patients : 0,
          revenueShare: total > 0 ? revenue / total : 0,
        };
      });
    };

    return { gender: shape(genderRows), age: shape(ageRows) };
  }

  /**
   * Acquisition cohorts by first billed visit: how many patients the clinic won
   * each month, and what share of them ever came back.
   */
  async getAcquisitionCohorts(limit = 24): Promise<AcquisitionCohort[]> {
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT substring(first_visit_date, 1, 7)                AS cohort,
              COUNT(*)::int                                    AS new_patients,
              COUNT(*) FILTER (WHERE visit_count > 1)::int     AS returned,
              COALESCE(SUM(total_received), 0)::text           AS revenue
       FROM patient_metrics
       WHERE first_visit_date IS NOT NULL AND first_visit_date <> ''
       GROUP BY 1
       ORDER BY 1 DESC
       LIMIT $1`,
      limit,
    );

    return rows
      .map((r) => {
        const newPatients = this.num(r.new_patients);
        const revenue = this.num(r.revenue);
        return {
          cohort: String(r.cohort),
          newPatients,
          returnedPatients: this.num(r.returned),
          returnRate: newPatients > 0 ? this.num(r.returned) / newPatients : 0,
          revenue,
          revenuePerPatient: newPatients > 0 ? revenue / newPatients : 0,
        };
      })
      .reverse();
  }

  /**
   * How reliably bookings turn into visits.
   *
   * `followThroughRate` matches a reserve to a reception for the same patient on
   * the same day, so it only counts reserves that carry a patient code and are
   * already in the past. It is a floor, not an exact no-show rate: a patient who
   * rebooked and attended a different day counts as unmatched.
   */
  async getBookingFollowThrough(range: FinancialRange = {}): Promise<BookingFollowThrough> {
    const today = jalaliToday();
    const p = { i: 1 };
    const params: unknown[] = [];
    let dateFilter = "";

    if (range.from) {
      dateFilter += ` AND rs.reserve_date >= $${p.i++}`;
      params.push(range.from);
    }
    if (range.to) {
      dateFilter += ` AND rs.reserve_date <= $${p.i++}`;
      params.push(range.to);
    }

    const [rows] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT COUNT(*)::int                                                     AS total,
              COUNT(*) FILTER (WHERE rs.is_accepted)::int                       AS accepted,
              COUNT(*) FILTER (WHERE rs.patient_external_code IS NULL)::int     AS unidentified,
              COUNT(*) FILTER (
                WHERE rs.patient_external_code IS NOT NULL
                  AND rs.reserve_date <= $${p.i}
              )::int                                                            AS matchable,
              COUNT(*) FILTER (
                WHERE rs.patient_external_code IS NOT NULL
                  AND rs.reserve_date <= $${p.i}
                  AND EXISTS (
                    SELECT 1 FROM receptions rc
                    WHERE rc.patient_external_code = rs.patient_external_code
                      AND rc.reception_date = rs.reserve_date
                  )
              )::int                                                            AS matched
       FROM reserves rs
       WHERE TRUE${dateFilter}`,
      ...params,
      today,
    );

    const total = this.num(rows?.total);
    const accepted = this.num(rows?.accepted);
    const matchable = this.num(rows?.matchable);
    const matched = this.num(rows?.matched);

    return {
      totalReserves: total,
      acceptedReserves: accepted,
      acceptanceRate: total > 0 ? accepted / total : 0,
      matchedReserves: matched,
      matchableReserves: matchable,
      followThroughRate: matchable > 0 ? matched / matchable : 0,
      unidentifiedReserves: this.num(rows?.unidentified),
    };
  }

  /**
   * Scope of the treatment-plan dataset.
   *
   * The plan-based clinical reports cover a small fraction of the patient base,
   * so every page built on them needs to say so rather than implying they
   * describe the whole clinic.
   */
  async getTreatmentPlanCoverage() {
    const [rows] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT (SELECT COUNT(*) FROM treatments)::int                          AS plans,
              (SELECT COUNT(DISTINCT external_patient_code) FROM treatments)::int AS plan_patients,
              (SELECT COUNT(*) FROM patient_metrics)::int                     AS billed_patients,
              (SELECT MIN(plan_date) FROM treatments)                         AS oldest,
              (SELECT MAX(plan_date) FROM treatments)                         AS newest`,
    );

    const planPatients = this.num(rows?.plan_patients);
    const billed = this.num(rows?.billed_patients);

    return {
      plans: this.num(rows?.plans),
      planPatients,
      billedPatients: billed,
      coverageRate: billed > 0 ? planPatients / billed : 0,
      oldestPlanDate: rows?.oldest === null || rows?.oldest === undefined ? null : String(rows.oldest),
      newestPlanDate: rows?.newest === null || rows?.newest === undefined ? null : String(rows.newest),
    };
  }
}
