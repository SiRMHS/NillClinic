import { create } from "zustand"
import {
  DEFAULT_DISPLAY_SETTINGS,
  amountsHidden,
  crmRatesHidden,
  type DisplaySettings,
} from "@jordan/shared"
import { apiFetch } from "@/lib/api-client"
import { setAmountsHidden } from "@/lib/format"

interface DisplayState {
  settings: DisplaySettings
  isLoaded: boolean
  /** Fetched once per session, before the dashboard paints anything. */
  load: () => Promise<void>
  set: (settings: DisplaySettings) => void
}

/**
 * Whether this session is allowed to see figures.
 *
 * Loaded once at the dashboard shell rather than per page, and awaited before
 * the first render: a page that paints amounts and then blanks them a moment
 * later has already shown them. The API strips the values as well, so this is
 * about presentation — a section that legitimately still receives money (the
 * CRM-scoped switches leave the dashboard alone) is masked here.
 */
export const useDisplay = create<DisplayState>((setState, get) => ({
  settings: DEFAULT_DISPLAY_SETTINGS,
  isLoaded: false,

  load: async () => {
    if (get().isLoaded) return
    try {
      const settings = await apiFetch<DisplaySettings>("/api/display")
      get().set(settings)
    } catch {
      // Unreachable settings must not blank a dashboard that was working;
      // showing figures is the behaviour that predates this switch.
      setState({ isLoaded: true })
    }
  },

  set: (settings) => {
    setState({ settings, isLoaded: true })
    // The plain `formatRial` helpers are called from dozens of components that
    // have no reason to subscribe to a store. Pushing the flag into the
    // formatter masks every one of them from a single place.
    //
    // No account is exempt, the superadmin included — see the note on
    // `amountsHidden`. The escape hatch is the switch itself.
    setAmountsHidden(amountsHidden(settings))
  },
}))

/** Whether CRM figures are hidden for this viewer — money and rates separately. */
export function useCrmMasking(): { amounts: boolean; rates: boolean } {
  const settings = useDisplay((s) => s.settings)
  return {
    amounts: amountsHidden(settings, { scope: "crm" }),
    rates: crmRatesHidden(settings),
  }
}
