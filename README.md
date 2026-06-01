# کلینیک جردن — داشبورد مدیریتی تحلیلی

Monorepo برای داشبورد فارسی (RTL) کلینیک جردن با سینک CRM، سیستم لید، تحلیل‌های حرفه‌ای و امنیت داده.

## ساختار

```
apps/
  api/          Express + TypeScript (strict)
  web/          Next.js 16 App Router — RTL فارسی
packages/
  db/           Prisma + PostgreSQL
  shared/       Zod schemas مشترک
sync-engine/    Layer 2 — CRM sync
docs/           مستندات فنی (جلوگیری از AI slop)
```

## پیش‌نیاز

- Node.js 20+
- pnpm 10+
- PostgreSQL 16 محلی روی سیستم

## راه‌اندازی سریع

```bash
cp .env.example .env
pnpm install
pnpm db:generate
pnpm db:push
pnpm dev
```

قبل از اجرای `db:push`، سرویس PostgreSQL سیستم را فعال کنید و مطمئن شوید روی `localhost:5432` در دسترس است.

- Web: http://localhost:3000
- API: http://localhost:4000

## لایه‌ها

| لایه | مسیر | توضیح |
|------|------|--------|
| 1 Core Data | `packages/db/prisma` | Patient, Treatment, Reserve, Service, Lead, SyncLog |
| 2 Sync Engine | `sync-engine/` | CRM fetch → map → encrypt → upsert → log |
| 3 Analytics | `apps/api/src/services/analytics.service.ts` | جدا از CRUD |
| 4 Leads | `apps/api/src/routes/leads.routes.ts` | Manychat / n8n webhook |
| 5 Security | `apps/api/src/security/` | AES-256-GCM PII، audit، RBAC، Supabase JWT |

## مستندات

- [معماری](./docs/ARCHITECTURE.md)
- [مدل داده](./docs/DATA_MODEL.md)
- [امنیت](./docs/SECURITY.md)
- [API داخلی](./docs/API.md)
- [CRM خارجی](./secapidocs.md)

## تست

```bash
pnpm test
```

## فازهای بعدی (برنامه‌ریزی شده)

- احراز هویت کامل Supabase در UI
- نمودارهای Recharts با داده زنده
- تسک‌ها و گزارش بین کاربران (RBAC)
