"use client"

import { useEffect, useState, useCallback, useRef, useMemo, startTransition } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { apiFetch } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  SearchIcon,
  FileDownIcon,
  Loader2Icon,
  Syringe,
  CalendarClock,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  X,
  Filter,
  SlidersHorizontal,
} from "lucide-react"
import { formatDate, formatDateTime } from "@/lib/date-utils"
import { cn } from "@/lib/utils"

interface Patient {
  id: string
  externalCode: number
  fullName: string
  mobile: string | null
  gender: number | null
  birthDate: string | null
  job: string | null
  syncedAt: string
  hasTreatments: boolean
  hasReserves: boolean
}

interface PaginatedResponse {
  data: Patient[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

type SortField = "externalCode" | "fullName" | "mobile" | "gender" | "job" | "birthDate" | "syncedAt"
type SortDir = "asc" | "desc" | null

function fuzzyMatch(text: string, query: string): boolean {
  const q = query.toLowerCase().replace(/\s+/g, "")
  const t = text.toLowerCase().replace(/\s+/g, "")
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null

export default function PatientsPage() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const page = Number(searchParams.get("page")) || 1
  const search = searchParams.get("search") || ""

  const [patients, setPatients] = useState<Patient[]>([])
  const [pagination, setPagination] = useState({ page, pageSize: 20, total: 0, totalPages: 0 })
  const [loading, setLoading] = useState(true)
  const [searchInput, setSearchInput] = useState(search)
  const [sortField, setSortField] = useState<SortField | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)
  const [genderFilter, setGenderFilter] = useState<number | "ALL">("ALL")
  const [jobFilter, setJobFilter] = useState<string | "ALL">("ALL")
  const [showFilters, setShowFilters] = useState(false)
  const searchRef = useRef(search)

  const fetchPatients = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set("page", String(page))
      params.set("pageSize", "20")
      if (search) params.set("search", search)

      const res = await apiFetch<PaginatedResponse>(`/api/patients?${params}`)
      setPatients(res.data)
      setPagination(res.pagination)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [page, search])

  useEffect(() => {
    startTransition(() => { fetchPatients() })
  }, [fetchPatients])

  useEffect(() => {
    startTransition(() => { setSearchInput(search) })
    searchRef.current = search
  }, [search])

