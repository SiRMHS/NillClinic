const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"

const CSRF_COOKIE = "jc_csrf"
const CSRF_HEADER = "X-CSRF-Token"
const CSRF_STORAGE_KEY = "jc_csrf"
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

/**
 * The session is an httpOnly cookie the browser attaches automatically, so it
 * is unreadable from JavaScript — an XSS bug can no longer walk off with the
 * token the way it could when this lived in localStorage. The trade-off is CSRF
 * exposure, answered by echoing the readable `jc_csrf` cookie back in a header
 * that a cross-site attacker cannot set.
 *
 * Reading the cookie is only the first source. When the API is served from a
 * different host than this page (a sibling subdomain, or a separate API
 * domain), the browser still sends the cookie while `document.cookie` cannot
 * read it — every POST would then fail the server's check with no way out. So
 * the token is also remembered from the login response and can be re-fetched
 * from `/api/auth/csrf`, which returns the very value the server compares
 * against.
 */
let csrfToken: string | null = null

function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null
  for (const part of document.cookie.split(";")) {
    const eq = part.indexOf("=")
    if (eq === -1) continue
    if (part.slice(0, eq).trim() !== CSRF_COOKIE) continue
    return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return null
}

/** Survives a page reload, so the fallback does not cost a request every time. */
function readStoredCsrfToken(): string | null {
  if (csrfToken) return csrfToken
  if (typeof window === "undefined") return null
  try {
    csrfToken = window.localStorage.getItem(CSRF_STORAGE_KEY)
  } catch {
    // storage disabled (private mode, blocked cookies) — the memory copy and
    // the /api/auth/csrf refresh still work
  }
  return csrfToken
}

export function storeCsrfToken(token: string | null): void {
  csrfToken = token
  if (typeof window === "undefined") return
  try {
    if (token) window.localStorage.setItem(CSRF_STORAGE_KEY, token)
    else window.localStorage.removeItem(CSRF_STORAGE_KEY)
  } catch {
    // see readStoredCsrfToken
  }
}

/** The cookie wins when readable: it is always current, the copy may be stale. */
function currentCsrfToken(): string | null {
  return readCsrfCookie() ?? readStoredCsrfToken()
}

/**
 * Asks the API for the token tied to this session. Concurrent callers share
 * one request so a page firing several mutations at once does not stampede.
 */
let csrfRefresh: Promise<string | null> | null = null
function refreshCsrfToken(): Promise<string | null> {
  csrfRefresh ??= fetch(`${API_BASE_URL}/api/auth/csrf`, { credentials: "include" })
    .then((res) => (res.ok ? (res.json() as Promise<{ csrfToken?: string }>) : null))
    .then((body) => {
      const token = typeof body?.csrfToken === "string" ? body.csrfToken : null
      // Only overwrite on success: a failed lookup (an expired session, the
      // API unreachable) must not throw away a copy that still works.
      if (token) storeCsrfToken(token)
      // Prefer the cookie the response may have just set; it is what the
      // server will compare against either way.
      return readCsrfCookie() ?? token
    })
    .catch(() => null)
    .finally(() => {
      csrfRefresh = null
    })
  return csrfRefresh
}

/** Distinguishes the CSRF rejection from a plain permission denial. */
async function isCsrfRejection(response: Response): Promise<boolean> {
  try {
    const body = (await response.clone().json()) as { error?: string }
    return typeof body?.error === "string" && body.error.includes("CSRF")
  } catch {
    return false
  }
}

/** A body we can hand to `fetch` a second time when a request has to be retried. */
function isReplayableBody(body: BodyInit | null | undefined): boolean {
  return body == null || typeof body === "string"
}

