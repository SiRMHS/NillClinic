import { prisma } from "@jordan/db";
import {
  jalaliToSqlDate,
  CONSULTATION_SERVICE_REGEX,
  ENTRY_SERVICE_REGEX,
  NON_DOCTOR_NAME_PATTERNS,
  type Doctor,
  type DoctorReport,
  type DoctorReportQuery,
  type DoctorReportRow,
  type DoctorTrendPoint,
  type EntryConversionRow,
  type FinancialGranularity,
  type FinancialRange,
} from "@jordan/shared";

/**
 * Per-practitioner reporting over `reception_items`.
 *
 * ## The practitioner column
 *
 * `receptions.user_name` holds the front-desk operator who registered the
 * visit, not the clinician. The person who did the work is
 * `reception_items.personnel_name`, at the billed-line grain — which is also
 * where the money is, so both facts point at the same table.
 *
 * ## Splitting
 *
 * `personnel_name` is multi-valued: some lines name two practitioners joined by
 * an Arabic comma (`محمد علی نیلفروش زاده، فرناز محسن پور`). Grouping the raw
 * column invents a doctor whose name is the pair and removes those lines from
 * both real doctors. Everything here unnests the split instead, which credits a
 * shared line to each participant; `sharedLineCount` discloses how much of the
 * report that affects.
 */
