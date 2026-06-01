# مدل داده — Layer 1

## موجودیت‌های CRM (سینک‌شده)

### Patient

| فیلد DB | منبع CRM | رمزنگاری |
|---------|----------|----------|
| externalCode | patientCode | — |
| fullNameEnc | fullName | ✅ |
| mobileEnc | mobile | ✅ |
| telEnc | tel | ✅ |
| addressEnc | address | ✅ |
| fatherNameEnc | fatherName | ✅ |
| gender, degree, birthDate, job, ... | همان نام CRM | — |

### Service

نگاشت مستقیم از `srvId`, `srvName`, `secName`, `sectionId`, `tarriff`.

### Reserve

`reserveDate`, `reserveTime`, `doctorName`, `isAccepted` — بدون PII مستقیم.  
توجه: API فعلاً patientCode در Reserve ندارد؛ لینک بیمار در فاز بعد.

### Treatment

`externalId` = `treatmentPlanId`  
`detailsJson` = آرایه `treatmentPlanDetails`  
`planUser` = پزشک/اپراتور برای analytics عملکرد پزشک

## Lead (Layer 4)

```typescript
Lead {
  source: INSTAGRAM | WHATSAPP | SITE | MANUAL
  status: NEW | CONTACTED | CONVERTED | LOST
  metadata: JSON  // payload خام Manychat/n8n
  convertedPatientId?: FK → Patient
}
```

## SyncLog (Layer 2)

هر اجرای sync یک رکورد با `entity`, `status`, `trigger` (CRON|MANUAL), شمارنده‌ها.

## User + RBAC

`email` یکتا — نقش‌ها: ADMIN, MANAGER, ANALYST, RECEPTION, VIEWER.

## ایندکس‌های پیشنهادی

موجود در schema — برای analytics روی `planUser`, `reserveDate`, `lead.status`.
