import { jalaliWindows, type JalaliWindow } from "@jordan/shared";

export interface JordanApiConfig {
  baseUrl: string;
  username: string;
  password: string;
  company: string;
  /** Network/5xx retry attempts per request. Default 4. */
  maxRetries?: number;
  /** Per-request timeout. Default 120s — deep pages legitimately take seconds. */
  requestTimeoutMs?: number;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface DateRangeParams {
  /** Jalali `YYYY/MM/DD`. Gregorian dates make the CRM return an empty array. */
  fromDate?: string;
  toDate?: string;
}

export interface ReceptionQueryParams extends PaginationParams, DateRangeParams {}
export interface ReserveQueryParams extends PaginationParams, DateRangeParams {}
export interface TreatmentQueryParams extends PaginationParams, DateRangeParams {}

/**
 * How each endpoint actually behaves, established by probing the live API
 * rather than by reading its Swagger (which claims uniform paging everywhere):
 *
 *   endpoint                   paging      end-of-data signal
 *   ─────────────────────────  ──────────  ──────────────────────────────────
 *   Basic/GetServices          IGNORED     n/a — single shot
 *   Patient/GetAll             honoured    empty array
 *   Reserve/GetReserves        honoured    empty array
 *   Reception/GetReceptions    honoured    empty array ONLY
 *   Treatment/GetTreatments    IGNORED     n/a — walk by date window
 *
 * Two of these silently ignore pageNumber/pageSize and replay the same payload
 * forever: page 1 and page 500 of GetServices are byte-identical, as are pages
 * 1 and 2 of GetTreatments. The previous client treated them as pageable, which
 * turned both into unbounded loops (68.9M and 22.4M redundant upserts logged).
 *
 * Reception is the subtle one: it honours paging but returns FEWER rows than
 * pageSize while more pages remain (40 then 36 for pageSize=50), so
 * `rows.length < pageSize` is NOT an end-of-data signal — only an empty array is.
 */
export type PagingMode = "offset" | "ignored";

export const ENDPOINT_PAGING: Record<string, PagingMode> = {
  services: "ignored",
  patients: "offset",
  reserves: "offset",
  receptions: "offset",
  treatments: "ignored",
};

export class JordanApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly path?: string,
  ) {
    super(message);
    this.name = "JordanApiError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class JordanApiClient {
  private token: string | null = null;
  private authInFlight: Promise<string> | null = null;
  private readonly maxRetries: number;
  private readonly requestTimeoutMs: number;

  constructor(private readonly config: JordanApiConfig) {
    this.maxRetries = config.maxRetries ?? 4;
    this.requestTimeoutMs = config.requestTimeoutMs ?? 120_000;
  }

  private get baseUrl(): string {
    return this.config.baseUrl.replace(/\/+$/, "");
  }

  async authenticate(): Promise<string> {
    // Collapse concurrent re-auths so a burst of 401s triggers one login.
    if (this.authInFlight) return this.authInFlight;

    this.authInFlight = (async () => {
      const params = new URLSearchParams({
        username: this.config.username,
        password: this.config.password,
      });
      const url = `${this.baseUrl}/api/Auth/Apilogin?${params.toString()}`;

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": "0" },
        // IIS rejects a bodyless POST with 411 Length Required, so send an
        // explicit empty body rather than relying on the runtime to add one.
        body: "",
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new JordanApiError(
          `ورود به CRM ناموفق بود (${res.status}): ${body.slice(0, 200)}`,
          res.status,
          "/api/Auth/Apilogin",
        );
      }

      // The endpoint returns a bare JWT as text/plain, not JSON.
      const token = (await res.text()).trim();
      if (!token) throw new JordanApiError("CRM توکن خالی برگرداند");
      this.token = token;
      return token;
    })();

    try {
      return await this.authInFlight;
    } finally {
      this.authInFlight = null;
    }
  }

  private async headers(): Promise<Record<string, string>> {
    if (!this.token) await this.authenticate();
    return {
      Authorization: `Bearer ${this.token}`,
      company: this.config.company,
      Accept: "application/json",
    };
  }

  /** GET with bounded retry on transport/5xx faults and one re-auth on 401. */
  async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (signal?.aborted) throw new Error("سینک توسط کاربر لغو شد");

      const timeout = AbortSignal.timeout(this.requestTimeoutMs);
      const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;

      try {
        const res = await fetch(`${this.baseUrl}${path}`, {
          headers: await this.headers(),
          signal: composed,
        });

        if (res.status === 401) {
          this.token = null;
          await this.authenticate();
          continue;
        }

        // 5xx and 429 are transient; back off and retry.
        if (res.status >= 500 || res.status === 429) {
          lastError = new JordanApiError(`CRM ${path} خطای ${res.status}`, res.status, path);
          await this.backoff(attempt, signal);
          continue;
        }

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new JordanApiError(
            `CRM ${path} ناموفق (${res.status}): ${body.slice(0, 200)}`,
            res.status,
            path,
          );
        }

        // The CRM reports SQL Server failures as HTTP 200 with a plain-text
        // body, e.g. "Execution Timeout Expired." on deep/wide reception
        // queries. Parsing must therefore be explicit: a body that is not JSON
        // is a transient server fault to retry, never data and — critically —
        // never an empty result, which the sync would read as end-of-data and
        // silently truncate the entity.
        const text = await res.text();
        const trimmed = text.trim();

        if (!trimmed) {
          lastError = new JordanApiError(`CRM ${path} پاسخ خالی برگرداند`, res.status, path);
          await this.backoff(attempt, signal);
          continue;
        }

        if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) {
          lastError = new JordanApiError(
            `CRM ${path} خطای سرور در قالب متن ساده: ${trimmed.slice(0, 160)}`,
            res.status,
            path,
          );
          await this.backoff(attempt, signal);
          continue;
        }

        try {
          return JSON.parse(trimmed) as T;
        } catch {
          lastError = new JordanApiError(
            `CRM ${path} پاسخ نامعتبر JSON: ${trimmed.slice(0, 160)}`,
            res.status,
            path,
          );
          await this.backoff(attempt, signal);
          continue;
        }
      } catch (err) {
        if (signal?.aborted) throw new Error("سینک توسط کاربر لغو شد");
        // A non-retryable API error should surface immediately.
        if (err instanceof JordanApiError && err.status && err.status < 500 && err.status !== 429) {
          throw err;
        }
        lastError = err;
        await this.backoff(attempt, signal);
      }
    }

    throw new JordanApiError(
      `CRM ${path} پس از ${this.maxRetries + 1} تلاش ناموفق ماند: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
      undefined,
      path,
    );
  }

  private async backoff(attempt: number, signal?: AbortSignal): Promise<void> {
    // 500ms, 1s, 2s, 4s … with jitter to avoid lockstep retries.
    const base = Math.min(500 * 2 ** attempt, 8_000);
    await sleep(base + Math.floor(Math.random() * 250));
    if (signal?.aborted) throw new Error("سینک توسط کاربر لغو شد");
  }

  private qs(parts: Record<string, string | number | undefined>): string {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(parts)) {
      if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
    }
    const s = params.toString();
    return s ? `?${s}` : "";
  }

  // ─── Endpoints ───

  /**
   * Ignores pagination entirely — always returns the full catalogue (~218 rows).
   * Callers must fetch once; looping produced 68.9M redundant upserts previously.
   */
  getServices(signal?: AbortSignal) {
    return this.get<unknown[]>("/api/Basic/GetServices", signal);
  }

  getPatients(params: PaginationParams = {}, signal?: AbortSignal) {
    return this.get<unknown[]>(
      `/api/Patient/GetAll${this.qs({ pageNumber: params.page, pageSize: params.pageSize })}`,
      signal,
    );
  }

  getReserves(params: ReserveQueryParams = {}, signal?: AbortSignal) {
    return this.get<unknown[]>(
      `/api/Reserve/GetReserves${this.qs({
        fromdate: params.fromDate,
        todate: params.toDate,
        pageNumber: params.page,
        pageSize: params.pageSize,
      })}`,
      signal,
    );
  }

  getReceptions(params: ReceptionQueryParams = {}, signal?: AbortSignal) {
    return this.get<unknown[]>(
      `/api/Reception/GetReceptions${this.qs({
        fromdate: params.fromDate,
        todate: params.toDate,
        pageNumber: params.page,
        pageSize: params.pageSize,
      })}`,
      signal,
    );
  }

  /**
   * Requires a date range and ignores paging, so it must be walked window by
   * window. Passing no dates returns an empty array; passing a wide range
   * returns the whole range in one 3.7MB response regardless of pageSize.
   */
  getTreatments(params: TreatmentQueryParams = {}, signal?: AbortSignal) {
    return this.get<unknown[]>(
      `/api/Treatment/GetTreatments${this.qs({
        fromdate: params.fromDate,
        todate: params.toDate,
        pageNumber: params.page,
        pageSize: params.pageSize,
      })}`,
      signal,
    );
  }

  // ─── Lookup tables ───

  getGenderTypes(signal?: AbortSignal) {
    return this.get<unknown[]>("/api/Basic/GenderType", signal);
  }

  getMaritalTypes(signal?: AbortSignal) {
    return this.get<unknown[]>("/api/Basic/MaritalType", signal);
  }

  getIntroductionTypes(signal?: AbortSignal) {
    return this.get<unknown[]>("/api/Basic/IntroductionType", signal);
  }

  /** Convenience re-export so callers need not import from @jordan/shared. */
  static windows(from: string, to: string, days: number): JalaliWindow[] {
    return jalaliWindows(from, to, days);
  }
}