export class DoctorReportService {
  private toNumber(value: unknown): number {
    if (value === null || value === undefined) return 0;
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * SQL fragment producing one row per (line, practitioner) pair.
   *
   * `string_to_array` on the Arabic comma splits the shared lines; the `trim`
   * matters because the CRM writes `A، B` with a following space.
   */
  private static readonly SPLIT_PERSONNEL = `
    LEFT JOIN LATERAL unnest(
      string_to_array(COALESCE(ri.personnel_name, ''), '،')
    ) AS split(raw) ON TRUE`;

  /** Excludes the service names and acquisition sources that pollute the column. */
  private doctorNameFilter(alias = "btrim(split.raw)"): string {
    const notLike = NON_DOCTOR_NAME_PATTERNS.map((p) => `${alias} NOT LIKE '${p}'`).join(" AND ");
    return `${alias} <> '' AND ${notLike}`;
  }

  /**
   * Inclusive Jalali range on the denormalized `reception_at`.
   * `to` moves one day forward so the final day is whole.
   */
  private rangeClause(range: FinancialRange, bind: (v: unknown) => string): string {
    const parts: string[] = ["ri.reception_at IS NOT NULL"];
    const from = range.from ? jalaliToSqlDate(range.from) : null;
    const to = range.to ? jalaliToSqlDate(range.to) : null;
    if (from) parts.push(`ri.reception_at >= ${bind(from)}::timestamp`);
    if (to) parts.push(`ri.reception_at < (${bind(to)}::timestamp + interval '1 day')`);
    return parts.join(" AND ");
  }

  /** Distinct practitioners, for the report's doctor picker. */
  async listDoctors(range: FinancialRange = {}): Promise<Doctor[]> {
    const params: unknown[] = [];
    let i = 1;
    const bind = (v: unknown): string => {
      params.push(v);
      return `$${i++}`;
    };
    const where = this.rangeClause(range, bind);

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT
         btrim(split.raw)                              AS name,
         COUNT(*)::int                                 AS line_count,
         COUNT(DISTINCT ri.patient_external_code)::int AS patient_count,
         COALESCE(SUM(ri.received_price), 0)::text     AS received
       FROM reception_items ri
       ${DoctorReportService.SPLIT_PERSONNEL}
       WHERE ${where} AND ${this.doctorNameFilter()}
       GROUP BY 1
       ORDER BY SUM(ri.received_price) DESC NULLS LAST`,
      ...params,
    );

    return rows.map((r) => ({
      name: String(r.name),
      lineCount: this.toNumber(r.line_count),
      patientCount: this.toNumber(r.patient_count),
      received: this.toNumber(r.received),
    }));
  }

  async getReport(query: DoctorReportQuery): Promise<DoctorReport> {
    const params: unknown[] = [];
    let i = 1;
    const bind = (v: unknown): string => {
      params.push(v);
      return `$${i++}`;
    };

    const rangeWhere = this.rangeClause(query, bind);

    // Who and which patients the report is about.
    const scope = [rangeWhere, this.doctorNameFilter()];
    if (query.doctors?.length) {
      scope.push(`btrim(split.raw) = ANY(${bind(query.doctors)}::text[])`);
    }
    if (query.tier) {
      scope.push(
        `EXISTS (SELECT 1 FROM patient_metrics m
                  WHERE m.patient_external_code = ri.patient_external_code
                    AND m.tier = ${bind(query.tier)}::"PatientTier")`,
      );
    }

    /**
     * The service-kind filter, applied to the classification the query already
     * computes rather than to `service_name` a second time.
     *
     * It used to be a WHERE clause of its own, which meant the same three
     * ILIKEs ran twice over 400k rows and — worse — gave the filter a second
     * definition of what counts as a خدمت that could drift from the CASE below.
     */
    const KIND_FILTERS: Record<DoctorReportQuery["serviceKind"], string> = {
      all: "",
      consultation: " WHERE line_kind = 'consultation'",
      visit: " WHERE line_kind = 'visit'",
      service: " WHERE line_kind = 'service'",
    };
    const kindFilter = KIND_FILTERS[query.serviceKind];

    const where = scope.join(" AND ");
    const consultRegex = bind(CONSULTATION_SERVICE_REGEX);
    const entryRegex = bind(ENTRY_SERVICE_REGEX);
    // Explicit range start for the new-patient test. With no `from`, every
    // patient's first visit to a doctor necessarily falls on or after the
    // beginning of time, so an all-time report correctly reports each patient
    // as having been new to that doctor once.
    const rangeStart = bind(query.from ? jalaliToSqlDate(query.from) : "1900-01-01");

    // Money columns are selected as ::text so numeric precision survives the
    // trip through the driver, and an ORDER BY cannot cast an output alias —
    // so sorting repeats the aggregate expression rather than naming the alias.
    const SORT_COLUMNS: Record<string, string> = {
      received: "SUM(l.received_price)",
      patients: "COUNT(DISTINCT l.patient_external_code)",
      receptions: "COUNT(DISTINCT l.reception_external_id)",
      lines: "COUNT(*)",
      discount: "SUM(l.discount)",
      outstanding: "SUM(l.remain_price)",
      avgPerPatient: "avg_per_patient",
      newPatients: "new_patient_count",
      name: "l.doctor_name",
    };
    const column = SORT_COLUMNS[query.sort] ?? SORT_COLUMNS.received!;
    const dir = query.direction === "asc" ? "ASC" : "DESC";

    /**
     * `new_patient_count` compares each patient's first line *with this doctor*
     * against the range start. Counting "patients whose first-ever clinic visit
     * falls in the range" would instead credit the doctor who happened to see a
     * long-standing patient first that month.
     */
    const rowsPromise = prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `WITH scoped AS (
         SELECT
           btrim(split.raw)              AS doctor_name,
           ri.reception_external_id,
           ri.patient_external_code,
           ri.received_price,
           ri.discount,
           ri.remain_price,
           ri.reception_at,
           CASE
             WHEN ri.service_name !~ ${entryRegex}   THEN 'service'
             WHEN ri.service_name ~  ${consultRegex} THEN 'consultation'
             ELSE 'visit'
           END                          AS line_kind
         FROM reception_items ri
         ${DoctorReportService.SPLIT_PERSONNEL}
         WHERE ${where}
       ),
       /* The service-kind filter, applied to the classification the query
          already computed rather than to service_name a second time. */
       lines AS (SELECT * FROM scoped${kindFilter}),
       first_seen AS (
         SELECT btrim(s2.raw) AS doctor_name,
                ri2.patient_external_code,
                MIN(ri2.reception_at) AS first_at
         FROM reception_items ri2
         LEFT JOIN LATERAL unnest(
           string_to_array(COALESCE(ri2.personnel_name, ''), '،')
         ) AS s2(raw) ON TRUE
         WHERE ri2.reception_at IS NOT NULL AND btrim(s2.raw) <> ''
         GROUP BY 1, 2
       )
       SELECT
         l.doctor_name,
         COUNT(DISTINCT l.reception_external_id)::int  AS reception_count,
         COUNT(*)::int                                 AS line_count,
         COUNT(DISTINCT l.patient_external_code)::int  AS patient_count,
         COUNT(DISTINCT l.patient_external_code) FILTER (
           WHERE f.first_at >= ${rangeStart}::timestamp
         )::int                                        AS new_patient_count,
         COALESCE(SUM(l.received_price), 0)::text      AS received,
         COALESCE(SUM(l.discount), 0)::text            AS discount,
         COALESCE(SUM(l.remain_price), 0)::text        AS outstanding,
         COUNT(*) FILTER (WHERE l.line_kind = 'consultation')::int AS consultation_count,
         COUNT(*) FILTER (WHERE l.line_kind = 'visit')::int        AS visit_count,
         COUNT(*) FILTER (WHERE l.line_kind = 'service')::int      AS service_count,
         CASE WHEN COUNT(DISTINCT l.patient_external_code) > 0
              THEN COALESCE(SUM(l.received_price), 0) / COUNT(DISTINCT l.patient_external_code)
              ELSE 0 END                               AS avg_per_patient
       FROM lines l
       LEFT JOIN first_seen f
         ON f.doctor_name = l.doctor_name
        AND f.patient_external_code = l.patient_external_code
       GROUP BY l.doctor_name
       ORDER BY ${column} ${dir} NULLS LAST
       LIMIT ${bind(query.limit)}`,
      ...params,
    );

    // Clinic revenue for the same range, used as the share denominator. It is
    // computed off the unsplit table so a shared line counts once — sharing the
    // split total would make the shares sum to more than 100%.
    //
    const totalParams: unknown[] = [];
    let j = 1;
    const totalBind = (v: unknown): string => {
      totalParams.push(v);
      return `$${j++}`;
    };
    const totalWhere = this.rangeClause(query, totalBind);
    const totalsPromise = prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT
         COALESCE(SUM(ri.received_price), 0)::text     AS received,
         COALESCE(SUM(ri.discount), 0)::text           AS discount,
         COALESCE(SUM(ri.remain_price), 0)::text       AS outstanding,
         COUNT(DISTINCT ri.patient_external_code)::int AS patient_count,
         COUNT(DISTINCT ri.reception_external_id)::int AS reception_count,
         COUNT(*)::int                                 AS line_count,
         COUNT(*) FILTER (WHERE ri.personnel_name LIKE '%،%')::int AS shared_lines
       FROM reception_items ri
       WHERE ${totalWhere}`,
      ...totalParams,
    );

    // Three independent statements over the same lines. Awaited together rather
    // than one after another: run in sequence, an all-time report spent most of
    // its wall clock idle between round trips.
    const [rows, totalRows, entryConversion] = await Promise.all([
      rowsPromise,
      totalsPromise,
      this.getEntryConversion(query),
    ]);

    const t = totalRows[0] ?? {};
    const clinicRevenue = this.toNumber(t.received);

    const reportRows: DoctorReportRow[] = rows.map((r) => {
      const received = this.toNumber(r.received);
      const receptionCount = this.toNumber(r.reception_count);
      return {
        doctorName: String(r.doctor_name),
        receptionCount,
        lineCount: this.toNumber(r.line_count),
        patientCount: this.toNumber(r.patient_count),
        newPatientCount: this.toNumber(r.new_patient_count),
        received,
        discount: this.toNumber(r.discount),
        outstanding: this.toNumber(r.outstanding),
        averagePerPatient: this.toNumber(r.avg_per_patient),
        averagePerReception: receptionCount > 0 ? received / receptionCount : 0,
        consultationCount: this.toNumber(r.consultation_count),
        visitCount: this.toNumber(r.visit_count),
        serviceCount: this.toNumber(r.service_count),
        revenueShare: clinicRevenue > 0 ? received / clinicRevenue : 0,
      };
    });

    return {
      rows: reportRows,
      totals: {
        doctorCount: reportRows.length,
        received: clinicRevenue,
        discount: this.toNumber(t.discount),
        outstanding: this.toNumber(t.outstanding),
        patientCount: this.toNumber(t.patient_count),
        receptionCount: this.toNumber(t.reception_count),
        lineCount: this.toNumber(t.line_count),
      },
      sharedLineCount: this.toNumber(t.shared_lines),
      entryConversion,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * «چند درصد از مشاوره‌ها و ویزیت‌ها خدمت شد» — per entry service.
   *
   * One rate for all entry points would be an average of two different
   * questions: a ویزیت عمومی and a مشاوره کاشت مو convert at nothing like the
   * same rate, and the clinic acts on them separately. So the breakdown is the
   * report, and a single headline number is left to the caller to compute if it
   * wants one.
   *
   * Deliberately ignores `serviceKind`. That filter chooses which lines the
   * table above counts; here it would delete either the numerator or the
   * denominator and turn every rate into 0% or 100%.
   */
  private async getEntryConversion(query: DoctorReportQuery): Promise<EntryConversionRow[]> {
    const params: unknown[] = [];
    let i = 1;
    const bind = (v: unknown): string => {
      params.push(v);
      return `$${i++}`;
    };

    const rangeWhere = this.rangeClause(query, bind);
    const scope = [rangeWhere];
    /**
     * The practitioner split is joined only when the report is narrowed to
     * particular doctors, because that is the only thing it is needed for here.
     *
     * The unnest is the expensive half of this statement — it re-reads and
     * re-splits `personnel_name` for every line in range — and this query
     * counts *patients per entry service*, a figure the practitioner column
     * does not enter into. Dropping the `doctorNameFilter` along with it is
     * deliberate rather than incidental: that filter exists to stop a polluted
     * `personnel_name` from inventing a doctor, and a ویزیت whose practitioner
     * cell holds a service name is still a ویزیت that a real patient attended.
     */
    const splitPersonnel = query.doctors?.length ? DoctorReportService.SPLIT_PERSONNEL : "";
    if (query.doctors?.length) {
      scope.push(this.doctorNameFilter());
      scope.push(`btrim(split.raw) = ANY(${bind(query.doctors)}::text[])`);
    }
    if (query.tier) {
      scope.push(
        `EXISTS (SELECT 1 FROM patient_metrics m
                  WHERE m.patient_external_code = ri.patient_external_code
                    AND m.tier = ${bind(query.tier)}::"PatientTier")`,
      );
    }
    const where = scope.join(" AND ");
    const consultRegex = bind(CONSULTATION_SERVICE_REGEX);
    const entryRegex = bind(ENTRY_SERVICE_REGEX);

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `WITH entry_lines AS (
         SELECT COALESCE(ri.service_name, 'نامشخص') AS entry_name,
                CASE WHEN ri.service_name ~ ${consultRegex}
                     THEN 'consultation' ELSE 'visit' END AS kind,
                ri.patient_external_code AS pid,
                ri.reception_at
         FROM reception_items ri
         ${splitPersonnel}
         WHERE ${where}
           AND ri.patient_external_code IS NOT NULL
           AND ri.service_name ~ ${entryRegex}
       ),
       /* Collapsed to one row per (entry service, patient) before anything is
          counted: a patient seen three times under ویزیت is one patient, and
          summing their spend once per line would inflate the revenue column. */
       entry_patients AS (
         SELECT entry_name, MIN(kind) AS kind, pid, MIN(reception_at) AS first_entry_at
         FROM entry_lines GROUP BY entry_name, pid
       ),
       /* Read twice below — once to decide conversion, once to sum what the
          converted patients spent — so it is evaluated once, not inlined. */
       service_first AS MATERIALIZED (
         SELECT ri.patient_external_code AS pid,
                MIN(ri.reception_at)             AS first_service_at,
                COALESCE(SUM(ri.received_price), 0) AS revenue
         FROM reception_items ri
         WHERE ${rangeWhere}
           AND ri.patient_external_code IS NOT NULL
           AND ri.service_name IS NOT NULL
           AND ri.service_name !~ ${entryRegex}
         GROUP BY 1
       )
       SELECT e.entry_name,
              MIN(e.kind)   AS kind,
              COUNT(*)::int AS patient_count,
              COUNT(*) FILTER (WHERE converted)::int AS converted_count,
              COALESCE(SUM(f.revenue) FILTER (WHERE converted), 0)::text AS service_revenue
       FROM (
         SELECT ep.*, (f0.first_service_at IS NOT NULL
                        AND f0.first_service_at >= ep.first_entry_at::date) AS converted
         FROM entry_patients ep
         LEFT JOIN service_first f0 ON f0.pid = ep.pid
       ) e
       LEFT JOIN service_first f ON f.pid = e.pid
       GROUP BY e.entry_name
       ORDER BY patient_count DESC
       LIMIT 60`,
      ...params,
    );

    return rows.map((r) => {
      const patientCount = this.toNumber(r.patient_count);
      const convertedCount = this.toNumber(r.converted_count);
      return {
        entryName: String(r.entry_name),
        kind: r.kind === "consultation" ? ("consultation" as const) : ("visit" as const),
        patientCount,
        convertedCount,
        conversionRate: patientCount > 0 ? convertedCount / patientCount : 0,
        serviceRevenue: this.toNumber(r.service_revenue),
      };
    });
  }

  /** Per-period series for one doctor, for the trend chart. */
  async getTrend(
    doctorName: string,
    range: FinancialRange,
    granularity: FinancialGranularity,
  ): Promise<DoctorTrendPoint[]> {
    const params: unknown[] = [];
    let i = 1;
    const bind = (v: unknown): string => {
      params.push(v);
      return `$${i++}`;
    };
    const where = this.rangeClause(range, bind);
    const doctorParam = bind(doctorName);

    // The Jalali date is already a zero-padded string, so a period label is a
    // prefix of it — no calendar conversion, and it groups chronologically.
    const periodExpr =
      granularity === "year"
        ? "left(ri.reception_date, 4)"
        : granularity === "month"
          ? "left(ri.reception_date, 7)"
          : "ri.reception_date";

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT
         ${periodExpr}                                 AS period,
         COALESCE(SUM(ri.received_price), 0)::text     AS received,
         COUNT(DISTINCT ri.patient_external_code)::int AS patient_count,
         COUNT(DISTINCT ri.reception_external_id)::int AS reception_count
       FROM reception_items ri
       ${DoctorReportService.SPLIT_PERSONNEL}
       WHERE ${where}
         AND ri.reception_date IS NOT NULL
         AND btrim(split.raw) = ${doctorParam}
       GROUP BY 1
       ORDER BY 1 ASC`,
      ...params,
    );

    return rows.map((r) => ({
      period: String(r.period),
      received: this.toNumber(r.received),
      patientCount: this.toNumber(r.patient_count),
      receptionCount: this.toNumber(r.reception_count),
    }));
  }
}
