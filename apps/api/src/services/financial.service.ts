import { prisma } from "@jordan/db";
import {
  jalaliToSqlDate,
  dateToJalali,
  PATIENT_SEGMENT_LABELS,
  type FinancialGranularity,
  type FinancialRange,
  type RevenueByPersonnel,
  type RevenueBySection,
  type RevenueByService,
  type RevenuePoint,
  type RevenueSummary,
} from "@jordan/shared";

/**
 * Financial reporting over `reception_items`.
 *
 * That table denormalizes `reception_at` and `patient_external_code` from its
 * parent precisely so these aggregates stay single-table scans — the alternative
 * is joining ~800k reserves and receptions on every dashboard load.
 *
 * Money is summed in Postgres as `numeric` (exact) and converted to a JS number
 * only in `toNumber`, so cents never drift through float accumulation.
 */
export class FinancialService {
  /**
   * Jalali range → an inclusive-start/exclusive-end SQL predicate.
   * `to` is pushed one day forward so the final day is fully included
   * regardless of any time component.
   */
  private rangeClause(range: FinancialRange, param: { i: number }): {
    sql: string;
    params: unknown[];
  } {
    const params: unknown[] = [];
    const parts: string[] = [];

    const from = range.from ? jalaliToSqlDate(range.from) : null;
    const to = range.to ? jalaliToSqlDate(range.to) : null;

    if (from) {
      parts.push(`reception_at >= $${param.i++}::timestamp`);
      params.push(from);
    }
    if (to) {
      parts.push(`reception_at < ($${param.i++}::timestamp + interval '1 day')`);
      params.push(to);
    }
    // Rows whose Jalali date was unparseable have a null reception_at and would
    // silently vanish from every filtered report; keep them only when unfiltered.
    parts.push("reception_at IS NOT NULL");

    return { sql: parts.length ? `WHERE ${parts.join(" AND ")}` : "", params };
  }

  private toNumber(value: unknown): number {
    if (value === null || value === undefined) return 0;
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  async getSummary(range: FinancialRange = {}): Promise<RevenueSummary> {
    const p = { i: 1 };
    const { sql: where, params } = this.rangeClause(range, p);

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT
         COALESCE(SUM(received_price), 0)::text  AS received,
         COALESCE(SUM(discount), 0)::text        AS discount,
         COALESCE(SUM(remain_price), 0)::text    AS outstanding,
         COALESCE(SUM(deposit_price), 0)::text   AS deposit,
         COUNT(*)::int                           AS line_count,
         COUNT(DISTINCT reception_external_id)::int AS reception_count,
         COUNT(DISTINCT patient_external_code)::int AS unique_patients
       FROM reception_items ${where}`,
      ...params,
    );

    const r = rows[0] ?? {};
    const received = this.toNumber(r.received);
    const discount = this.toNumber(r.discount);
    const receptionCount = this.toNumber(r.reception_count);
    const grossBilled = received + discount;

    return {
      totalReceived: received,
      totalDiscount: discount,
      totalOutstanding: this.toNumber(r.outstanding),
      totalDeposit: this.toNumber(r.deposit),
      grossBilled,
      discountRate: grossBilled > 0 ? discount / grossBilled : 0,
      receptionCount,
      lineCount: this.toNumber(r.line_count),
      uniquePatients: this.toNumber(r.unique_patients),
      averageTicket: receptionCount > 0 ? received / receptionCount : 0,
    };
  }

  /**
   * Revenue over time. Grouping happens on the Gregorian `reception_at` and the
   * bucket is converted back to Jalali for display, because Jalali month
   * boundaries do not align with Gregorian ones — grouping on the Jalali string
   * would be correct only for `day`.
   */
  async getTrend(
    range: FinancialRange = {},
    granularity: FinancialGranularity = "month",
  ): Promise<RevenuePoint[]> {
    const p = { i: 1 };
    const { sql: where, params } = this.rangeClause(range, p);
    const truncUnit = granularity === "year" ? "year" : granularity === "day" ? "day" : "month";

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT
         date_trunc('${truncUnit}', reception_at)   AS bucket,
         COALESCE(SUM(received_price), 0)::text     AS received,
         COALESCE(SUM(discount), 0)::text           AS discount,
         COALESCE(SUM(remain_price), 0)::text       AS outstanding,
         COUNT(DISTINCT reception_external_id)::int AS reception_count
       FROM reception_items ${where}
       GROUP BY bucket
       ORDER BY bucket ASC`,
      ...params,
    );

    return rows.map((r) => {
      const bucket = r.bucket instanceof Date ? r.bucket : new Date(String(r.bucket));
      const jalali = dateToJalali(bucket);
      const period =
        granularity === "year"
          ? jalali.slice(0, 4)
          : granularity === "month"
            ? jalali.slice(0, 7)
            : jalali;

      return {
        period,
        received: this.toNumber(r.received),
        discount: this.toNumber(r.discount),
        outstanding: this.toNumber(r.outstanding),
        receptionCount: this.toNumber(r.reception_count),
      };
    });
  }

