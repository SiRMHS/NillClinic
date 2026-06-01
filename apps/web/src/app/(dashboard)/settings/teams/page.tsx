"use client"

import { useEffect, useState, useCallback } from "react"
import { apiFetch } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Building2Icon, PlusIcon, PencilIcon, Trash2Icon,
  UsersIcon, Loader2Icon, UserIcon, CheckCircle2Icon, XCircleIcon,
} from "lucide-react"
import { toast } from "sonner"

interface TeamMember {
  id: string
  email: string
  fullName: string | null
  isActive: boolean
}

interface Team {
  id: string
  name: string
  label: string
  description: string | null
  permissions: string[]
  members: TeamMember[]
  memberCount: number
}

interface Permission {
  key: string
  label: string
  group: string
}

function toPersianNum(num: number | string) {
  return num.toString().replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[parseInt(d, 10)]!)
}

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([])
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [t, p] = await Promise.all([
        apiFetch<Team[]>("/api/admin/teams"),
        apiFetch<Permission[]>("/api/admin/permissions"),
      ])
      setTeams(t)
      setPermissions(p)
    } catch { toast.error("خطا در بارگذاری") }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const groupedPermissions = permissions.reduce<Record<string, Permission[]>>((acc, p) => {
    if (!acc[p.group]) acc[p.group] = []
    acc[p.group].push(p)
    return acc
  }, {})

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">مدیریت تیم‌ها</h1>
        <p className="text-sm text-muted-foreground mt-1">
          تعریف تیم‌ها، تنظیم دسترسی‌ها و مدیریت اعضای هر تیم
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2Icon className="size-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {teams.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              permissions={groupedPermissions}
              allPermissions={permissions}
              onRefresh={loadData}
            />
          ))}
          <AddTeamCard permissions={groupedPermissions} allPermissions={permissions} onSuccess={loadData} />
        </div>
      )}
    </div>
  )
}

