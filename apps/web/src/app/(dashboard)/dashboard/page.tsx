"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/stores/auth.store"

export default function Page() {
  const router = useRouter()
  const { user, hasPermission, isLoaded } = useAuth()

  useEffect(() => {
    if (!isLoaded || !user) return

    const routes: [string, string][] = [
      ["leads", "/leads"],
      ["patients", "/patients"],
      ["patients.view", "/patients"],
      ["analytics", "/analytics"],
      ["dashboard", "/dashboard"],
    ]

    for (const [perm, path] of routes) {
      if (hasPermission(perm)) {
        router.replace(path)
        return
      }
    }

    router.replace("/leads")
  }, [isLoaded, user, router, hasPermission])

  return null
}
