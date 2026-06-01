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

## چک‌لیست production

- [ ] `ENCRYPTION_KEY` تولید و در secret manager
- [ ] `LEAD_WEBHOOK_SECRET` قوی
- [ ] Supabase RLS policies
- [ ] HTTPS only
- [ ] CRM credentials در env، نه repo
