# امنیت — Layer 5

## Field-level encryption (PII)

- الگوریتم: **AES-256-GCM**
- کلید: `ENCRYPTION_KEY` — 32 بایت، base64 (`openssl rand -base64 32`)
- فیلدهای DB با پسوند `_enc` — هرگز plaintext PII در PostgreSQL

```typescript
// apps/api/src/security/encryption.ts
createEncryptFn() // sync + lead create
decrypt()       // فقط با مجوز VIEW_PII (فاز بعد)
```

در production بدون `ENCRYPTION_KEY` سرور start نمی‌شود.

## ایزوله‌سازی لیدها

یک لید نام و موبایل کسی است که با کلینیک تماس گرفته، پس «هر کارشناس همه لیدها را
می‌بیند» افشای بزرگ‌تری از چیزی است که به‌نظر می‌رسد. قاعده:

| کلید | چه می‌بیند |
|------|-----------|
| `leads` | فقط لیدهای واگذارشده به خودش + لیدهای **واگذارنشده** (استخر مشترک) |
| `leads.all` | همه لیدها — مخصوص سرپرست فروش |

استخر واگذارنشده عمداً مشترک است: بدون آن، لیدی که از وب‌هوک می‌آید تا وقتی سرپرست
واگذارش نکند برای هیچ کارشناسی دیده نمی‌شود. همین تقسیم‌بندی از قبل در
`/api/leads/counts` (تفکیک `newUnassigned` از `myActive`) فرض شده بود.

قاعده در `lib/lead-scope.ts` یک‌جا تعریف شده و روی **هر دو** مسیری که به لید می‌رسند
اعمال می‌شود: `/api/leads/*` و `/api/campaigns/:id/leads`. دومی قبلاً بی‌محافظ بود و
چون `leads` کلید `campaigns` را هم می‌دهد، یک کارشناس می‌توانست همه لیدهای کلینیک را
کمپین‌به‌کمپین بخواند.

دسترسی به لیدِ دیگری **۴۰۴** می‌گیرد نه ۴۰۳ — یک ۴۰۳ تأیید می‌کند که آن شناسه واقعی
است و اندپوینت را به ابزار شمارش لیدهای کلینیک تبدیل می‌کند.

## نقش‌ها و ارتقای دسترسی

`*` در `ALL_PERMISSION_KEYS` نیست، پس از طریق API قابل اعطا نیست و ساخت نقشِ
مدیرِ سیستم از بیرون ممکن نیست. نقش `superadmin` نه حذف می‌شود و نه **ویرایش** —
ویرایشش قبلاً باز بود و یک PATCH می‌توانست `*` را از تنها نقشی که آن را دارد بردارد
و مدیریت نقش‌ها را برای همیشه قفل کند.

با این حال `settings.roles` عملاً معادل دسترسی کامل است: دارنده‌اش می‌تواند هر کلید
غیر از `*` را به نقش خودش بدهد — از جمله `financial` و `settings.display`. این کلید
را مثل یک کلید مدیریتی بدهید، نه یک کلید معمولی.

## احراز هویت

- **Supabase Auth** — JWT در header `Authorization: Bearer`
- API از JWKS Supabase verify می‌کند (`jose`)
- Dev mode: بدون Supabase، user ساختگی ADMIN

## Audit logs

| Action | زمان |
|--------|------|
| SYNC_MANUAL | POST /api/sync/run |
| LEAD_* | create/update/convert |
| PATIENT_VIEW | مشاهده PII decrypt (فاز بعد) |

## RBAC (برنامه‌ریزی)

| نقش | دسترسی تقریبی |
|-----|----------------|
| ADMIN | همه + sync manual |
| MANAGER | analytics + leads + reports |
| ANALYST | analytics read-only |
| RECEPTION | leads CRUD |
| VIEWER | dashboard aggregates بدون PII |

## Webhook امنیت

`POST /api/leads/webhook` — header `x-webhook-secret` باید با `LEAD_WEBHOOK_SECRET` برابر باشد.
مقایسه در زمان ثابت انجام می‌شود. **اگر `LEAD_WEBHOOK_SECRET` تنظیم نشده باشد این
اندپوینت به همه ۵۰۳ می‌دهد** — قبلاً بررسی را کلاً رد می‌کرد و یک مسیر نوشتن باز روی
اینترنت باقی می‌گذاشت (و `docker-compose.yml` مقدار خالی پاس می‌دهد، پس یک deploy که
متغیر را فراموش کند دقیقاً همان حالت را می‌گرفت).

## چک‌لیست production

- [ ] `ENCRYPTION_KEY` تولید و در secret manager
- [ ] `LEAD_WEBHOOK_SECRET` قوی — مقدارهای کوتاه مثل یک کلمه فارسی/انگلیسی کافی نیست؛
      حداقل ۳۲ کاراکتر تصادفی (`openssl rand -base64 32`)
- [ ] Supabase RLS policies
- [ ] HTTPS only
- [ ] CRM credentials در env، نه repo
