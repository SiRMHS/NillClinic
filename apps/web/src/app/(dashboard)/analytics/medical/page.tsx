"use client"

import { useEffect, useState, useMemo, startTransition } from "react"
import { apiFetch } from "@/lib/api-client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Search, Stethoscope, Pill, TrendingUp, ArrowLeftRight,
  Zap, Activity,
} from "lucide-react"
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale,
  LinearScale, BarElement, PointElement, LineElement, Filler,
} from "chart.js"
import type { ChartOptions } from "chart.js"
import { Bar } from "react-chartjs-2"

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Filler)

interface DiagnosiDetail {
  diagnosis: string
  total: number
  treatments: { name: string; count: number }[]
}

interface TreatmentDetail {
  treatment: string
  total: number
  diagnoses: { diagnosis: string; count: number }[]
}

interface MedicalMatrix {
  diagnoses: string[]
  treatments: string[]
  matrix: number[][]
  diagnosisTotals: number[]
  treatmentTotals: number[]
  diagnosisDetails: DiagnosiDetail[]
  treatmentDetails: TreatmentDetail[]
}

function toPersianNum(num: number | string) {
  return num.toString().replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[parseInt(d, 10)]!)
}

export default function MedicalAnalyticsPage() {
  const [data, setData] = useState<MedicalMatrix | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedDiagnosis, setSelectedDiagnosis] = useState<string | null>(null)
  const [selectedTreatment, setSelectedTreatment] = useState<string | null>(null)
  const [diagSearch, setDiagSearch] = useState("")
  const [treatSearch, setTreatSearch] = useState("")
  const [showDiagDropdown, setShowDiagDropdown] = useState(false)
  const [showTreatDropdown, setShowTreatDropdown] = useState(false)

  useEffect(() => {
    startTransition(async () => {
      try {
        const res = await apiFetch<MedicalMatrix>("/api/analytics/medical-matrix")
        startTransition(() => {
          setData(res)
          if (res.diagnosisDetails.length > 0) setSelectedDiagnosis(res.diagnosisDetails[0].diagnosis)
          if (res.treatmentDetails.length > 0) setSelectedTreatment(res.treatmentDetails[0].treatment)
        })
      } catch {
        // silent
      } finally {
        setLoading(false)
      }
    })
  }, [])

  useEffect(() => {
    if (!loading && data && data.diagnosisDetails.length > 0 && !selectedDiagnosis) {
      const defaultDiag = data.diagnosisDetails.find((d) => d.diagnosis.includes("ریزش مو")) ?? data.diagnosisDetails[0]
      startTransition(() => setSelectedDiagnosis(defaultDiag.diagnosis))
    }
  }, [loading, data, selectedDiagnosis])

  useEffect(() => {
    if (!loading && data && data.treatmentDetails.length > 0 && !selectedTreatment) {
      startTransition(() => setSelectedTreatment(data.treatmentDetails[0].treatment))
    }
  }, [loading, data, selectedTreatment])

  const selectedDiagDetail = useMemo(() => {
    if (!data || !selectedDiagnosis) return null
    return data.diagnosisDetails.find((d) => d.diagnosis === selectedDiagnosis) ?? null
  }, [data, selectedDiagnosis])

  const selectedTreatDetail = useMemo(() => {
    if (!data || !selectedTreatment) return null
    return data.treatmentDetails.find((t) => t.treatment === selectedTreatment) ?? null
  }, [data, selectedTreatment])

  const filteredDiagnoses = useMemo(() => {
    if (!data) return []
    const q = diagSearch.toLowerCase()
    return data.diagnosisDetails.filter((d) => d.diagnosis.toLowerCase().includes(q))
  }, [data, diagSearch])

  const filteredTreatments = useMemo(() => {
    if (!data) return []
    const q = treatSearch.toLowerCase()
    return data.treatmentDetails.filter((t) => t.treatment.toLowerCase().includes(q))
  }, [data, treatSearch])

  const diagBarData = selectedDiagDetail ? {
    labels: selectedDiagDetail.treatments.map((t) => t.name).reverse(),
    datasets: [{
      label: "تعداد تجویز",
      data: selectedDiagDetail.treatments.map((t) => t.count).reverse(),
      backgroundColor: "#2563eb",
      borderRadius: 4,
    }],
  } : null

  const treatBarData = selectedTreatDetail ? {
    labels: selectedTreatDetail.diagnoses.map((d) => d.diagnosis).reverse(),
    datasets: [{
      label: "تعداد",
      data: selectedTreatDetail.diagnoses.map((d) => d.count).reverse(),
      backgroundColor: "#8b5cf6",
      borderRadius: 4,
    }],
  } : null

  const fontCfg = { font: { family: "system-ui, sans-serif", size: 10 } }
  const barOpts: ChartOptions<"bar"> = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: "y",
    plugins: {
      legend: { display: false },
      tooltip: { bodyFont: { family: fontCfg.font.family, size: fontCfg.font.size } as unknown as ChartOptions<"bar">["plugins"]["tooltip"]["bodyFont"], titleFont: { family: fontCfg.font.family, size: fontCfg.font.size } as unknown as ChartOptions<"bar">["plugins"]["tooltip"]["titleFont"] },
    },
    scales: {
      x: { ticks: fontCfg, beginAtZero: true },
      y: { ticks: { ...fontCfg.font, maxTicksLimit: 15 } },
    },
  }

  const topCorrelations = useMemo(() => {
    if (!data) return []
    const items: { diagnosis: string; treatment: string; count: number }[] = []
    for (let i = 0; i < data.diagnoses.length; i++) {
      for (let j = 0; j < data.treatments.length; j++) {
        if (data.matrix[i][j] > 0) {
          items.push({ diagnosis: data.diagnoses[i], treatment: data.treatments[j], count: data.matrix[i][j] })
        }
      }
    }
    return items.sort((a, b) => b.count - a.count).slice(0, 20)
  }, [data])

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-6 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          {[1, 2].map((i) => <Skeleton key={i} className="h-80" />)}
        </div>
      </div>
    )
  }

  if (!data || data.diagnoses.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20 text-muted-foreground">
        <Activity className="size-12 opacity-30" />
        <p>داده‌ای برای تحلیل موجود نیست</p>
        <p className="text-sm">ابتدا داده‌های درمان را از سینک CRM دریافت کنید</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">تحلیل‌های پزشکی</h1>
        <p className="text-sm text-muted-foreground mt-1">
          بررسی ارتباط بین تشخیص‌ها و آیتم‌های درمانی
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full bg-blue-100 dark:bg-blue-950 p-2.5">
              <Stethoscope className="size-5 text-blue-600" />
            </div>
            <div>
              <div className="text-2xl font-bold">{toPersianNum(data.diagnoses.length)}</div>
              <div className="text-xs text-muted-foreground">تشخیص منحصربه‌فرد</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full bg-violet-100 dark:bg-violet-950 p-2.5">
              <Pill className="size-5 text-violet-600" />
            </div>
            <div>
              <div className="text-2xl font-bold">{toPersianNum(data.treatments.length)}</div>
              <div className="text-xs text-muted-foreground">آیتم درمانی</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full bg-emerald-100 dark:bg-emerald-950 p-2.5">
              <ArrowLeftRight className="size-5 text-emerald-600" />
            </div>
            <div>
              <div className="text-2xl font-bold">{toPersianNum(topCorrelations.length)}+</div>
              <div className="text-xs text-muted-foreground">ارتباط تشخیص-درمان</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full bg-amber-100 dark:bg-amber-950 p-2.5">
              <Zap className="size-5 text-amber-600" />
            </div>
            <div>
              <div className="text-2xl font-bold">{toPersianNum(topCorrelations[0]?.count ?? 0)}</div>
              <div className="text-xs text-muted-foreground">بیشترین تکرار</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top Correlations Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="size-4 text-emerald-600" />
            پرتکرارترین ارتباط‌های تشخیص-درمان
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>تشخیص</TableHead>
                <TableHead>آیتم درمانی</TableHead>
                <TableHead>تعداد</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topCorrelations.map((item, i) => (
                <TableRow key={`${item.diagnosis}-${item.treatment}`}>
                  <TableCell className="text-muted-foreground">{toPersianNum(i + 1)}</TableCell>
                  <TableCell className="font-medium">{item.diagnosis}</TableCell>
                  <TableCell>{item.treatment}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{toPersianNum(item.count)}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Diagnosis → Treatment */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Stethoscope className="size-4 text-blue-600" />
            بررسی تشخیص → آیتم درمانی
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-4">
            یک تشخیص را انتخاب کنید تا ببینید چه آیتم‌های درمانی برای آن تجویز شده است
          </p>

          {/* Diagnosis search combobox */}
          <div className="relative mb-4">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="جستجوی تشخیص..."
                value={showDiagDropdown ? diagSearch : (selectedDiagnosis ?? diagSearch)}
                onChange={(e) => { setDiagSearch(e.target.value); setShowDiagDropdown(true) }}
                onFocus={() => { setDiagSearch(""); setShowDiagDropdown(true) }}
                className="pr-9"
              />
            </div>
            {showDiagDropdown && filteredDiagnoses.length > 0 && (
              <div className="absolute z-10 mt-1 w-full max-h-60 overflow-auto rounded-lg border bg-background shadow-lg">
                {filteredDiagnoses.map((d) => (
                  <button
                    key={d.diagnosis}
                    className={`w-full text-right px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center justify-between ${d.diagnosis === selectedDiagnosis ? "bg-muted font-medium" : ""}`}
                    onClick={() => { setSelectedDiagnosis(d.diagnosis); setShowDiagDropdown(false); setDiagSearch("") }}
                  >
                    <span className="truncate">{d.diagnosis}</span>
                    <Badge variant="outline" className="shrink-0 text-[10px]">{toPersianNum(d.total)}</Badge>
                  </button>
                ))}
              </div>
            )}
            {showDiagDropdown && filteredDiagnoses.length === 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-lg border bg-background shadow-lg p-3 text-center text-sm text-muted-foreground">
                تشخیصی یافت نشد
              </div>
            )}
            {/* Click outside to close */}
            {showDiagDropdown && (
              <div className="fixed inset-0 z-0" onClick={() => setShowDiagDropdown(false)} />
            )}
          </div>

          {selectedDiagDetail ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-semibold text-lg">{selectedDiagDetail.diagnosis}</span>
                  <Badge variant="secondary" className="mr-2">
                    {toPersianNum(selectedDiagDetail.total)} تجویز
                  </Badge>
                </div>
              </div>
              {selectedDiagDetail.treatments.length > 0 ? (
                <div className="h-72">
                  <Bar data={diagBarData!} options={barOpts} />
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">برای این تشخیص آیتم درمانی ثبت نشده</p>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">یک تشخیص را از بالا انتخاب کنید</p>
          )}
        </CardContent>
      </Card>

      {/* Treatment → Diagnosis */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Pill className="size-4 text-violet-600" />
            بررسی آیتم درمانی → تشخیص
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-4">
            یک آیتم درمانی را انتخاب کنید تا ببینید بیشتر برای کدام تشخیص‌ها استفاده شده است
          </p>

          {/* Treatment search combobox */}
          <div className="relative mb-4">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="جستجوی آیتم درمانی..."
                value={showTreatDropdown ? treatSearch : (selectedTreatment ?? treatSearch)}
                onChange={(e) => { setTreatSearch(e.target.value); setShowTreatDropdown(true) }}
                onFocus={() => { setTreatSearch(""); setShowTreatDropdown(true) }}
                className="pr-9"
              />
            </div>
            {showTreatDropdown && filteredTreatments.length > 0 && (
              <div className="absolute z-10 mt-1 w-full max-h-60 overflow-auto rounded-lg border bg-background shadow-lg">
                {filteredTreatments.map((t) => (
                  <button
                    key={t.treatment}
                    className={`w-full text-right px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center justify-between ${t.treatment === selectedTreatment ? "bg-muted font-medium" : ""}`}
                    onClick={() => { setSelectedTreatment(t.treatment); setShowTreatDropdown(false); setTreatSearch("") }}
                  >
                    <span className="truncate">{t.treatment}</span>
                    <Badge variant="outline" className="shrink-0 text-[10px]">{toPersianNum(t.total)}</Badge>
                  </button>
                ))}
              </div>
            )}
            {showTreatDropdown && filteredTreatments.length === 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-lg border bg-background shadow-lg p-3 text-center text-sm text-muted-foreground">
                آیتمی یافت نشد
              </div>
            )}
            {showTreatDropdown && (
              <div className="fixed inset-0 z-0" onClick={() => setShowTreatDropdown(false)} />
            )}
          </div>

          {selectedTreatDetail ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-semibold text-lg">{selectedTreatDetail.treatment}</span>
                  <Badge variant="secondary" className="mr-2">
                    {toPersianNum(selectedTreatDetail.total)} تشخیص
                  </Badge>
                </div>
              </div>
              {selectedTreatDetail.diagnoses.length > 0 ? (
                <div className="h-72">
                  <Bar data={treatBarData!} options={barOpts} />
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">برای این آیتم تشخیصی ثبت نشده</p>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">یک آیتم درمانی را از بالا انتخاب کنید</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
