const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"

const CSRF_COOKIE = "jc_csrf"
const CSRF_HEADER = "X-CSRF-Token"
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

/**
 * The session is an httpOnly cookie the browser attaches automatically, so it
 * is unreadable from JavaScript — an XSS bug can no longer walk off with the
 * token the way it could when this lived in localStorage. The trade-off is CSRF
 * exposure, answered by echoing the readable `jc_csrf` cookie back in a header
 * that a cross-site attacker cannot set.
 */
function readCsrfToken(): string | null {
  if (typeof document === "undefined") return null
  for (const part of document.cookie.split(";")) {
    const eq = part.indexOf("=")
    if (eq === -1) continue
    if (part.slice(0, eq).trim() !== CSRF_COOKIE) continue
    return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return null
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
  if (!SAFE_METHODS.has(method)) {
    const csrf = readCsrfToken()
    if (csrf) headers.set(CSRF_HEADER, csrf)
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    // Required for the session cookie to travel cross-origin (web on :3000,
    // API on :4000).
    credentials: "include",
  })

  if (response.status === 401) {
    // An expired or revoked session must not leave the user staring at a page
    // that silently stops updating. Bounce to login, say why, and remember
    // where they were so they land back there after signing in.
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      localStorage.removeItem("user")

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
