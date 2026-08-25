"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AlertCircle, Eye, EyeOff, Loader2, Lock, ShieldCheck } from "lucide-react"
import { useAuth } from "@/stores/auth.store"
import { ApiError } from "@/lib/api-client"
import { toPersianNum } from "@/lib/format"
import { firstAllowedSection } from "@/lib/permissions"

/** Why the user was sent here, set by the API client on a 401. */
const REASON_MESSAGES: Record<string, string> = {
  expired: "نشست شما منقضی شده بود. دوباره وارد شوید.",
  revoked: "نشست شما باطل شده بود. دوباره وارد شوید.",
}

export function LoginForm({ className, ...props }: React.ComponentProps<"div">) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const login = useAuth((s) => s.login)
  const hasPermission = useAuth((s) => s.hasPermission)
  const user = useAuth((s) => s.user)
  const isLoaded = useAuth((s) => s.isLoaded)
  const loadSession = useAuth((s) => s.load)

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [locked, setLocked] = useState(false)
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null)
  const [capsLock, setCapsLock] = useState(false)

  /**
   * Not every role can open /dashboard any more, so landing there blindly shows
   * a permission wall to a user who just signed in successfully. Sending them
   * to the first section they can actually open is the difference between "you
   * are not allowed here" and a working app.
   */
  const landingUrl = () => firstAllowedSection(hasPermission)?.url ?? "/dashboard"
  const destination = () => (next && next.startsWith("/") ? next : landingUrl())

  const reason = searchParams.get("reason")
  const next = searchParams.get("next")
  const notice = reason ? REASON_MESSAGES[reason] : null

  // Check the cookie once on arrival: someone with a still-valid session should
  // not be looking at a login form.
  useEffect(() => {
    loadSession()
  }, [loadSession])

  useEffect(() => {
    if (isLoaded && user) {
      router.replace(destination())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, user, next, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password || loading) return
    setLoading(true)
    setError("")
    setAttemptsRemaining(null)

    try {
      await login(email, password)
      router.replace(destination())
    } catch (err) {
      const message = err instanceof Error ? err.message : "خطا در ورود"
      setError(message)
      setLocked(err instanceof ApiError && err.status === 429)
      const remaining = err instanceof ApiError ? err.body.attemptsRemaining : undefined
      setAttemptsRemaining(typeof remaining === "number" ? remaining : null)
      setPassword("")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={cn("w-full", className)} dir="rtl" {...props}>
      <div className="mx-auto flex w-full max-w-[26rem] flex-col items-center">
        <div className="mb-7 flex size-14 items-center justify-center rounded-2xl bg-primary/10">
          <ShieldCheck className="size-7 text-primary" />
        </div>

        <h1 className="text-center text-[2rem] font-extrabold leading-tight tracking-tight">
          خوش آمدید
        </h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          برای ورود به داشبورد کلینیک جردن وارد شوید
        </p>

        {notice ? (
          <div
            role="status"
            className="mt-6 w-full rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300"
          >
            {notice}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} noValidate className="mt-8 w-full space-y-4">
          {/* Placeholder-as-label, matching the reference layout — the fields are
              self-evident and a visible label above each would add noise. */}
          <Input
            id="email"
            type="email"
            name="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            dir="ltr"
            aria-label="ایمیل"
            placeholder="ایمیل"
            className="h-14 rounded-xl px-4 text-left text-base placeholder:text-left placeholder:text-muted-foreground"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            required
            aria-invalid={Boolean(error)}
          />

          {/*
            Physical `right`/`pr`, not logical `end`/`pe`.

            The field is dir="ltr" (it holds a Latin password) while this wrapper
            inherits the page's RTL, so logical properties resolved to opposite
            sides: the input reserved padding on the right while the button was
            placed on the left, landing the icon on top of the placeholder.
            Pinning both to the right keeps the gap and the icon together.
          */}
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              dir="ltr"
              aria-label="رمز عبور"
              placeholder="رمز عبور"
              className="h-14 rounded-xl px-4 pr-12 text-left text-base placeholder:text-left placeholder:text-muted-foreground"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyUp={(e) => setCapsLock(e.getModifierState?.("CapsLock") ?? false)}
              onKeyDown={(e) => setCapsLock(e.getModifierState?.("CapsLock") ?? false)}
              disabled={loading}
              required
              aria-invalid={Boolean(error)}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
              aria-label={showPassword ? "پنهان کردن رمز" : "نمایش رمز"}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
            </button>
          </div>

          {capsLock ? (
            <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <AlertCircle className="size-3.5" />
              کلید Caps Lock روشن است
            </p>
          ) : null}

          {error ? (
            <div
              role="alert"
              aria-live="polite"
              className={cn(
                "flex items-start gap-2 rounded-xl border px-4 py-3 text-sm",
                locked
                  ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300"
                  : "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300",
              )}
            >
              {locked ? (
                <Lock className="mt-0.5 size-4 shrink-0" />
              ) : (
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
              )}
              <div>
                <div>{error}</div>
                {attemptsRemaining !== null && attemptsRemaining > 0 ? (
                  <div className="mt-0.5 text-xs opacity-80">
                    {toPersianNum(attemptsRemaining)} تلاش دیگر تا قفل شدن حساب
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="flex justify-center pt-2">
            <Button
              type="submit"
              className="h-12 min-w-[10rem] rounded-full px-10 text-base"
              disabled={loading || !email || !password}
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  در حال ورود…
                </>
              ) : (
                "ورود"
              )}
            </Button>
          </div>
        </form>

        <p className="mt-8 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" />
          نشست شما رمزنگاری‌شده است و هر ورود ثبت می‌شود
        </p>
      </div>
    </div>
  )
}
