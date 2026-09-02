/**
 * Single source of truth for every access key in the dashboard.
 *
 * Each key names one thing a role can be allowed to do, and the same key is
 * used in three places: the checkbox list rendered in role management, the
 * `requirePermission` guard on the API route, and the sidebar entry on the web
 * app. Adding a section means adding its key here — nowhere else keeps a list.
 */

export interface PermissionDef {
  key: string;
  label: string;
  group: string;
  /** Shown under the checkbox so an operator knows what they are granting. */
  hint?: string;
}

export const AVAILABLE_PERMISSIONS: PermissionDef[] = [
  // ─── اصلی ───
  { key: "dashboard", label: "داشبورد", group: "اصلی", hint: "صفحه اصلی و شاخص‌های کلی" },

  // ─── بیماران ───
  { key: "patients.view", label: "مشاهده بیماران", group: "بیماران", hint: "فهرست و پرونده بیماران" },
  { key: "patients", label: "مدیریت بیماران", group: "بیماران", hint: "شامل مشاهده + خروجی گرفتن" },
  { key: "patients.vip", label: "تعیین VIP و سلبریتی", group: "بیماران", hint: "ثبت دستی رتبه ویژه برای بیمار، مستقل از مبلغ پرداختی" },

  // ─── فروش ───
  { key: "leads", label: "لیدها", group: "فروش", hint: "فقط لیدهای خودِ کارشناس و لیدهای واگذارنشده" },
  { key: "leads.all", label: "مشاهده همه لیدها", group: "فروش", hint: "دیدن لیدهای سایر کارشناسان — مخصوص سرپرست فروش" },
  { key: "leads.assign", label: "واگذاری لید", group: "فروش", hint: "تغییر کارشناس مسئول یک لید" },
  { key: "leads.delete", label: "حذف لید", group: "فروش", hint: "حذف دائمی لید از سیستم" },
  { key: "campaigns", label: "کمپین‌ها", group: "فروش", hint: "ساخت و مدیریت کمپین‌های تبلیغاتی" },

  // ─── گزارشات و تحلیل ───
  { key: "analytics", label: "تحلیل‌های عمومی", group: "گزارشات", hint: "رشد بیماران، کانال‌های جذب، کوهورت" },
  { key: "analytics.medical", label: "تحلیل درمانی", group: "گزارشات", hint: "ماتریس خدمات و پوشش طرح درمان" },
  { key: "analytics.doctors", label: "تحلیل پزشکان", group: "گزارشات", hint: "عملکرد تفکیکی هر پزشک" },
  { key: "crm", label: "تحلیل مراجعین", group: "گزارشات", hint: "صفحه «تحلیل مراجعین» — بخش‌بندی و رفتار مراجعین. ربطی به میز CRM ندارد" },
  { key: "crm.desk", label: "میز CRM", group: "گزارشات", hint: "صفحه «CRM» — مشاهده تماس‌ها و نظرسنجی رضایت. برای ثبت تماس همین کلید کافی است" },
  { key: "crm.desk.manage", label: "ثبت و ویرایش تماس CRM", group: "گزارشات", hint: "افزودن، ویرایش و حذف رکورد میز CRM — خودش «میز CRM» را هم باز می‌کند" },
  { key: "reports.doctors", label: "گزارش پزشکان", group: "گزارشات", hint: "گزارش نوبت و عملکرد پزشکان" },
  { key: "reports.referrals", label: "ارجاع پس از مشاوره", group: "گزارشات", hint: "مسیر بیمار از مشاوره تا خدمت" },
  { key: "reports.export", label: "خروجی اکسل گزارش‌ها", group: "گزارشات", hint: "دانلود فایل گزارش‌های غیرمالی" },

  // ─── مالی ───
  { key: "financial", label: "تحلیل مالی", group: "مالی", hint: "درآمد، روند مالی و تفکیک بخش/خدمت/پرسنل" },
  { key: "financial.patients", label: "رتبه‌بندی مالی بیماران", group: "مالی", hint: "ارزش مالی هر بیمار و بخش‌بندی RFM" },
  { key: "financial.tiers", label: "رتبه ارزش و فعالیت", group: "مالی", hint: "سطح‌بندی بیماران بر پایه مبلغ پرداختی" },
  { key: "financial.export", label: "خروجی گزارش‌های مالی", group: "مالی", hint: "دانلود اکسل حاوی مبالغ" },
  { key: "financial.recompute", label: "بازمحاسبه رتبه‌بندی", group: "مالی", hint: "اجرای دستی محاسبه RFM و سطح ارزش" },

  // ─── سینک ───
  { key: "sync", label: "مشاهده وضعیت سینک", group: "سینک", hint: "وضعیت، لاگ‌ها و پیشرفت سینک CRM" },
  { key: "sync.run", label: "اجرای سینک", group: "سینک", hint: "شروع، توقف و ری‌ست سینک" },
  { key: "sync.settings", label: "تنظیمات و زمان‌بندی سینک", group: "سینک", hint: "سینک ساعتی، بازه و اندازه صفحه" },
  { key: "sync.purge", label: "پاکسازی داده CRM", group: "سینک", hint: "حذف کامل داده‌های سینک‌شده — خطرناک" },

  // ─── سیستم ───
  { key: "settings", label: "تنظیمات عمومی", group: "سیستم", hint: "دسترسی به بخش تنظیمات" },
  { key: "settings.users", label: "مدیریت کاربران", group: "سیستم", hint: "ساخت، ویرایش و غیرفعال‌سازی کاربر" },
  { key: "settings.roles", label: "مدیریت نقش‌ها", group: "سیستم", hint: "تعریف نقش و تعیین دسترسی‌ها" },
  { key: "settings.login-log", label: "گزارش ورود", group: "سیستم", hint: "تاریخچه ورود کاربران" },
  { key: "settings.webhook-logs", label: "لاگ وب‌هوک", group: "سیستم", hint: "ورودی‌های دریافتی از سرویس‌های بیرونی" },
  { key: "settings.external-migration", label: "ورودی خارجی", group: "سیستم", hint: "بارگذاری داده از منابع بیرونی" },
  { key: "settings.leads-log", label: "لاگ ورودی‌ها", group: "سیستم", hint: "تاریخچه لیدهای دریافتی" },
  { key: "settings.leads-bank", label: "بانک لیدها", group: "سیستم", hint: "آرشیو کامل لیدهای خام" },
  { key: "settings.telephony", label: "تنظیمات تلفن", group: "سیستم", hint: "نحوه شماره‌گیری دکمه تماس (Issabel، 3CX، سافت‌فون)" },
  { key: "settings.display", label: "تنظیمات نمایش", group: "سیستم", hint: "مخفی کردن ارقام مالی و نرخ‌ها در نمایش سایت" },
];

