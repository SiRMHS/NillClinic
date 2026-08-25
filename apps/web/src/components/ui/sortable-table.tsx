"use client"

import { useMemo, useState } from "react"
import { TableHead } from "@/components/ui/table"
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react"

export type SortDirection = "asc" | "desc"

export interface SortState<K extends string> {
  key: K
  direction: SortDirection
}

/**
 * Client-side sorting for tables whose full result set is already loaded.
 *
 * Not for paginated tables: sorting only the rows currently on screen would
 * silently reorder a 50-row window and present it as a ranking of the whole
 * set. Those must sort server-side instead.
 */
export function useSortableRows<
  T,
  A extends Record<string, (row: T) => number | string | null>,
>(rows: T[], accessors: A, initial: SortState<Extract<keyof A, string>>) {
  // The key type is inferred from `accessors`, not from `initial` — otherwise a
  // single-key initial value narrows K and every other column is rejected.
  type K = Extract<keyof A, string>;
  const [sort, setSort] = useState<SortState<K>>(initial)

  const sorted = useMemo(() => {
    const get = accessors[sort.key]
    if (!get) return rows
    const factor = sort.direction === "asc" ? 1 : -1

    return [...rows].sort((a, b) => {
      const av = get(a)
      const bv = get(b)
      // Nulls sort last regardless of direction — an absent value is not
      // "smallest", it is unknown, and burying it keeps the head of the table
      // meaningful.
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor
      return String(av).localeCompare(String(bv), "fa") * factor
    })
  }, [rows, sort, accessors])

  /** Toggle direction when re-clicking the active column. */
  const toggle = (key: K, defaultDirection: SortDirection = "desc") => {
    setSort((s) =>
      s.key === key
        ? { key, direction: s.direction === "asc" ? "desc" : "asc" }
        : { key, direction: defaultDirection },
    )
  }

  return { sorted, sort, toggle }
}

export function SortableHead<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  align = "right",
  defaultDirection = "desc",
  title,
}: {
  label: string
  sortKey: K
  sort: SortState<K>
  onSort: (key: K, defaultDirection?: SortDirection) => void
  align?: "right" | "left"
  defaultDirection?: SortDirection
  title?: string
}) {
  const isActive = sort.key === sortKey
  const Icon = !isActive ? ChevronsUpDown : sort.direction === "asc" ? ArrowUp : ArrowDown

  return (
    <TableHead className={align === "left" ? "text-left" : undefined}>
      <button
        type="button"
        onClick={() => onSort(sortKey, defaultDirection)}
        title={title ?? `مرتب‌سازی بر اساس ${label}`}
        className={`inline-flex items-center gap-1 transition-colors hover:text-foreground ${
          isActive ? "font-semibold text-foreground" : "text-muted-foreground"
        } ${align === "left" ? "flex-row-reverse" : ""}`}
      >
        {label}
        <Icon className={`size-3.5 ${isActive ? "opacity-100" : "opacity-40"}`} />
      </button>
    </TableHead>
  )
}
