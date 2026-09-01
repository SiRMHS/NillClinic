import { prisma } from "@jordan/db";
import {
  jalaliToSqlDate,
  jalaliToday,
  PATIENT_SEGMENT_LABELS,
  PATIENT_TIER_LABELS,
  PATIENT_TIER_ORDER,
  type PatientSegment,
  type PatientTier,
  type PatientVipFlag,
  type TierActivity,
  type TierActivityQuery,
  type TierSettings,
  type TierSettingsUpdate,
  type TierSummary,
} from "@jordan/shared";
import { getTierSettings } from "./patient-ranking.service.js";

/**
 * Spend tiers and the activity feed built on them.
 *
 * The feed exists to answer one question the ranking table cannot: *when* does
 * a valuable patient show up again. A ranking is a snapshot of worth; this is
 * the stream of events attached to that worth, so a platinum patient booking an
 * appointment is visible the moment the sync brings it in.
 */
export class TierService {
  private toNumber(value: unknown): number {
    if (value === null || value === undefined) return 0;
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  getSettings(): Promise<TierSettings> {
    return getTierSettings();
  }

  /**
   * Persist new thresholds. Tiers are stored, not derived per request, so the
   * write is only half the job — every patient has to be re-tiered before the
   * numbers on screen agree with the new bounds.
   */
  async updateSettings(update: TierSettingsUpdate): Promise<TierSettings> {
    await prisma.tierSettings.upsert({
      where: { id: 1 },
      create: { id: 1, ...update },
      update,
    });
    return this.getSettings();
  }

  /**
   * One row per tier, always all five.
   *
   * A tier with no members still has to appear — an empty PLATINUM row is a
   * finding (the threshold is set too high), whereas a missing one just looks
   * like the report forgot about it.
   */
  async getSummary(): Promise<TierSummary[]> {
    const settings = await getTierSettings();

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT
         m.tier::text                                       AS tier,
         COUNT(*)::int                                      AS patient_count,
         COALESCE(SUM(m.total_received), 0)::text           AS total_received,
         COALESCE(SUM(m.total_outstanding), 0)::text        AS total_outstanding,
         COUNT(*) FILTER (WHERE m.recency_days > 365)::int  AS at_risk_count
       FROM patient_metrics m
       GROUP BY m.tier`,
    );

    const byTier = new Map(rows.map((r) => [String(r.tier), r]));
    // Share is of positive revenue only. GRAY's lifetime total is negative
    // (refund-only patients), and letting that into the denominator would push
    // every other tier's share above 100%.
    const totalRevenue = rows.reduce(
      (sum, r) => sum + Math.max(0, this.toNumber(r.total_received)),
      0,
    );

    const floors: Record<PatientTier, number | null> = {
      PLATINUM: settings.platinumMin,
      GOLD: settings.goldMin,
      SILVER: settings.silverMin,
      BRONZE: settings.bronzeMin,
      // GRAY has no floor by definition — it is everything below BRONZE,
      // including the refund-only patients whose lifetime total is negative.
      GRAY: null,
    };

    return PATIENT_TIER_ORDER.map((tier) => {
      const r = byTier.get(tier);
      const patientCount = r ? this.toNumber(r.patient_count) : 0;
      const totalReceived = r ? this.toNumber(r.total_received) : 0;
      return {
        tier,
        tierLabel: PATIENT_TIER_LABELS[tier],
        patientCount,
        totalReceived,
        totalOutstanding: r ? this.toNumber(r.total_outstanding) : 0,
        revenueShare: totalRevenue > 0 ? Math.max(0, totalReceived) / totalRevenue : 0,
        averageSpend: patientCount > 0 ? totalReceived / patientCount : 0,
        minSpend: floors[tier],
        atRiskCount: r ? this.toNumber(r.at_risk_count) : 0,
      };
    });
  }

  /**
   * Receptions that happened and appointments that are booked, in one stream.
   *
   * Both halves are selected with an identical column list and UNIONed in SQL
   * rather than merged in Node: the two tables together hold ~600k rows, and
   * paginating a feed means the database has to do the ordering.
   */
  async getActivity(query: TierActivityQuery): Promise<{ total: number; items: TierActivity[] }> {
    const params: unknown[] = [];
    let i = 1;
    /**
     * Placeholders are numbered in call order, so a bind must only happen for a
     * branch that actually reaches the final SQL. Binding both halves of the
     * union up front and then dropping one to `kind` would leave Postgres with
     * more parameters than placeholders.
     */
    const bind = (value: unknown): string => {
      params.push(value);
      return `$${i++}`;
    };

    const today = jalaliToday();
    const search = query.search?.trim();
    const doctor = query.doctor?.trim();
    // `upcomingOnly` asks for bookings that have not happened yet, so the
    // receptions arm is dropped from the union entirely rather than filtered to
    // nothing — a scan of 319k rows that can only return zero is still a scan.
    const wantReceptions = query.kind !== "RESERVE" && !query.upcomingOnly;
    const wantReserves = query.kind !== "RECEPTION";

    // Bound once and referenced from both halves — the same placeholder can
    // appear any number of times in one statement.
    const tierParam = query.tiers?.length ? bind(query.tiers) : null;
    const tierFilter = tierParam ? `AND m.tier = ANY(${tierParam}::"PatientTier"[])` : "";

    const searchLike = search ? bind(`%${search}%`) : null;
    const searchExact = search ? bind(search) : null;
    const searchFilter = searchLike
      ? `AND (p.full_name ILIKE ${searchLike} OR p.mobile ILIKE ${searchLike} OR p.external_code::text = ${searchExact})`
      : "";

    const doctorLike = doctor ? bind(`%${doctor}%`) : null;
    // Only the reserves arm compares against today; binding it unconditionally
    // would leave a stray parameter when that arm is dropped.
    const todayParam = wantReserves ? bind(today) : null;

    // Joining reception_items in directly would repeat a visit once per billed
    // line, so a patient with eight services would flood the page. The
    // practitioner is instead attached after paging, below.
    const receptionsSql = wantReceptions
      ? `
      SELECT
        'RECEPTION'::text                          AS kind,
        r.id                                       AS id,
        p.id                                       AS patient_id,
        m.patient_external_code                    AS code,
        p.full_name                                AS full_name,
        p.mobile                                   AS mobile,
        m.tier::text                               AS tier,
        m.segment::text                            AS segment,
        m.total_received::text                     AS lifetime_spend,
        m.visit_count                              AS visit_count,
        r.reception_date                           AS date,
        NULL::text                                 AS time,
        -- Left null here on purpose; resolved after the page is cut. See the
        -- note on the outer query below.
        NULL::text                                 AS doctor_name,
        r.treatment_item_names                     AS services,
        r.total_received::text                     AS amount,
        NULL::boolean                              AS is_accepted,
        false                                      AS is_upcoming
      FROM receptions r
      JOIN patients p        ON p.id = r.patient_id
      JOIN patient_metrics m ON m.patient_id = p.id
      WHERE r.reception_at IS NOT NULL
        ${tierFilter}
        ${searchFilter}
        ${query.from ? `AND r.reception_at >= ${bind(jalaliToSqlDate(query.from))}::timestamp` : ""}
        ${query.to ? `AND r.reception_at < (${bind(jalaliToSqlDate(query.to))}::timestamp + interval '1 day')` : ""}
        ${doctorLike ? `AND EXISTS (SELECT 1 FROM reception_items ri WHERE ri.reception_id = r.id AND ri.personnel_name ILIKE ${doctorLike})` : ""}
    `
      : "";

    // Reserve dates are zero-padded Jalali `YYYY/MM/DD`, so lexical comparison
    // is chronologically correct and the existing reserve_date index serves it
    // — no per-row calendar conversion needed.
    const reservesSql = wantReserves
      ? `
      SELECT
        'RESERVE'::text                            AS kind,
        rs.id                                      AS id,
        p.id                                       AS patient_id,
        m.patient_external_code                    AS code,
        p.full_name                                AS full_name,
        p.mobile                                   AS mobile,
        m.tier::text                               AS tier,
        m.segment::text                            AS segment,
        m.total_received::text                     AS lifetime_spend,
        m.visit_count                              AS visit_count,
        rs.reserve_date                            AS date,
        rs.reserve_time                            AS time,
        rs.doctor_name                             AS doctor_name,
        rs.services_raw                            AS services,
        NULL::text                                 AS amount,
        rs.is_accepted                             AS is_accepted,
        (rs.reserve_date >= ${todayParam})         AS is_upcoming
      FROM reserves rs
      JOIN patients p        ON p.id = rs.patient_id
      JOIN patient_metrics m ON m.patient_id = p.id
      WHERE rs.reserve_date IS NOT NULL
        ${tierFilter}
        ${searchFilter}
        ${query.from ? `AND rs.reserve_date >= ${bind(query.from)}` : ""}
        ${query.to ? `AND rs.reserve_date <= ${bind(query.to)}` : ""}
        ${doctorLike ? `AND rs.doctor_name ILIKE ${doctorLike}` : ""}
        ${query.upcomingOnly ? `AND rs.reserve_date >= ${todayParam}` : ""}
    `
      : "";

    const union = [receptionsSql, reservesSql].filter(Boolean).join(" UNION ALL ");

    const countRows = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT COUNT(*)::int AS n FROM (${union}) f`,
      ...params,
    );

    /**
     * Page first, then resolve the practitioner.
     *
     * A reception's practitioner lives across its line items, so it needs an
     * aggregate per row. Computing it inside the union means running it for
     * every matching reception — ~49k for PLATINUM alone — merely to display
     * fifty. The lateral join sits outside the LIMIT, so it executes once per
     * displayed row instead.
     *
     * Upcoming appointments lead the feed regardless of date: a booking that
     * has not happened yet is the only row here that can still be acted on.
     * Everything else is history, newest first.
     */
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `WITH page AS (
         SELECT * FROM (${union}) f
         ORDER BY f.is_upcoming DESC,
                  CASE WHEN f.is_upcoming THEN f.date END ASC,
                  CASE WHEN NOT f.is_upcoming THEN f.date END DESC,
                  f.time DESC NULLS LAST
         LIMIT ${bind(query.limit)} OFFSET ${bind(query.offset)}
       )
       SELECT page.*,
              COALESCE(page.doctor_name, personnel.names) AS resolved_doctor
       FROM page
       LEFT JOIN LATERAL (
         SELECT string_agg(DISTINCT ri.personnel_name, '، ') AS names
         FROM reception_items ri
         WHERE page.kind = 'RECEPTION'
           AND ri.reception_id = page.id
           AND ri.personnel_name IS NOT NULL
           AND ri.personnel_name <> ''
       ) personnel ON TRUE`,
      ...params,
    );

