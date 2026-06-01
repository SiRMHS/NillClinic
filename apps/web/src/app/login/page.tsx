"use client"

import { LoginForm } from "@/components/login-form"
import { Flame ,BrainCircuit } from "lucide-react"

export default function LoginPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-gradient-to-br from-yellow-50 via-white to-amber-50 dark:from-yellow-950 dark:via-background dark:to-amber-950 p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center gap-2 self-center font-medium">
          <div className="flex size-10 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-900">
            <BrainCircuit className="size-6 text-yellow-600 dark:text-yellow-400" />
          </div>
          <span className="text-xl font-bold">کلینیک جردن</span>
        </div>
        <LoginForm />
      </div>
    </div>
  )
}