export const ALL_PERMISSION_KEYS: string[] = AVAILABLE_PERMISSIONS.map((p) => p.key);

/**
 * Coarse keys that already existed before the catalogue was split into
 * per-section keys. A role holding the parent keeps everything it could reach
 * before, so widening the catalogue never silently revokes access — the finer
 * keys only matter when someone grants them without the parent.
 *
 * Money is deliberately absent from `analytics`: separating financial figures
 * from general reporting is the whole point of the split, so the parent is not
 * allowed to imply it. Existing roles get the financial keys once, through the
 * migration in packages/db/prisma/migrations, rather than through this map.
 */
const PERMISSION_IMPLIES: Record<string, string[]> = {
  patients: ["patients.view", "patients.vip"],
  // Deliberately NOT implying `leads.all`: `leads` is now an agent's own queue
  // plus the unassigned pool, and a supervisor who needs the whole board is
  // given `leads.all` explicitly. Implying it here would restore exactly the
  // cross-agent visibility the key exists to remove.
  leads: ["campaigns", "leads.assign"],
  analytics: [
    "analytics.medical",
    "analytics.doctors",
    "reports.doctors",
    "reports.referrals",
    "reports.export",
  ],
  financial: ["financial.patients", "financial.tiers", "financial.export"],
  // Both directions, deliberately. The desk key opens the whole section, and
  // its writes are the section — a desk that can be read but not written to is
  // not a mode the clinic ever asked for. The reverse arrow is the one that was
  // missing: granting only «ثبت و ویرایش تماس CRM» left every request to
  // /api/crm-desk failing the router's `crm.desk` gate, so the operator saw
  // «دسترسی غیرمجاز» on the one action the key is named after.
  "crm.desk": ["crm.desk.manage"],
  "crm.desk.manage": ["crm.desk"],
  sync: ["sync.run"],
  settings: [
    "settings.external-migration",
    "settings.leads-log",
    "settings.leads-bank",
    "settings.webhook-logs",
  ],
  "settings.users": ["settings.login-log"],
};

/** Expands the keys a role holds into everything those keys grant. */
export function expandPermissions(granted: readonly string[]): Set<string> {
  const out = new Set<string>();
  const visit = (key: string) => {
    if (out.has(key)) return;
    out.add(key);
    for (const child of PERMISSION_IMPLIES[key] ?? []) visit(child);
  };
  for (const key of granted) visit(key);
  return out;
}

/** `*` is the superadmin wildcard and outranks every individual key. */
export function hasPermission(granted: readonly string[] | undefined, required: string): boolean {
  if (!granted?.length) return false;
  if (granted.includes("*")) return true;
  return expandPermissions(granted).has(required);
}

export function hasAnyPermission(
  granted: readonly string[] | undefined,
  required: readonly string[],
): boolean {
  return required.some((r) => hasPermission(granted, r));
}
