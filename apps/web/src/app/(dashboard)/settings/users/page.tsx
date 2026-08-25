"use client"

import { useEffect, useState, useCallback } from "react"
import { apiFetch } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs"
import {
  PlusIcon, PencilIcon, Trash2Icon, UserPlusIcon, ShieldIcon,
  UsersIcon, CheckCircle2Icon, XCircleIcon, Loader2Icon,
  EyeIcon, EyeOffIcon,
} from "lucide-react"
import { toast } from "sonner"
import { useAuth } from "@/stores/auth.store"

interface Role {
  id: string
  name: string
  label: string
  description: string | null
  permissions: string[]
  _count?: { users: number }
}

interface User {
  id: string
  email: string
  fullName: string | null
  role: { id: string; name: string; label: string } | null
  isActive: boolean
  createdAt: string
}

interface Permission {
  key: string
  label: string
  group: string
  hint?: string
}

function toPersianNum(num: number | string) {
  return num.toString().replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[parseInt(d, 10)]!)
}

export default function UsersManagementPage() {
  const hasPermission = useAuth((s) => s.hasPermission)
  // The two tabs are separately grantable: a role can be allowed to manage
  // users without being allowed to redefine what a role may see.
  const canManageUsers = hasPermission("settings.users")
  const canManageRoles = hasPermission("settings.roles")

  const [users, setUsers] = useState<User[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    try {
      const [u, r, p] = await Promise.all([
        canManageUsers ? apiFetch<User[]>("/api/admin/users") : [],
        apiFetch<Role[]>("/api/admin/roles"),
        apiFetch<Permission[]>("/api/admin/permissions"),
      ])
      setUsers(u)
      setRoles(r)
      setPermissions(p)
    } catch (e) {
      toast.error("خطا در بارگذاری اطلاعات")
    } finally {
      setLoading(false)
    }
  }, [canManageUsers])

  useEffect(() => { loadData() }, [loadData])

  const groupedPermissions = permissions.reduce<Record<string, Permission[]>>((acc, p) => {
    if (!acc[p.group]) acc[p.group] = []
    acc[p.group].push(p)
    return acc
  }, {})

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">مدیریت کاربران و نقش‌ها</h1>
          <p className="text-sm text-muted-foreground mt-1">
            ایجاد و مدیریت کاربران، نقش‌ها و سطح دسترسی‌ها
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2Icon className="size-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Tabs defaultValue={canManageUsers ? "users" : "roles"}>
          <TabsList className="mb-4">
            {canManageUsers && (
              <TabsTrigger value="users" className="flex items-center gap-2">
                <UsersIcon className="size-4" />
                کاربران
              </TabsTrigger>
            )}
            {canManageRoles && (
              <TabsTrigger value="roles" className="flex items-center gap-2">
                <ShieldIcon className="size-4" />
                نقش‌ها
              </TabsTrigger>
            )}
          </TabsList>

          {canManageUsers && (
            <TabsContent value="users">
              <UsersTab
                users={users}
                roles={roles}
                onRefresh={loadData}
              />
            </TabsContent>
          )}

          {canManageRoles && (
            <TabsContent value="roles">
              <RolesTab
                roles={roles}
                permissions={groupedPermissions}
                allPermissions={permissions}
                onRefresh={loadData}
              />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  )
}