  async getByService(range: FinancialRange = {}, limit = 25): Promise<RevenueByService[]> {
    const p = { i: 1 };
    const { sql: where, params } = this.rangeClause(range, p);

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT
         service_external_id,
         COALESCE(service_name, 'نامشخص')           AS service_name,
         MIN(section_name)                          AS section_name,
         COALESCE(SUM(received_price), 0)::text     AS received,
         COALESCE(SUM(discount), 0)::text           AS discount,
         COUNT(*)::int                              AS line_count,
         COUNT(DISTINCT patient_external_code)::int AS unique_patients
       FROM reception_items ${where}
       GROUP BY service_external_id, COALESCE(service_name, 'نامشخص')
       ORDER BY SUM(received_price) DESC NULLS LAST
       LIMIT $${p.i}`,
      ...params,
      limit,
    );

    return rows.map((r) => {
      const received = this.toNumber(r.received);
      const lineCount = this.toNumber(r.line_count);
      return {
        serviceExternalId: r.service_external_id === null ? null : this.toNumber(r.service_external_id),
        serviceName: String(r.service_name),
        sectionName: r.section_name === null ? null : String(r.section_name),
        received,
        discount: this.toNumber(r.discount),
        lineCount,
        uniquePatients: this.toNumber(r.unique_patients),
        averagePrice: lineCount > 0 ? received / lineCount : 0,
      };
    });
  }

  async getBySection(range: FinancialRange = {}): Promise<RevenueBySection[]> {
    const p = { i: 1 };
    const { sql: where, params } = this.rangeClause(range, p);

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT
         section_id,
         COALESCE(section_name, 'نامشخص')       AS section_name,
         COALESCE(SUM(received_price), 0)::text AS received,
         COALESCE(SUM(discount), 0)::text       AS discount,
         COUNT(*)::int                          AS line_count
       FROM reception_items ${where}
       GROUP BY section_id, COALESCE(section_name, 'نامشخص')
       ORDER BY SUM(received_price) DESC NULLS LAST`,
      ...params,
    );

    const total = rows.reduce((sum, r) => sum + this.toNumber(r.received), 0);

    return rows.map((r) => {
      const received = this.toNumber(r.received);
      return {
        sectionId: r.section_id === null ? null : this.toNumber(r.section_id),
        sectionName: String(r.section_name),
        received,
        discount: this.toNumber(r.discount),
        lineCount: this.toNumber(r.line_count),
        share: total > 0 ? received / total : 0,
      };
    });
  }

  async getByPersonnel(range: FinancialRange = {}, limit = 50): Promise<RevenueByPersonnel[]> {
    const p = { i: 1 };
    const { sql: where, params } = this.rangeClause(range, p);
    const clause = where
      ? `${where} AND personnel_name IS NOT NULL`
      : "WHERE personnel_name IS NOT NULL";

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT
         personnel_name,
         COALESCE(SUM(received_price), 0)::text     AS received,
         COALESCE(SUM(discount), 0)::text           AS discount,
         COUNT(*)::int                              AS line_count,
         COUNT(DISTINCT patient_external_code)::int AS unique_patients
       FROM reception_items ${clause}
       GROUP BY personnel_name
       ORDER BY SUM(received_price) DESC NULLS LAST
       LIMIT $${p.i}`,
      ...params,
      limit,
    );

    return rows.map((r) => {
      const received = this.toNumber(r.received);
      const patients = this.toNumber(r.unique_patients);
      return {
        personnelName: String(r.personnel_name),
        received,
        discount: this.toNumber(r.discount),
        lineCount: this.toNumber(r.line_count),
        uniquePatients: patients,
        averagePerPatient: patients > 0 ? received / patients : 0,
      };
    });
  }

  /** Revenue and patient counts per RFM segment. */
  async getSegmentSummary() {
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT segment::text                          AS segment,
              COUNT(*)::int                          AS patient_count,
              COALESCE(SUM(total_received), 0)::text AS total_received
       FROM patient_metrics
       GROUP BY segment
       ORDER BY SUM(total_received) DESC NULLS LAST`,
    );

    const total = rows.reduce((sum, r) => sum + this.toNumber(r.total_received), 0);

    return rows.map((r) => {
      const revenue = this.toNumber(r.total_received);
      const count = this.toNumber(r.patient_count);
      const segment = String(r.segment) as keyof typeof PATIENT_SEGMENT_LABELS;
      return {
        segment,
        segmentLabel: PATIENT_SEGMENT_LABELS[segment] ?? String(r.segment),
        patientCount: count,
        totalReceived: revenue,
        revenueShare: total > 0 ? revenue / total : 0,
        averageTicket: count > 0 ? revenue / count : 0,
      };
    });
  }
}
