import { prisma } from "@jordan/db";
import {
  PATIENT_SEGMENT_LABELS,
  PATIENT_TIER_LABELS,
  type PatientRankingQuery,
  type RankedPatient,
  type PatientSegment,
  type PatientTier,
  type PatientVipFlag,
  type TierSettings,
} from "@jordan/shared";

/**
 * Defaults matching the migration, used when the settings row is missing.
 * Recomputing with silently-zero thresholds would flatten every patient into
 * PLATINUM, so the fallback is the real default rather than an empty object.
 *
 * Rial, being the unit every amount in this system is stored in. The clinic
 * states these bands in Toman — ۱ میلیارد / ۶۰۰ / ۳۰۰ / ۱۰۰ میلیون — so each
 * figure here is that number times ten.
 */
const DEFAULT_TIER_THRESHOLDS = {
  platinumMin: 10_000_000_000,
  goldMin: 6_000_000_000,
  silverMin: 3_000_000_000,
  bronzeMin: 1_000_000_000,
} as const;

/** Read the single editable thresholds row. */
export async function getTierSettings(): Promise<TierSettings> {
  const row = await prisma.tierSettings.findUnique({ where: { id: 1 } });
  if (!row) return { ...DEFAULT_TIER_THRESHOLDS, updatedAt: null };
  return {
    platinumMin: Number(row.platinumMin),
    goldMin: Number(row.goldMin),
    silverMin: Number(row.silverMin),
    bronzeMin: Number(row.bronzeMin),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * RFM (Recency / Frequency / Monetary) ranking.
 *
 * Recency and Frequency use ABSOLUTE thresholds; only Monetary is a population
 * quintile. Scoring all three relatively — the obvious first implementation —
 * produced two concrete defects on this clinic's data:
 *
 *   • Recency: ~70% of patients last visited more than two years ago, so the
 *     "most recent fifth" still reached back 2.8 years. Half of everyone
 *     labelled CHAMPION had not visited in over a year, and AT_RISK had a
 *     median staleness of 5.3 years — patients long past churning, not at risk
 *     of it. "How long since they came" is measured in real time, so it cannot
 *     be graded on a curve.
 *
 *   • Frequency: 50% of patients have exactly one visit, and NTILE splits ties
 *     across tile boundaries — those identical patients received scores of 1,
 *     2 AND 3. Visit counts are small integers with plain meaning, so they get
 *     explicit bands instead.
 *
 * Monetary stays relative: what counts as a large spend genuinely depends on
 * this clinic's price list, and spend is continuous enough that ties are rare.
 *
 * The whole computation runs as one SQL statement — scoring ~107k patients in
 * Node would mean streaming every reception line out of Postgres just to add
 * numbers.
 *
 * Only patients with at least one reception are ranked; a patient who has never
 * been billed has no recency, frequency or monetary value to rank on.
 */
export class PatientRankingService {
  /**
   * Recompute metrics for every patient with billing history.
   * Intended to run after a sync, not per request.
   */
  async recompute(now: Date = new Date()): Promise<{ patients: number; durationMs: number }> {
    const started = Date.now();
    const thresholds = await getTierSettings();

    // Jalali dates are zero-padded `YYYY/MM/DD`, so lexical MIN/MAX over the
    // string column is a correct chronological min/max — no conversion needed.
    const affected = await prisma.$executeRawUnsafe(
      `
      WITH agg AS (
        SELECT
          ri.patient_external_code                    AS code,
          COUNT(DISTINCT ri.reception_external_id)    AS visit_count,
          COALESCE(SUM(ri.received_price), 0)         AS total_received,
          COALESCE(SUM(ri.discount), 0)               AS total_discount,
          COALESCE(SUM(ri.remain_price), 0)           AS total_outstanding,
          MIN(ri.reception_date)                      AS first_visit_date,
          MAX(ri.reception_date)                      AS last_visit_date,
          MAX(ri.reception_at)                        AS last_visit_at
        FROM reception_items ri
        WHERE ri.patient_external_code IS NOT NULL
        GROUP BY ri.patient_external_code
      ),
      dated AS (
        SELECT p.id AS patient_id, a.*,
               p.vip_flag,
               GREATEST(0, ($1::timestamp)::date - a.last_visit_at::date) AS recency_days
        FROM agg a
        JOIN patients p ON p.external_code = a.code
      ),
      scored AS (
        SELECT
          d.patient_id,
          d.code,
          d.visit_count,
          d.total_received,
          d.total_discount,
          d.total_outstanding,
          d.first_visit_date,
          d.last_visit_date,
          d.last_visit_at,
          d.recency_days,
          -- Absolute bands, roughly one typical treatment cycle apart. The
          -- clinic's median gap between visits is ~53 days, so "within 90 days"
          -- is a genuinely active patient.
          CASE WHEN d.recency_days <= 90  THEN 5
               WHEN d.recency_days <= 180 THEN 4
               WHEN d.recency_days <= 365 THEN 3
               WHEN d.recency_days <= 730 THEN 2
               ELSE 1 END                                 AS recency_score,
          -- Explicit bands: identical visit counts must score identically,
          -- which NTILE cannot guarantee when half the population ties at 1.
          CASE WHEN d.visit_count >= 10 THEN 5
               WHEN d.visit_count >= 5  THEN 4
               WHEN d.visit_count >= 3  THEN 3
               WHEN d.visit_count = 2   THEN 2
               ELSE 1 END                                 AS frequency_score,
          NTILE(5) OVER (ORDER BY d.total_received ASC)   AS monetary_score,
          -- Absolute rial bands from tier_settings. Unlike monetary_score this
          -- is not a quintile: a patient must not be demoted because other
          -- patients spent more, only because their own spend is lower.
          --
          -- A hand-assigned VIP or celebrity is PLATINUM whatever the till
          -- says. That is the entire point of the manual flag: the clinic has
          -- patients it wants treated as top-tier for reasons spend cannot
          -- express, and a recompute must not quietly demote them the next time
          -- it runs.
          --
          -- GRAY is now everything under bronze_min rather than only
          -- non-payers, so it holds low-spend patients as well as the ~3.2k
          -- refund-only ones whose lifetime total is negative.
          CASE WHEN d.vip_flag IS NOT NULL          THEN 'PLATINUM'
               WHEN d.total_received >= $2::numeric THEN 'PLATINUM'
               WHEN d.total_received >= $3::numeric THEN 'GOLD'
               WHEN d.total_received >= $4::numeric THEN 'SILVER'
               WHEN d.total_received >= $5::numeric THEN 'BRONZE'
               ELSE 'GRAY' END                            AS tier
        FROM dated d
      )
      INSERT INTO patient_metrics (
        patient_id, patient_external_code, first_visit_date, last_visit_date,
        last_visit_at, recency_days, visit_count, total_received, total_discount,
        total_outstanding, avg_ticket, recency_score, frequency_score,
        monetary_score, rfm_score, segment, tier, computed_at
      )
      SELECT
        s.patient_id,
        s.code,
        s.first_visit_date,
        s.last_visit_date,
        s.last_visit_at,
        s.recency_days,
        s.visit_count,
        s.total_received,
        s.total_discount,
        s.total_outstanding,
        CASE WHEN s.visit_count > 0 THEN s.total_received / s.visit_count ELSE 0 END,
        s.recency_score,
        s.frequency_score,
        s.monetary_score,
        s.recency_score * 100 + s.frequency_score * 10 + s.monetary_score,
        -- Recency drives the branch, because how long ago someone came decides
        -- what you can still do about them; F and M then decide how much they
        -- are worth pursuing.
        (CASE
          -- Within 6 months: still an active relationship.
          WHEN s.recency_score >= 4 AND s.frequency_score >= 4 AND s.monetary_score >= 4
            THEN 'CHAMPION'
          WHEN s.recency_score >= 4 AND s.visit_count = 1
            THEN 'NEW'
          WHEN s.recency_score >= 4
            THEN 'POTENTIAL'
          -- 6-12 months: overdue, but a frequent visitor is still loyal.
          WHEN s.recency_score = 3 AND s.frequency_score >= 4
            THEN 'LOYAL'
          WHEN s.recency_score = 3
            THEN 'POTENTIAL'
          -- 1-2 years: genuinely slipping away and still recoverable. This is
          -- the group a win-back call actually pays off on.
          WHEN s.recency_score = 2 AND (s.frequency_score >= 3 OR s.monetary_score >= 4)
            THEN 'AT_RISK'
          WHEN s.recency_score = 2
            THEN 'DORMANT'
          -- Over 2 years: gone. Split by whether they were ever worth anything,
          -- so a win-back campaign has somewhere to aim.
          WHEN s.frequency_score >= 4 OR s.monetary_score >= 4
            THEN 'DORMANT'
          ELSE 'LOST'
        END)::"PatientSegment",
        s.tier::"PatientTier",
        $1::timestamp
      FROM scored s
      ON CONFLICT (patient_id) DO UPDATE SET
        patient_external_code = EXCLUDED.patient_external_code,
        first_visit_date      = EXCLUDED.first_visit_date,
        last_visit_date       = EXCLUDED.last_visit_date,
        last_visit_at         = EXCLUDED.last_visit_at,
        recency_days          = EXCLUDED.recency_days,
        visit_count           = EXCLUDED.visit_count,
        total_received        = EXCLUDED.total_received,
        total_discount        = EXCLUDED.total_discount,
        total_outstanding     = EXCLUDED.total_outstanding,
        avg_ticket            = EXCLUDED.avg_ticket,
        recency_score         = EXCLUDED.recency_score,
        frequency_score       = EXCLUDED.frequency_score,
        monetary_score        = EXCLUDED.monetary_score,
        rfm_score             = EXCLUDED.rfm_score,
        segment               = EXCLUDED.segment,
        tier                  = EXCLUDED.tier,
        computed_at           = EXCLUDED.computed_at
      `,
      now,
      thresholds.platinumMin,
      thresholds.goldMin,
      thresholds.silverMin,
      thresholds.bronzeMin,
    );

    return { patients: affected, durationMs: Date.now() - started };
  }

  async list(query: PatientRankingQuery): Promise<{ total: number; patients: RankedPatient[] }> {
    const where: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    if (query.segment) {
      where.push(`m.segment = $${i++}::"PatientSegment"`);
      params.push(query.segment);
    }
    if (query.tier) {
      where.push(`m.tier = $${i++}::"PatientTier"`);
      params.push(query.tier);
    }
    if (query.search) {
      where.push(`(p.full_name ILIKE $${i} OR p.mobile ILIKE $${i} OR p.external_code::text = $${i + 1})`);
      params.push(`%${query.search}%`, query.search);
      i += 2;
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    // Whitelist mapping: the sort key is validated by zod, and the column name
    // never comes from the request string itself.
    const SORT_COLUMNS: Record<string, string> = {
      rfm: "m.rfm_score",
      revenue: "m.total_received",
      visits: "m.visit_count",
      recency: "m.last_visit_at",
      discount: "m.total_discount",
      outstanding: "m.total_outstanding",
      avgTicket: "m.avg_ticket",
      name: "p.full_name",
      code: "m.patient_external_code",
      tier: "m.tier",
    };
    const column = SORT_COLUMNS[query.sort] ?? SORT_COLUMNS.rfm!;
    // The PatientTier enum is declared richest-first, so Postgres already sorts
    // PLATINUM below GRAY. Every other column here is "bigger is better", where
    // `desc` means best-first — so tier alone has to be flipped to keep one
    // consistent meaning of direction across the table's headers.
    const flip = query.sort === "tier";
    const ascending = (query.direction === "asc") !== flip;
    const dir = ascending ? "ASC" : "DESC";
    // Total spend is the tie-breaker so equal RFM scores stay stably ordered.
    const orderSql = `${column} ${dir} NULLS LAST, m.total_received DESC`;

    const countRows = await prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT COUNT(*)::int AS n
       FROM patient_metrics m JOIN patients p ON p.id = m.patient_id ${whereSql}`,
      ...params,
    );

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT
         m.patient_id, m.patient_external_code, p.full_name, p.mobile,
         m.visit_count, m.total_received::text AS total_received,
         m.total_discount::text AS total_discount,
         m.total_outstanding::text AS total_outstanding,
         m.avg_ticket::text AS avg_ticket,
         m.first_visit_date, m.last_visit_date, m.recency_days,
         m.recency_score, m.frequency_score, m.monetary_score,
         m.rfm_score, m.segment::text AS segment, m.tier::text AS tier,
         p.vip_flag::text AS vip_flag
       FROM patient_metrics m
       JOIN patients p ON p.id = m.patient_id
       ${whereSql}
       ORDER BY ${orderSql}
       LIMIT $${i++} OFFSET $${i}`,
      ...params,
      query.limit,
      query.offset,
    );

    const num = (v: unknown): number => {
      const n = Number(v ?? 0);
      return Number.isFinite(n) ? n : 0;
    };

    return {
      total: countRows[0]?.n ?? 0,
      patients: rows.map((r) => {
        const segment = String(r.segment) as PatientSegment;
        const tier = String(r.tier) as PatientTier;
        return {
          patientId: String(r.patient_id),
          patientExternalCode: num(r.patient_external_code),
          fullName: r.full_name === null ? null : String(r.full_name),
          mobile: r.mobile === null ? null : String(r.mobile),
          visitCount: num(r.visit_count),
          totalReceived: num(r.total_received),
          totalDiscount: num(r.total_discount),
          totalOutstanding: num(r.total_outstanding),
          averageTicket: num(r.avg_ticket),
          firstVisitDate: r.first_visit_date === null ? null : String(r.first_visit_date),
          lastVisitDate: r.last_visit_date === null ? null : String(r.last_visit_date),
          recencyDays: r.recency_days === null ? null : num(r.recency_days),
          recencyScore: num(r.recency_score),
          frequencyScore: num(r.frequency_score),
          monetaryScore: num(r.monetary_score),
          rfmScore: num(r.rfm_score),
          segment,
          segmentLabel: PATIENT_SEGMENT_LABELS[segment] ?? segment,
          tier,
          tierLabel: PATIENT_TIER_LABELS[tier] ?? tier,
          vipFlag: r.vip_flag === null ? null : (String(r.vip_flag) as PatientVipFlag),
        };
      }),
    };
  }
}