    return {
      total: countRows[0]?.n ?? 0,
      items: rows.map((r) => {
        const tier = String(r.tier) as PatientTier;
        const segment = r.segment === null ? null : (String(r.segment) as PatientSegment);
        return {
          kind: String(r.kind) as TierActivity["kind"],
          id: `${String(r.kind)}:${String(r.id)}`,
          patientId: r.patient_id === null ? null : String(r.patient_id),
          patientExternalCode: r.code === null ? null : this.toNumber(r.code),
          fullName: r.full_name === null ? null : String(r.full_name),
          mobile: r.mobile === null ? null : String(r.mobile),
          tier,
          tierLabel: PATIENT_TIER_LABELS[tier] ?? tier,
          segment,
          lifetimeSpend: this.toNumber(r.lifetime_spend),
          visitCount: this.toNumber(r.visit_count),
          date: r.date === null ? null : String(r.date),
          time: r.time === null ? null : String(r.time),
          doctorName: r.resolved_doctor === null ? null : String(r.resolved_doctor),
          services: r.services === null ? null : String(r.services),
          amount: r.amount === null ? null : this.toNumber(r.amount),
          isAccepted: r.is_accepted === null ? null : Boolean(r.is_accepted),
          isUpcoming: Boolean(r.is_upcoming),
        };
      }),
    };
  }

  // ─── Manual VIP standing ───

  /**
   * Assign or clear a patient's hand-given standing.
   *
   * The patient's tier is re-derived immediately rather than left to the next
   * sync: marking someone VIP and then watching them sit in BRONZE until
   * tomorrow reads as the flag not having worked. Only this patient's row is
   * touched — a full recompute walks every reception line in the clinic, which
   * is far too much work for one checkbox.
   */
  async setVipFlag(
    externalCode: number,
    flag: PatientVipFlag | null,
    note: string | null,
    userId: string | null,
  ): Promise<{ vipFlag: PatientVipFlag | null; vipNote: string | null; tier: PatientTier } | null> {
    const patient = await prisma.patient.findUnique({
      where: { externalCode },
      select: { id: true },
    });
    if (!patient) return null;

    const updated = await prisma.patient.update({
      where: { id: patient.id },
      data: {
        vipFlag: flag,
        vipNote: flag ? note : null,
        vipSetAt: flag ? new Date() : null,
        vipSetById: flag ? userId : null,
      },
      select: { vipFlag: true, vipNote: true },
    });

    const settings = await getTierSettings();
    // Clearing the flag hands the patient back to their spend band, so the tier
    // is recomputed from the thresholds rather than simply left at PLATINUM.
    await prisma.$executeRawUnsafe(
      `UPDATE patient_metrics
          SET tier = (CASE
                WHEN $2::text IS NOT NULL          THEN 'PLATINUM'
                WHEN total_received >= $3::numeric THEN 'PLATINUM'
                WHEN total_received >= $4::numeric THEN 'GOLD'
                WHEN total_received >= $5::numeric THEN 'SILVER'
                WHEN total_received >= $6::numeric THEN 'BRONZE'
                ELSE 'GRAY' END)::"PatientTier"
        WHERE patient_id = $1`,
      patient.id,
      updated.vipFlag,
      settings.platinumMin,
      settings.goldMin,
      settings.silverMin,
      settings.bronzeMin,
    );

    const metrics = await prisma.patientMetrics.findUnique({
      where: { patientId: patient.id },
      select: { tier: true },
    });

    return {
      vipFlag: updated.vipFlag,
      vipNote: updated.vipNote,
      // A patient with no billing history has no metrics row and so no computed
      // tier; GRAY is what every other surface shows for them.
      tier: metrics?.tier ?? "GRAY",
    };
  }

  /**
   * Headline counts for the activity page: what the valuable tiers are doing
   * right now, as opposed to what they are worth in total.
   */
  async getActivityStats(tiers: PatientTier[] = ["PLATINUM", "GOLD"]) {
    const today = jalaliToday();

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT
         (SELECT COUNT(*)::int
            FROM reserves rs
            JOIN patient_metrics m ON m.patient_id = rs.patient_id
           WHERE m.tier = ANY($1::"PatientTier"[])
             AND rs.reserve_date >= $2)                     AS upcoming_reserves,
         (SELECT COUNT(*)::int
            FROM receptions r
            JOIN patient_metrics m ON m.patient_id = r.patient_id
           WHERE m.tier = ANY($1::"PatientTier"[])
             AND r.reception_at >= (NOW() - interval '30 days')) AS receptions_30d,
         (SELECT COALESCE(SUM(r.total_received), 0)::text
            FROM receptions r
            JOIN patient_metrics m ON m.patient_id = r.patient_id
           WHERE m.tier = ANY($1::"PatientTier"[])
             AND r.reception_at >= (NOW() - interval '30 days')) AS revenue_30d,
         (SELECT COUNT(*)::int
            FROM patient_metrics m
           WHERE m.tier = ANY($1::"PatientTier"[])
             AND m.recency_days > 365)                      AS lapsed`,
      tiers,
      today,
    );

    const r = rows[0] ?? {};
    return {
      tiers,
      upcomingReserves: this.toNumber(r.upcoming_reserves),
      receptions30d: this.toNumber(r.receptions_30d),
      revenue30d: this.toNumber(r.revenue_30d),
      lapsed: this.toNumber(r.lapsed),
      generatedAt: new Date().toISOString(),
    };
  }
}

/** Re-exported so routes can label segments without reaching into shared. */
export { PATIENT_SEGMENT_LABELS };