function TeamCard({
  team, permissions, allPermissions, onRefresh,
}: {
  team: Team
  permissions: Record<string, Permission[]>
  allPermissions: Permission[]
  onRefresh: () => void
}) {
  const [openEdit, setOpenEdit] = useState(false)
  const [openMembers, setOpenMembers] = useState(false)

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-violet-100 dark:bg-violet-900 p-2">
              <Building2Icon className="size-5 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <CardTitle className="text-base">{team.label}</CardTitle>
              <CardDescription>{team.name}</CardDescription>
            </div>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" onClick={() => setOpenEdit(true)}>
              <PencilIcon className="size-4" />
            </Button>
            {team.name !== "superadmin" && (
              <Button
                variant="ghost" size="icon"
                className="text-red-500 hover:text-red-600"
                onClick={async () => {
                  if (confirm(`آیا از حذف تیم "${team.label}" اطمینان دارید؟`)) {
                    try {
                      await apiFetch(`/api/admin/roles/${team.id}`, { method: "DELETE" })
                      toast.success("تیم حذف شد")
                      onRefresh()
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "خطا در حذف")
                    }
                  }
                }}
              >
                <Trash2Icon className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-3">{team.description || "بدون توضیحات"}</p>

        {/* Members */}
        <div className="mb-3">
          <button
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full"
            onClick={() => setOpenMembers(true)}
          >
            <UsersIcon className="size-4" />
            <span>{toPersianNum(team.memberCount)} عضو</span>
          </button>
        </div>

        {/* First 3 members inline */}
        {team.members.length > 0 && (
          <div className="space-y-1 mb-3">
            {team.members.slice(0, 3).map((m) => (
              <div key={m.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                <UserIcon className="size-3 shrink-0" />
                <span className="truncate">{m.fullName || m.email}</span>
                {m.isActive
                  ? <CheckCircle2Icon className="size-3 shrink-0 text-emerald-500" />
                  : <XCircleIcon className="size-3 shrink-0 text-red-500" />
                }
              </div>
            ))}
            {team.members.length > 3 && (
              <button
                className="text-xs text-violet-600 hover:text-violet-700 dark:text-violet-400"
                onClick={() => setOpenMembers(true)}
              >
                + {team.members.length - 3} عضو دیگر
              </button>
            )}
          </div>
        )}

        {/* Permissions */}
        <div className="flex flex-wrap gap-1">
          {team.permissions.includes("*") ? (
            <Badge className="bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300">
              دسترسی کامل
            </Badge>
          ) : (
            team.permissions.slice(0, 4).map((p) => (
              <Badge key={p} variant="secondary" className="text-[10px]">
                {allPermissions.find((ap) => ap.key === p)?.label || p}
              </Badge>
            ))
          )}
          {team.permissions.length > 4 && (
            <Badge variant="outline" className="text-[10px]">
              +{team.permissions.length - 4}
            </Badge>
          )}
        </div>
      </CardContent>

      {/* Edit Team Dialog */}
      <EditTeamDialog
        team={team}
        open={openEdit}
        onOpenChange={setOpenEdit}
        permissions={permissions}
        allPermissions={allPermissions}
        onSuccess={onRefresh}
      />

      {/* Members Dialog */}
      <MembersDialog
        team={team}
        open={openMembers}
        onOpenChange={setOpenMembers}
        onSuccess={onRefresh}
      />
    </Card>
  )
}

function EditTeamDialog({
  team, open, onOpenChange, permissions, allPermissions, onSuccess,
}: {
  team: Team
  open: boolean
  onOpenChange: (open: boolean) => void
  permissions: Record<string, Permission[]>
  allPermissions: Permission[]
  onSuccess: () => void
}) {
  const [label, setLabel] = useState(team.label)
  const [description, setDescription] = useState(team.description || "")
  const [selectedPerms, setSelectedPerms] = useState<string[]>(team.permissions)
  const [saving, setSaving] = useState(false)

  const togglePerm = (key: string) => {
    setSelectedPerms((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]
    )
  }

  const handleSave = async () => {
    if (!label) return
    setSaving(true)
    try {
      await apiFetch(`/api/admin/roles/${team.id}`, {
        method: "PATCH",
        body: JSON.stringify({ label, description, permissions: selectedPerms }),
      })
      toast.success("تیم ویرایش شد")
      onOpenChange(false)
      onSuccess()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در ذخیره")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>ویرایش تیم: {team.label}</DialogTitle>
          <DialogDescription>تغییر دسترسی‌ها و اطلاعات تیم</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>نام تیم</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>توضیحات</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>دسترسی‌ها</Label>
            <div className="border rounded-lg p-4 space-y-4 max-h-60 overflow-y-auto">
              {Object.entries(permissions).map(([group, perms]) => (
                <div key={group}>
                  <h4 className="text-sm font-medium text-muted-foreground mb-2">{group}</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {perms.map((perm) => (
                      <label
                        key={perm.key}
                        className={`flex items-center gap-2 p-2 rounded-md cursor-pointer text-sm transition-colors
                          ${selectedPerms.includes(perm.key) ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}
                      >
                        <input
                          type="checkbox"
                          className="size-4 rounded border-gray-300 text-primary focus:ring-primary"
                          checked={selectedPerms.includes(perm.key)}
                          onChange={() => togglePerm(perm.key)}
                        />
                        {perm.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>انصراف</Button>
          <Button onClick={handleSave} disabled={saving || !label}>
            {saving ? <Loader2Icon className="size-4 animate-spin" /> : null}
            ذخیره تغییرات
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MembersDialog({
  team, open, onOpenChange, onSuccess,
}: {
  team: Team
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}) {
  const [allUsers, setAllUsers] = useState<Array<{ id: string; email: string; fullName: string | null; role?: { id: string; label: string } | null }>>([])
  const [selectedUserId, setSelectedUserId] = useState("")
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    if (open) {
      apiFetch<Array<{ id: string; email: string; fullName: string | null; role?: { id: string; label: string } | null }>>("/api/admin/users")
        .then(setAllUsers)
        .catch(() => {})
    }
  }, [open])

  const availableUsers = allUsers.filter((u) => !team.members.some((m) => m.id === u.id))

  const handleAddMember = async () => {
    if (!selectedUserId) return
    setAdding(true)
    try {
      await apiFetch(`/api/admin/users/${selectedUserId}`, {
        method: "PATCH",
        body: JSON.stringify({ roleId: team.id }),
      })
      toast.success("عضو به تیم اضافه شد")
      setSelectedUserId("")
      onSuccess()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در افزودن عضو")
    } finally {
      setAdding(false)
    }
  }

  const handleRemoveMember = async (userId: string, name: string) => {
    if (!confirm(`آیا از حذف "${name}" از این تیم اطمینان دارید؟`)) return
    try {
      await apiFetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ roleId: null }),
      })
      toast.success("عضو از تیم حذف شد")
      onSuccess()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در حذف عضو")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>اعضای تیم {team.label}</DialogTitle>
          <DialogDescription>
            {toPersianNum(team.memberCount)} عضو — مدیریت اعضای این تیم
          </DialogDescription>
        </DialogHeader>

        {/* Add member */}
        {availableUsers.length > 0 && (
          <div className="flex items-end gap-2 pb-4 border-b">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">افزودن کاربر به تیم</Label>
              <Select value={selectedUserId} onValueChange={(v: string | null) => v && setSelectedUserId(v)}>
                <SelectTrigger>
                  <SelectValue placeholder="انتخاب کاربر..." />
                </SelectTrigger>
                <SelectContent>
                  {availableUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.fullName || u.email} {u.role ? `(${u.role.label})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleAddMember} disabled={!selectedUserId || adding}>
              {adding ? <Loader2Icon className="size-4 animate-spin" /> : "افزودن"}
            </Button>
          </div>
        )}

        {/* Members list */}
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {team.members.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">هیچ عضوی در این تیم وجود ندارد</p>
          ) : team.members.map((m) => (
            <div key={m.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50">
              <div className="flex items-center gap-2 min-w-0">
                <div className="rounded-full bg-muted p-1.5">
                  <UserIcon className="size-4 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm truncate">{m.fullName || m.email}</div>
                  <div className="text-xs text-muted-foreground truncate" dir="ltr">{m.email}</div>
                </div>
                {m.isActive
                  ? <CheckCircle2Icon className="size-3 text-emerald-500 shrink-0" />
                  : <XCircleIcon className="size-3 text-red-500 shrink-0" />
                }
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-red-500 hover:text-red-600 shrink-0"
                onClick={() => handleRemoveMember(m.id, m.fullName || m.email)}
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>بستن</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AddTeamCard({
  permissions, allPermissions, onSuccess,
}: {
  permissions: Record<string, Permission[]>
  allPermissions: Permission[]
  onSuccess: () => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [label, setLabel] = useState("")
  const [description, setDescription] = useState("")
  const [selectedPerms, setSelectedPerms] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const togglePerm = (key: string) => {
    setSelectedPerms((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]
    )
  }

  const handleSave = async () => {
    if (!name || !label) return
    setSaving(true)
    try {
      await apiFetch("/api/admin/roles", {
        method: "POST",
        body: JSON.stringify({ name, label, description, permissions: selectedPerms }),
      })
      toast.success("تیم ایجاد شد")
      setOpen(false)
      onSuccess()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در ذخیره")
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Card
        className="border-dashed hover:shadow-md transition-shadow cursor-pointer"
        onClick={() => setOpen(true)}
      >
        <CardContent className="flex flex-col items-center justify-center gap-2 p-8">
          <div className="rounded-full bg-muted p-3">
            <PlusIcon className="size-6 text-muted-foreground" />
          </div>
          <span className="text-sm font-medium text-muted-foreground">ایجاد تیم جدید</span>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>تیم جدید</DialogTitle>
            <DialogDescription>تیم جدید با دسترسی‌های مورد نظر ایجاد کنید</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>نام سیستمی</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="support-team" />
              </div>
              <div className="space-y-2">
                <Label>نام تیم</Label>
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="تیم پشتیبانی" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>توضیحات</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="توضیح کوتاه" />
            </div>
            <div className="space-y-2">
              <Label>دسترسی‌ها</Label>
              <div className="border rounded-lg p-4 space-y-4 max-h-60 overflow-y-auto">
                {Object.entries(permissions).map(([group, perms]) => (
                  <div key={group}>
                    <h4 className="text-sm font-medium text-muted-foreground mb-2">{group}</h4>
                    <div className="grid grid-cols-2 gap-2">
                      {perms.map((perm) => (
                        <label
                          key={perm.key}
                          className={`flex items-center gap-2 p-2 rounded-md cursor-pointer text-sm transition-colors
                            ${selectedPerms.includes(perm.key) ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}
                        >
                          <input
                            type="checkbox"
                            className="size-4 rounded border-gray-300 text-primary focus:ring-primary"
                            checked={selectedPerms.includes(perm.key)}
                            onChange={() => togglePerm(perm.key)}
                          />
                          {perm.label}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>انصراف</Button>
            <Button onClick={handleSave} disabled={saving || !name || !label}>
              {saving ? <Loader2Icon className="size-4 animate-spin" /> : null}
              ایجاد تیم
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
