"use client"

import { Suspense } from "react"
import { LoginForm } from "@/components/login-form"

export default function LoginPage() {
  return (
    <div
      className="flex min-h-svh flex-col items-center justify-center bg-background p-6 md:p-10"
      dir="rtl"
    >
      {/* LoginForm reads search params (`reason`, `next`), which opts the tree
          into a client-side bailout and therefore needs a Suspense boundary. */}
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  )
}
