"use client"

import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Database, Copy, Check, Globe, Shield,
  Webhook, ArrowRightLeft,
} from "lucide-react"
import { formatDateTime } from "@/lib/date-utils"

interface WebhookLead {
  id: string
  source: string
  fullName: string | null
  mobile: string | null
  externalRef: string | null
  status: string
  createdAt: string
}

export default function ExternalMigrationPage() {
  const [leads, setLeads] = useState<WebhookLead[]>([])
  const [loading, setLoading] = useState(true)
  const [copiedWebhook, setCopiedWebhook] = useState(false)
  const [copiedCurl, setCopiedCurl] = useState(false)

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"
  const webhookUrl = `${apiUrl}/api/leads/webhook`
  const curlExample = `curl -X POST "${webhookUrl}" \\
  -H "Content-Type: application/json" \\
  -H "x-webhook-secret: WEBHOOK_SECRET" \\
  -d '{
    "source": "site",
    "name": "نام مخاطب",
    "phone": "09123456789",
    "external_id": "ref-123",
    "payload": {}
  }'`

  useEffect(() => {
    apiFetch<WebhookLead[]>("/api/leads?source=site&source=instagram&source=whatsapp")
      .then(setLeads)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const copyToClipboard = async (text: string, setter: (v: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(text)
      setter(true)
      setTimeout(() => setter(false), 2000)
    } catch {}
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">تنظیم ورودی خارجی</h1>
          <p className="text-sm text-muted-foreground mt-1">
            وب‌هوک ورودی برای دریافت مخاطب از سایت، اینستاگرام و واتساپ
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Webhook className="size-4 text-blue-600" />
              اندپوینت وب‌هوک
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <code className="text-xs md:text-sm font-mono break-all" dir="ltr">{webhookUrl}</code>
                <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={() => copyToClipboard(webhookUrl, setCopiedWebhook)}>
                  {copiedWebhook ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Shield className="size-4 text-amber-600" />
                احراز هویت
              </div>
              <div className="text-sm text-muted-foreground">
                هدر <code className="bg-muted px-1 rounded text-xs">x-webhook-secret</code> را با مقدار تنظیم شده در <code className="bg-muted px-1 rounded text-xs">LEAD_WEBHOOK_SECRET</code> ارسال کنید.
              </div>
              <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-800">
                برای تنظیم secret، متغیر محیطی LEAD_WEBHOOK_SECRET را در فایل .env مقداردهی کنید
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowRightLeft className="size-4 text-emerald-600" />
              نحوه استفاده
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm text-muted-foreground">
              از سایت، ربات اینستاگرام یا واتساپ خود یک درخواست <b>POST</b> به آدرس بالا بفرستید:
            </div>
            <div className="relative rounded-lg border bg-muted/30 p-3">
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 left-2 size-7"
                onClick={() => copyToClipboard(curlExample, setCopiedCurl)}
              >
                {copiedCurl ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
              </Button>
              <pre className="text-xs font-mono whitespace-pre-wrap overflow-x-auto" dir="ltr">{curlExample}</pre>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
