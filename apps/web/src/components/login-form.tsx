"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Eye, EyeOff, Loader2 } from "lucide-react"
import { useAuth } from "@/stores/auth.store"

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const router = useRouter()
  const login = useAuth((s) => s.login)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) return
    setLoading(true)
    setError("")
    try {
      await login(email, password)
      router.push("/dashboard")
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در ورود")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} dir="rtl" {...props}>
      <Card className="shadow-xl border-0">
        <CardHeader className="text-center space-y-3 pb-4">
          <CardTitle className="text-2xl font-bold">داشبورد مدیریتی</CardTitle>
          <CardDescription className="text-base">
            برای ادامه لطفاً وارد شوید
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup className="space-y-5">
              {error && (
                <div className="rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-300 text-center">
                  {error}
                </div>
              )}
              <Field>
                <FieldLabel htmlFor="email" className="text-sm font-medium">
                  ایمیل
                </FieldLabel>
                <Input
                  id="email"
                  type="email"
                  dir="ltr"
                  placeholder="admin@jordanclinic.ir"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12 text-base mt-1"
                  required
                  autoComplete="email"
                />
              </Field>
              <Field>
                <div className="flex items-center justify-between">
                  <FieldLabel htmlFor="password" className="text-sm font-medium">
                    رمز عبور
                  </FieldLabel>
                </div>
                <div className="relative mt-1">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    dir="ltr"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-12 text-base ps-10"
                    required
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                  </button>
                </div>
              </Field>
              <Field>
                <Button type="submit" disabled={loading} className="w-full h-12 text-base font-medium">
                  {loading ? <Loader2 className="size-5 animate-spin" /> : "ورود به داشبورد"}
                </Button>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
      <p className="text-xs text-center text-muted-foreground">
        کلینیک جردن — سامانه مدیریت هوشمند
      </p>
    </div>
  )
}