/**
 * Carries the response status and body alongside the message, so callers can
 * react to structured details (a lockout countdown, per-field validation) that
 * a bare Error would throw away.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = "ApiError"
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json")

  const method = (options.method ?? "GET").toUpperCase()
  const needsCsrf = !SAFE_METHODS.has(method)
  if (needsCsrf) {
    // Nothing to echo — ask the API rather than sending a request we know the
    // double-submit check will reject. Login is the exception: there is no
    // session yet, so the lookup could only ever come back empty.
    const csrf =
      currentCsrfToken() ?? (path.startsWith("/api/auth/login") ? null : await refreshCsrfToken())
    if (csrf) headers.set(CSRF_HEADER, csrf)
  }

  let response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    // Required for the session cookie to travel cross-origin (web on :3000,
    // API on :4000).
    credentials: "include",
  })

  // A stale token — one left over from an earlier session, or a cookie the
  // server rotated behind our back — is recoverable: fetch the current value
  // and replay the request once. Only once, so a server that keeps rejecting
  // cannot put us in a loop.
  if (
    response.status === 403 &&
    needsCsrf &&
    isReplayableBody(options.body) &&
    (await isCsrfRejection(response))
  ) {
    const fresh = await refreshCsrfToken()
    if (fresh && fresh !== headers.get(CSRF_HEADER)) {
      headers.set(CSRF_HEADER, fresh)
      response = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers,
        credentials: "include",
      })
    }
  }

  if (response.status === 401) {
    // An expired or revoked session must not leave the user staring at a page
    // that silently stops updating. Bounce to login, say why, and remember
    // where they were so they land back there after signing in.
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      localStorage.removeItem("user")
      // The token belonged to the session that just ended; keeping it would
      // only feed a stale header into the next one.
      storeCsrfToken(null)

      // Only claim a session ended if one actually did. Someone who was never
      // signed in gets no notice — telling them their session expired would be
      // a lie and makes real expiry warnings meaningless.
      let reason: string | null = "expired"
      try {
        const body = (await response.clone().json()) as { error?: string }
        const message = typeof body?.error === "string" ? body.error : ""
        if (message.includes("باطل")) reason = "revoked"
        else if (message.includes("یافت نشد")) reason = null
      } catch {
        // no JSON body; keep the default
      }

      const next = window.location.pathname + window.location.search
      const params = new URLSearchParams()
      if (reason) params.set("reason", reason)
      if (next && next !== "/") params.set("next", next)
      const query = params.toString()
      window.location.href = query ? `/login?${query}` : "/login"
    }
    throw new ApiError("نشست منقضی شده است. لطفاً مجدداً وارد شوید", 401)
  }

  if (!response.ok) {
    let errorMessage = `خطا در برقراری ارتباط با سرور: ${response.status}`
    let body: Record<string, unknown> = {}
    try {
      body = (await response.json()) as Record<string, unknown>
      if (typeof body?.error === "string") errorMessage = body.error
    } catch {
      // response had no JSON body; keep the status-based message
    }
    throw new ApiError(errorMessage, response.status, body)
  }

  if (response.status === 204) return undefined as T

  return response.json() as Promise<T>
}

/**
 * Fetch a file endpoint and hand it to the browser as a download.
 *
 * `apiFetch` cannot be reused: it parses every response as JSON, and these
 * endpoints return CSV. The response also has to travel through `fetch` rather
 * than a plain `<a href>` — the session lives in an httpOnly cookie that a
 * cross-origin link navigation would not attach, and the server would answer
 * 401 with a login redirect the user sees as a broken button.
 *
 * The filename comes from `Content-Disposition`. The API sends both an ASCII
 * `filename` and an RFC 5987 `filename*` carrying the real Persian name; the
 * encoded form is preferred when present.
 */
export async function apiDownload(path: string, fallbackName = "export.csv"): Promise<void> {
  const response = await fetch(`${API_BASE_URL}${path}`, { credentials: "include" })

  if (!response.ok) {
    let message = `خطا در دریافت خروجی: ${response.status}`
    try {
      const body = (await response.json()) as { error?: string }
      if (typeof body?.error === "string") message = body.error
    } catch {
      // Not JSON — keep the status-based message.
    }
    throw new ApiError(message, response.status)
  }

  const disposition = response.headers.get("Content-Disposition") ?? ""
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
  const plain = /filename="([^"]+)"/i.exec(disposition)
  let filename = fallbackName
  if (encoded?.[1]) {
    try {
      filename = decodeURIComponent(encoded[1])
    } catch {
      filename = plain?.[1] ?? fallbackName
    }
  } else if (plain?.[1]) {
    filename = plain[1]
  }

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoking immediately can cancel the download in some browsers; one tick is
  // enough for the click to have been handed off.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
