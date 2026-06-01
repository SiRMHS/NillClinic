"use client"

import * as React from "react"
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table"
import { z } from "zod"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
} from "lucide-react"

export const schema = z.object({
  id: z.string(),
  source: z.string(),
  status: z.string(),
  fullName: z.string().nullable(),
  mobile: z.string().nullable(),
  createdAt: z.string(),
})

export function DataTable({
  data,
}: {
  data: z.infer<typeof schema>[]
}) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: 5,
  })

  const columns: ColumnDef<z.infer<typeof schema>>[] = [
    {
      accessorKey: "fullName",
      header: "نام",
      cell: ({ row }) => row.getValue("fullName") || "---",
    },
    {
      accessorKey: "source",
      header: "منبع",
      cell: ({ row }) => (
        <Badge variant="outline">{row.getValue("source")}</Badge>
      ),
    },
    {
      accessorKey: "status",
      header: "وضعیت",
      cell: ({ row }) => {
        const status = row.getValue("status") as string
        const colorMap: Record<string, string> = {
          NEW: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
          CONTACTED: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300",
          CONVERTED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300",
          LOST: "bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-300",
        }
        return (
          <Badge className={colorMap[status] || ""}>
            {status === "NEW" && "جدید"}
            {status === "CONTACTED" && "تماس گرفته شده"}
            {status === "CONVERTED" && "تبدیل شده"}
            {status === "LOST" && "از دست رفته"}
          </Badge>
        )
      },
    },
    {
      accessorKey: "createdAt",
      header: "تاریخ",
      cell: ({ row }) => {
        const date = new Date(row.getValue("createdAt"))
        return new Intl.DateTimeFormat("fa-IR", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(date)
      },
    },
  ]

  const table = useReactTable({
    data,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="bg-muted">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())
                    }
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  داده‌ای وجود ندارد
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between px-4">
        <div className="text-sm text-muted-foreground">
          {table.getFilteredRowModel().rows.length} مورد
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="hidden h-8 w-8 p-0 lg:flex"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronsRightIcon />
          </Button>
          <Button
            variant="outline"
            className="size-8"
            size="icon"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronRightIcon />
          </Button>
          <div className="text-sm font-medium">
            صفحه {table.getState().pagination.pageIndex + 1} از {table.getPageCount()}
          </div>
          <Button
            variant="outline"
            className="size-8"
            size="icon"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="outline"
            className="hidden size-8 lg:flex"
            size="icon"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
          >
            <ChevronsLeftIcon />
          </Button>
        </div>
      </div>
    </div>
  )
}