function UsersTab({
  users, roles, onRefresh,
}: {
  users: User[]
  roles: Role[]
  onRefresh: () => void
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base">کاربران سیستم</CardTitle>
          <CardDescription>
            مجموع {toPersianNum(users.length)} کاربر
          </CardDescription>
        </div>
        <UserDialog roles={roles} onSuccess={onRefresh}>
          <Button size="sm" className="gap-2">
            <UserPlusIcon className="size-4" />
            کاربر جدید
          </Button>
        </UserDialog>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>نام</TableHead>
              <TableHead>ایمیل</TableHead>
              <TableHead>نقش</TableHead>
              <TableHead>وضعیت</TableHead>
              <TableHead>تاریخ ثبت</TableHead>
              <TableHead className="w-24">عملیات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  هیچ کاربری یافت نشد
                </TableCell>
              </TableRow>
            ) : users.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.fullName || "—"}</TableCell>
                <TableCell dir="ltr">{user.email}</TableCell>
                <TableCell>
                  <Badge variant="outline">{user.role?.label || "—"}</Badge>
                </TableCell>
                <TableCell>
                  {user.isActive ? (
                    <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300 gap-1">
                      <CheckCircle2Icon className="size-3" />
                      فعال
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="gap-1">
                      <XCircleIcon className="size-3" />
                      غیرفعال
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {new Date(user.createdAt).toLocaleDateString("fa-IR")}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <UserDialog roles={roles} user={user} onSuccess={onRefresh}>
                      <Button variant="ghost" size="icon">
                        <PencilIcon className="size-4" />
                      </Button>
                    </UserDialog>
                    {user.email !== "admin@jordanclinic.ir" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-red-500 hover:text-red-600"
                        onClick={async () => {
                          if (confirm("آیا از حذف این کاربر اطمینان دارید؟")) {
                            try {
                              await apiFetch(`/api/admin/users/${user.id}`, { method: "DELETE" })
                              toast.success("کاربر حذف شد")
                              onRefresh()
                            } catch { toast.error("خطا در حذف کاربر") }
                          }
                        }}
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function UserDialog({
  children, roles, user, onSuccess,
}: {
  children: React.ReactNode
  roles: Role[]
  user?: User
  onSuccess: () => void
}) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState(user?.email || "")
  const [fullName, setFullName] = useState(user?.fullName || "")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [roleId, setRoleId] = useState(user?.role?.id || "")

  const handleRoleChange = (value: string | null) => {
    if (value) setRoleId(value)
  }
  const [isActive, setIsActive] = useState(user?.isActive ?? true)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!email || !fullName || (!user && !password)) return
    setSaving(true)
    try {
      if (user) {
        const body: Record<string, unknown> = { email, fullName, roleId, isActive }
        if (password) body.password = password
        await apiFetch(`/api/admin/users/${user.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        })
        toast.success("کاربر ویرایش شد")
      } else {
        await apiFetch("/api/admin/users", {
          method: "POST",
          body: JSON.stringify({ email, fullName, password, roleId, isActive }),
        })
        toast.success("کاربر ایجاد شد")
      }
      setOpen(false)
      onSuccess()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در ذخیره")
    } finally {
      setSaving(false)
    }
  }

  const isEdit = !!user

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && (
        <div className="contents" onClick={() => setOpen(true)}>
          {children}
        </div>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "ویرایش کاربر" : "کاربر جدید"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "اطلاعات کاربر را ویرایش کنید" : "اطلاعات کاربر جدید را وارد کنید"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>نام کامل</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="نام و نام خانوادگی" />
          </div>
          <div className="space-y-2">
            <Label>ایمیل</Label>
            <Input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" />
          </div>
          <div className="space-y-2">
            <Label>رمز عبور {isEdit && "(خالی بگذارید تا تغییر نکند)"}</Label>
            <div className="relative">
              {/* Physical side + matching padding, same reason as the login
                  form: the field is LTR inside an RTL page, and without the
                  reserved space the typed password runs under the icon. */}
              <Input
                type={showPassword ? "text" : "password"}
                dir="ltr"
                className="pr-10 text-left"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isEdit ? "رمز عبور جدید" : "حداقل ۸ کاراکتر"}
                minLength={isEdit && !password ? 0 : 8}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? "پنهان کردن رمز" : "نمایش رمز"}
                tabIndex={-1}
              >
                {showPassword ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>نقش دسترسی</Label>
            <Select value={roleId} onValueChange={(v: string | null) => v && setRoleId(v)}>
              <SelectTrigger>
                <SelectValue placeholder="انتخاب نقش" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.label} ({r.name})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>انصراف</Button>
          <Button onClick={handleSave} disabled={saving || !email || !fullName || (!isEdit && !password)}>
            {saving ? <Loader2Icon className="size-4 animate-spin" /> : null}
            {isEdit ? "ذخیره تغییرات" : "ایجاد کاربر"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RolesTab({
  roles, permissions, allPermissions, onRefresh,
}: {
  roles: Role[]
  permissions: Record<string, Permission[]>
  allPermissions: Permission[]
  onRefresh: () => void
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base">نقش‌های دسترسی</CardTitle>
          <CardDescription>
            مجموع {toPersianNum(roles.length)} نقش
          </CardDescription>
        </div>
        <RoleDialog allPermissions={allPermissions} onSuccess={onRefresh}>
          <Button size="sm" className="gap-2">
            <PlusIcon className="size-4" />
            نقش جدید
          </Button>
        </RoleDialog>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>نقش</TableHead>
              <TableHead>توضیحات</TableHead>
              <TableHead>تعداد کاربران</TableHead>
              <TableHead>دسترسی‌ها</TableHead>
              <TableHead className="w-24">عملیات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  هیچ نقشی یافت نشد
                </TableCell>
              </TableRow>
            ) : roles.map((role) => (
              <TableRow key={role.id}>
                <TableCell>
                  <div className="font-medium">{role.label}</div>
                  <div className="text-xs text-muted-foreground" dir="ltr">{role.name}</div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{role.description || "—"}</TableCell>
                <TableCell>{toPersianNum(role._count?.users ?? 0)}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1 max-w-xs">
                    {role.permissions.includes("*") ? (
                      <Badge className="bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300">
                        دسترسی کامل
                      </Badge>
                    ) : (
                      role.permissions.slice(0, 4).map((p) => (
                        <Badge key={p} variant="secondary" className="text-[10px]">
                          {allPermissions.find((ap) => ap.key === p)?.label || p}
                        </Badge>
                      ))
                    )}
                    {role.permissions.length > 4 && (
                      <Badge variant="outline" className="text-[10px]">
                        +{role.permissions.length - 4}
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <RoleDialog role={role} allPermissions={allPermissions} onSuccess={onRefresh}>
                      <Button variant="ghost" size="icon">
                        <PencilIcon className="size-4" />
                      </Button>
                    </RoleDialog>
                    {role.name !== "superadmin" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-red-500 hover:text-red-600"
                        onClick={async () => {
                          if (confirm(`آیا از حذف نقش "${role.label}" اطمینان دارید؟`)) {
                            try {
                              await apiFetch(`/api/admin/roles/${role.id}`, { method: "DELETE" })
                              toast.success("نقش حذف شد")
                              onRefresh()
                            } catch (e) {
                              toast.error(e instanceof Error ? e.message : "خطا در حذف نقش")
                            }
                          }
                        }}
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function RoleDialog({
  children, role, allPermissions, onSuccess,
}: {
  children: React.ReactNode
  role?: Role
  allPermissions: Permission[]
  onSuccess: () => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(role?.name || "")
  const [label, setLabel] = useState(role?.label || "")
  const [description, setDescription] = useState(role?.description || "")
  const [selectedPerms, setSelectedPerms] = useState<string[]>(role?.permissions || [])
  const [saving, setSaving] = useState(false)

  const groupedPermissions = allPermissions.reduce<Record<string, Permission[]>>((acc, p) => {
    if (!acc[p.group]) acc[p.group] = []
    acc[p.group].push(p)
    return acc
  }, {})

  const togglePerm = (key: string) => {
    setSelectedPerms((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]
    )
  }

  const toggleGroup = (perms: Permission[]) => {
    const keys = perms.map((p) => p.key)
    const allOn = keys.every((k) => selectedPerms.includes(k))
    setSelectedPerms((prev) =>
      allOn ? prev.filter((p) => !keys.includes(p)) : [...new Set([...prev, ...keys])]
    )
  }

  // A role holding "*" is the seeded superadmin: the API refuses to store the
  // wildcard, so its checkboxes are shown read-only rather than as a form that
  // would silently downgrade it on save.
  const isSuperAdminRole = role?.permissions.includes("*") === true

  const handleSave = async () => {
    if (!name || !label) return
    setSaving(true)
    try {
      if (role) {
        await apiFetch(`/api/admin/roles/${role.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            label,
            description,
            // Leave the wildcard untouched — the API rejects "*" as an input.
            ...(isSuperAdminRole ? {} : { permissions: selectedPerms }),
          }),
        })
        toast.success("نقش ویرایش شد")
      } else {
        await apiFetch("/api/admin/roles", {
          method: "POST",
          body: JSON.stringify({ name, label, description, permissions: selectedPerms }),
        })
        toast.success("نقش ایجاد شد")
      }
      setOpen(false)
      onSuccess()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "خطا در ذخیره")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && (
        <div className="contents" onClick={() => setOpen(true)}>
          {children}
        </div>
      )}
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{role ? "ویرایش نقش" : "نقش جدید"}</DialogTitle>
          <DialogDescription>
            {role ? "دسترسی‌های نقش را ویرایش کنید" : "نقش جدید با دسترسی‌های مورد نظر ایجاد کنید"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>نام سیستمی</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="manager" disabled={!!role} />
            </div>
            <div className="space-y-2">
              <Label>نام نمایشی</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="مدیر" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>توضیحات</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="توضیح کوتاه" />
          </div>
          <div className="space-y-2">
            <Label>دسترسی‌ها</Label>
            {isSuperAdminRole && (
              <p className="rounded-md bg-violet-100 px-3 py-2 text-xs text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                این نقش دسترسی کامل دارد و همه بخش‌ها برایش باز است — قابل ویرایش نیست.
              </p>
            )}
            <div className="border rounded-lg p-4 space-y-5 max-h-[22rem] overflow-y-auto">
              {Object.entries(groupedPermissions).map(([group, perms]) => {
                const selectedInGroup = perms.filter((p) => selectedPerms.includes(p.key)).length
                return (
                  <div key={group}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h4 className="text-sm font-medium text-muted-foreground">
                        {group}
                        <span className="ms-2 text-xs tabular-nums">
                          ({toPersianNum(selectedInGroup)}/{toPersianNum(perms.length)})
                        </span>
                      </h4>
                      <button
                        type="button"
                        className="text-xs text-primary hover:underline disabled:opacity-50"
                        disabled={isSuperAdminRole}
                        onClick={() => toggleGroup(perms)}
                      >
                        {selectedInGroup === perms.length ? "برداشتن همه" : "انتخاب همه"}
                      </button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {perms.map((perm) => (
                        <label
                          key={perm.key}
                          className={`flex items-start gap-2 p-2 rounded-md text-sm transition-colors
                            ${isSuperAdminRole ? "opacity-60" : "cursor-pointer"}
                            ${selectedPerms.includes(perm.key) ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5 size-4 rounded border-gray-300 text-primary focus:ring-primary"
                            checked={isSuperAdminRole || selectedPerms.includes(perm.key)}
                            disabled={isSuperAdminRole}
                            onChange={() => togglePerm(perm.key)}
                          />
                          <span className="flex flex-col">
                            <span>{perm.label}</span>
                            {perm.hint && (
                              <span className="text-[11px] leading-tight text-muted-foreground">
                                {perm.hint}
                              </span>
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>انصراف</Button>
          <Button onClick={handleSave} disabled={saving || !name || !label}>
            {saving ? <Loader2Icon className="size-4 animate-spin" /> : null}
            {role ? "ذخیره تغییرات" : "ایجاد نقش"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