  function setParam(key: string, value: string) {
    const p = new URLSearchParams(searchParams.toString())
    if (value) p.set(key, value)
    else p.delete(key)
    if (key !== "page") p.delete("page")
    const qs = p.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  function debouncedSearch(value: string) {
    setSearchInput(value)
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      if (value !== searchRef.current) {
        setParam("search", value)
      }
    }, 300)
  }

  function clearSearch() {
    setSearchInput("")
    if (debounceTimer) clearTimeout(debounceTimer)
    setParam("search", "")
  }

  function goToPage(p: number) {
    setParam("page", String(p))
  }

  function toggleSort(field: SortField) {
    if (sortField === field) {
      if (sortDir === "asc") { setSortDir("desc"); return }
      if (sortDir === "desc") { setSortField(null); setSortDir(null); return }
    }
    setSortField(field)
    setSortDir("asc")
  }

  const processedPatients = useMemo(() => {
    let filtered = [...patients]

    if (genderFilter !== "ALL") {
      filtered = filtered.filter((p) => p.gender === genderFilter)
    }
    if (jobFilter !== "ALL") {
      filtered = filtered.filter((p) => p.job === jobFilter)
    }

    filtered = filtered.filter((p) => {
      if (!search) return true
      const q = search.toLowerCase()
      return (
        fuzzyMatch(p.fullName, q) ||
        (p.mobile && fuzzyMatch(p.mobile, q)) ||
        String(p.externalCode).includes(q)
      )
    })

    if (sortField && sortDir) {
      filtered.sort((a, b) => {
        let aVal: string | number = ""
        let bVal: string | number = ""
        switch (sortField) {
          case "externalCode": aVal = a.externalCode; bVal = b.externalCode; break
          case "fullName": aVal = a.fullName; bVal = b.fullName; break
          case "mobile": aVal = a.mobile ?? ""; bVal = b.mobile ?? ""; break
          case "gender": aVal = a.gender ?? 0; bVal = b.gender ?? 0; break
          case "job": aVal = a.job ?? ""; bVal = b.job ?? ""; break
          case "birthDate": aVal = a.birthDate ?? ""; bVal = b.birthDate ?? ""; break
          case "syncedAt": aVal = a.syncedAt; bVal = b.syncedAt; break
        }
        if (typeof aVal === "number" && typeof bVal === "number") {
          return sortDir === "asc" ? aVal - bVal : bVal - aVal
        }
        return sortDir === "asc"
          ? String(aVal).localeCompare(String(bVal))
          : String(bVal).localeCompare(String(aVal))
      })
    }

    return filtered
  }, [patients, search, sortField, sortDir, genderFilter, jobFilter])

  const uniqueJobs = useMemo(() => {
    const jobs = new Set(patients.map((p) => p.job).filter(Boolean) as string[])
    return Array.from(jobs).sort()
  }, [patients])

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ArrowUpDown className="size-3 opacity-30" />
    if (sortDir === "asc") return <ArrowUp className="size-3 text-primary" />
    if (sortDir === "desc") return <ArrowDown className="size-3 text-primary" />
    return <ArrowUpDown className="size-3 opacity-30" />
  }

  async function exportCsv() {
    try {
      const all: Patient[] = []
      const totalPages = pagination.totalPages
      for (let i = 1; i <= totalPages; i++) {
        const res = await apiFetch<PaginatedResponse>(`/api/patients?page=${i}&pageSize=100`)
        all.push(...res.data)
      }
      const header = "کد,نام,موبایل,جنسیت,شغل,تاریخ تولد,آخرین سینک"
      const rows = all.map((p) =>
        [p.externalCode, p.fullName, p.mobile ?? "", p.gender ?? "", p.job ?? "", p.birthDate ?? "", p.syncedAt].join(
          ",",
        ),
      )
      const blob = new Blob(["\uFEFF" + header + "\n" + rows.join("\n")], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = "patients.csv"
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // silent
    }
  }

  const activeFilters = (genderFilter !== "ALL" ? 1 : 0) + (jobFilter !== "ALL" ? 1 : 0)

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl">بیماران</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)} className="relative">
            <SlidersHorizontal />
            فیلتر
            {activeFilters > 0 && (
              <span className="absolute -top-1.5 -left-1.5 flex size-4 items-center justify-center rounded-full bg-primary text-[9px] text-primary-foreground">
                {activeFilters}
              </span>
            )}
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <FileDownIcon />
            خروجی CSV
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="relative w-full max-w-sm">
          <SearchIcon className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="جستجوی نام، موبایل یا کد بیمار..."
            value={searchInput}
            onChange={(e) => debouncedSearch(e.target.value)}
            className="pr-9"
          />
          {searchInput && (
            <button
              onClick={clearSearch}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        {showFilters && (
          <div className="flex flex-wrap gap-3 p-3 rounded-lg border bg-muted/30">
            <div className="flex items-center gap-2">
              <Filter className="size-4 text-muted-foreground" />
              <select
                className="text-sm bg-background border rounded-md px-2 py-1.5"
                value={genderFilter}
                onChange={(e) => setGenderFilter(e.target.value === "ALL" ? "ALL" : Number(e.target.value))}
              >
                <option value="ALL">همه جنسیت‌ها</option>
                <option value={20}>مرد</option>
                <option value={21}>زن</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <Filter className="size-4 text-muted-foreground" />
              <select
                className="text-sm bg-background border rounded-md px-2 py-1.5 max-w-[180px]"
                value={jobFilter}
                onChange={(e) => setJobFilter(e.target.value)}
              >
                <option value="ALL">همه شغل‌ها</option>
                {uniqueJobs.map((job) => (
                  <option key={job} value={job}>{job}</option>
                ))}
              </select>
            </div>
            {activeFilters > 0 && (
              <Button variant="ghost" size="sm" onClick={() => { setGenderFilter("ALL"); setJobFilter("ALL") }}>
                <X className="size-3 ml-1" />
                پاک کردن فیلترها
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="bg-muted">
            <TableRow>
              {(["externalCode", "fullName", "mobile", "gender", "job", undefined, "birthDate", "syncedAt"] as (SortField | undefined)[]).map((field, i) => {
                const labels = ["کد", "نام", "موبایل", "جنسیت", "شغل", "داده‌ها", "تاریخ تولد", "آخرین سینک"]
                return (
                  <TableHead
                    key={labels[i]}
                    className={cn(field && "cursor-pointer select-none hover:text-foreground")}
                    onClick={() => field && toggleSort(field)}
                  >
                    <div className="flex items-center gap-1">
                      {labels[i]}
                      {field && <SortIcon field={field} />}
                    </div>
                  </TableHead>
                )
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center">
                  <Loader2Icon className="mx-auto size-6 animate-spin text-muted-foreground" />
                </TableCell>
              </TableRow>
            ) : processedPatients.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  بیماری یافت نشد
                </TableCell>
              </TableRow>
            ) : (
              processedPatients.map((patient) => (
                <TableRow key={patient.id} className="cursor-pointer hover:bg-muted/50" onClick={() => router.push(`/patients/${patient.id}`)}>
                  <TableCell className="font-medium">{patient.externalCode}</TableCell>
                  <TableCell className="hover:underline font-medium">{patient.fullName}</TableCell>
                  <TableCell dir="ltr">{patient.mobile || "---"}</TableCell>
                  <TableCell>
                    {(patient.gender === 20 || patient.gender === 1) && <Badge variant="outline">مرد</Badge>}
                    {patient.gender === 21 && <Badge variant="outline">زن</Badge>}
                    {patient.gender && patient.gender !== 20 && patient.gender !== 1 && patient.gender !== 21 && <Badge variant="outline">سایر</Badge>}
                    {!patient.gender && "---"}
                  </TableCell>
                  <TableCell>{patient.job || "---"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {patient.hasTreatments && (
                        <Badge variant="secondary" className="gap-1 text-[10px]">
                          <Syringe className="size-3" />
                          درمان
                        </Badge>
                      )}
                      {patient.hasReserves && (
                        <Badge variant="secondary" className="gap-1 text-[10px]">
                          <CalendarClock className="size-3" />
                          نوبت
                        </Badge>
                      )}
                      {!patient.hasTreatments && !patient.hasReserves && (
                        <span className="text-xs text-muted-foreground">---</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">{formatDate(patient.birthDate)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDateTime(patient.syncedAt)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between px-4">
          <div className="text-sm text-muted-foreground">
            {pagination.total} بیمار — صفحه {pagination.page} از {pagination.totalPages}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="hidden h-8 w-8 p-0 lg:flex"
              size="icon"
              onClick={() => goToPage(1)}
              disabled={pagination.page <= 1}
            >
              <ChevronsRightIcon />
            </Button>
            <Button
              variant="outline"
              className="size-8"
              size="icon"
              onClick={() => goToPage(pagination.page - 1)}
              disabled={pagination.page <= 1}
            >
              <ChevronRightIcon />
            </Button>
            <span className="text-sm font-medium">
              {pagination.page} / {pagination.totalPages}
            </span>
            <Button
              variant="outline"
              className="size-8"
              size="icon"
              onClick={() => goToPage(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
            >
              <ChevronLeftIcon />
            </Button>
            <Button
              variant="outline"
              className="hidden size-8 lg:flex"
              size="icon"
              onClick={() => goToPage(pagination.totalPages)}
              disabled={pagination.page >= pagination.totalPages}
            >
              <ChevronsLeftIcon />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
