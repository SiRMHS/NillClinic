"use client"

import { useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import Link from "next/link"
import { ShieldAlertIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { sectionForPath, firstAllowedSection } from "@/lib/permissions"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { useAuth } from "@/stores/auth.store"
import { useDisplay } from "@/stores/display.store"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  // The session cookie is httpOnly, so the client cannot inspect it — the
  // presence of a resolved `user` from /api/auth/me is the authoritative signal.
  const { isLoaded, user, load, hasPermission } = useAuth()
  const displayLoaded = useDisplay((s) => s.isLoaded)
  const loadDisplay = useDisplay((s) => s.load)

  useEffect(() => {
    load()
  }, [load])

  // Only once the session is known: the masking depends on whether this user is
  // the superadmin, and asking before /api/auth/me answers would decide that on
  // a null user.
  useEffect(() => {
    if (user) void loadDisplay()
  }, [user, loadDisplay])

  useEffect(() => {
    if (isLoaded && !user) {
      router.push("/login")
    }
  }, [isLoaded, user, router])

  // Waiting on the display settings too, so a page never paints a figure that
  // the site is configured to hide and then takes it back a frame later.
  if (!isLoaded || !user || !displayLoaded) {
    return null
  }

  /**
   * Hiding a sidebar row is presentation, not access control — the page is
   * still one typed URL away. Every section therefore states the key it needs
   * and the layout refuses to render the page without it. The API enforces the
   * same keys independently; this only spares the user a screen full of failed
   * requests.
   */
  const section = sectionForPath(pathname)
  const allowed = !section || section.anyOf.some(hasPermission)
  const fallback = firstAllowedSection(hasPermission)

  return (
    <SidebarProvider
      defaultOpen={true}
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar side="right" />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6 @container/main overflow-y-auto">
          {allowed ? children : <AccessDenied fallbackUrl={fallback?.url} fallbackTitle={fallback?.title} />}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

function AccessDenied({
  fallbackUrl,
  fallbackTitle,
}: {
  fallbackUrl?: string
  fallbackTitle?: string
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-destructive/10">
        <ShieldAlertIcon className="size-7 text-destructive" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">دسترسی به این بخش را ندارید</h2>
        <p className="text-sm text-muted-foreground">
          برای دریافت دسترسی با مدیر سیستم تماس بگیرید.
        </p>
      </div>
      {fallbackUrl && (
        <Button render={<Link href={fallbackUrl} />} variant="outline">
          رفتن به {fallbackTitle}
        </Button>
      )}
    </div>
  )
}
