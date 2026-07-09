# API داخلی — Express (`@jordan/api`)

Base: `http://localhost:4000`

## Health

`GET /health` — بدون auth

## Analytics (auth required)

| Method | Path | Query |
|--------|------|-------|
| GET | `/api/analytics/overview` | `range=24h\|7d\|31d\|all` |
| GET | `/api/analytics/patient-growth` | `range` |
| GET | `/api/analytics/treatment-popularity` | — |
| GET | `/api/analytics/doctor-performance` | — |

پاسخ‌ها مطابق schemaهای `packages/shared/src/schemas/analytics.ts`.

## Sync (auth required)

| Method | Path | Body |
|--------|------|------|
| POST | `/api/sync/run` | — |
| GET | `/api/sync/logs` | `?limit=20` |

## Leads

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/leads` | ✅ |
| POST | `/api/leads` | ✅ |
| PATCH | `/api/leads/:id/status` | ✅ |
| POST | `/api/leads/webhook` | `x-webhook-secret` (بدون JWT) |

### Webhook body (Manychat / n8n)

```json
{
  "source": "instagram_manychat",
  "name": "حسینی",
  "phone": "09124712948",
  "external_id": "877781495",
  "payload": {
    "service": "اندولیفت",
    "ig_username": "massod.hoseini"
  }
}
```

**`source`** — aliasهای پشتیبانی‌شده:

| alias | LeadSource |
|-------|------------|
| `instagram`, `instagram_manychat`, `manychat` | INSTAGRAM |
| `whatsapp`, `whatsapp_n8n`, `n8n` | WHATSAPP |
| `site`, `website`, `web` | SITE |

**`payload`** — آبجکت کلید-مقدار دلخواه. هر مقدار می‌تواند string، number، boolean، array یا object باشد. در `Lead.metadata` ذخیره و در جزئیات لید نمایش داده می‌شود.

مثال با `service` به‌صورت آرایه:

```json
"payload": { "service": ["اندولیفت", "بوتاکس"] }
```

## CRM خارجی

مراجعه به [secapidocs.md](../secapidocs.md) — فقط sync-engine مستقیماً صدا می‌زند.
