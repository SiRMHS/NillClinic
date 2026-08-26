import { useCallback, useEffect } from "react"
import { create } from "zustand"
import { buildDialUrl, DEFAULT_TELEPHONY_SETTINGS, type TelephonySettings } from "@jordan/shared"
import { apiFetch } from "@/lib/api-client"

interface TelephonyState {
  settings: TelephonySettings
  isLoaded: boolean
  /** Fetches once per session; later calls are no-ops. */
  load: () => void
  set: (settings: TelephonySettings) => void
}

/**
 * Dial settings, held in a store rather than fetched per page.
 *
 * Every lead row renders a call button, so the alternative was one request per
 * page that lists leads — and the answer is a handful of fields that only change
 * when someone edits them in settings. Failing to load falls back to a plain
 * `tel:` link, which is what the button did before the setting existed.
 */
export const useTelephony = create<TelephonyState>((setState, get) => ({
  settings: DEFAULT_TELEPHONY_SETTINGS,
  isLoaded: false,
  load: () => {
    if (get().isLoaded) return
    setState({ isLoaded: true })
    apiFetch<TelephonySettings>("/api/telephony")
      .then((settings) => setState({ settings }))
      .catch(() => {})
  },
  set: (settings) => setState({ settings, isLoaded: true }),
}))

/**
 * `(mobile) => href` for the dial buttons, loading the settings on first use.
 * Returns null when the lead has no usable number, so the caller can hide the
 * button instead of rendering a dead link.
 */
export function useDialLink(): (mobile: string | null | undefined) => string | null {
  const settings = useTelephony((s) => s.settings)
  const load = useTelephony((s) => s.load)
  useEffect(() => { load() }, [load])
  return useCallback((mobile) => buildDialUrl(mobile, settings), [settings])
}
