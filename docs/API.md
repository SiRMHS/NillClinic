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
  "source": "instagram",
  "name": "نام",
  "phone": "0912...",
  "external_id": "mc_123",
  "payload": {}
}
```

`source`: `instagram` | `whatsapp` | `site`

## CRM خارجی

مراجعه به [secapidocs.md](../secapidocs.md) — فقط sync-engine مستقیماً صدا می‌زند.
