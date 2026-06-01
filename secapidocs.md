# Jordan API Context

Generated automatically from live API.

BASE_URL = "http://217.114.46.158"

USERNAME = "api"
PASSWORD = "jordan"
COMPANY = "Jordan"

## Authentication

POST /api/Auth/Apilogin

Returns JWT token as plain text.

Required headers for protected routes:

```
Authorization: Bearer <token>
company: Jordan
```

---

# Entity: Services

Endpoint: `/api/Basic/GetServices`

## Fields

| Field | Type |
|---------|---------|
| srvId | integer |
| srvName | string |
| secName | string |
| sectionId | integer |
| tarriff | float |

## Sample Record

```json
{
  "srvId": -408,
  "srvName": "دریافت / پرداخت",
  "secName": "بخش دريافت / پرداخت",
  "sectionId": -408,
  "tarriff": 0.0
}
```

Total Sample Records Retrieved: 224

---

# Entity: Patients

Endpoint: `/api/Patient/GetAll`

## Fields

| Field | Type |
|---------|---------|
| fullName | string |
| mobile | string |
| patientCode | integer |
| tel | string |
| gender | integer |
| address | string |
| degree | string | null |
| fatherName | string |
| birthDate | string |
| residentCountry | string | null |
| introduction | integer | null |
| job | string |
| isResident | boolean | null |

## Sample Record

```json
{
  "fullName": "حفصه رفیعی",
  "mobile": "09120481053",
  "patientCode": 0,
  "tel": "0",
  "gender": 21,
  "address": "سعادت اباد بلوار فرحزادی خ طاهرخانی برج تماشا",
  "degree": "دیپلم",
  "fatherName": "محمد",
  "birthDate": "1370/11/01",
  "residentCountry": null,
  "introduction": 135,
  "job": "دانشجو",
  "isResident": null
}
```

Total Sample Records Retrieved: 100

---

# Entity: Reserves

Endpoint: `/api/Reserve/GetReserves`

## Fields

| Field | Type |
|---------|---------|
| reserveDate | string |
| reserveTime | string |
| services | null |
| createDate | null |
| createTime | null |
| isAccepted | boolean |
| doctorName | string |

## Sample Record

```json
{
  "reserveDate": "1406/06/01",
  "reserveTime": "19:00",
  "services": null,
  "createDate": null,
  "createTime": null,
  "isAccepted": false,
  "doctorName": " پروسیجر پزشک"
}
```

Total Sample Records Retrieved: 100

---

# Entity: Treatments

Endpoint: `/api/Treatment/GetTreatments`

## Fields

| Field | Type |
|---------|---------|
| treatmentPlanId | string |
| treatmentPlanDate | string |
| treatmentPlanName | string |
| patientCode | integer |
| treatmentPlanUser | string |
| treatmentPlanReasonName | string |
| treatmentPlanDetails | array |
| treatmentPlanDeleted | boolean |

## Sample Record

```json
{
  "treatmentPlanId": "f4c3604f-841e-45ec-af49-00bb48d324e2",
  "treatmentPlanDate": "1405/03/11",
  "treatmentPlanName": "درمانی",
  "patientCode": 119856,
  "treatmentPlanUser": "فرشته سالاروند",
  "treatmentPlanReasonName": "لک صورت و بدن",
  "treatmentPlanDetails": [
    {
      "treatmentPlanDetailsId": "404fb4c0-ccd7-4e1e-bd89-463bf5e9c246",
      "treatmentPlanDetailName": null,
      "treatmentItems": "تشخیص بیماری‌ها و اختلالات پوست Melasma (ملاسما / لک حاملگی)",
      "treatmentItemSrvId": null,
      "isDeleted": false
    },
    {
      "treatmentPlanDetailsId": "5bfd8fd8-64cf-4a7d-a49c-529e2ea329cf",
      "treatmentPlanDetailName": null,
      "treatmentItems": "درمان دارویی داروهای ضد لک و روشن‌کننده پوست Vitamin C (Ascorbic acid serum)",
      "treatmentItemSrvId": null,
      "isDeleted": false
    },
    {
      "treatmentPlanDetailsId": "0486d34d-2058-49b6-8d88-afb16a1d1ad9",
      "treatmentPlanDetailName": null,
      "treatmentItems": "پروسیجر مو PRP",
      "treatmentItemSrvId": null,
      "isDeleted": false
    },
    {
      "treatmentPlanDetailsId": "e8104d15-7324-4447-9644-ecceaf41f28a",
      "treatmentPlanDetailName": null,
      "treatmentItems": "پروسیجر Laser سه هند پیس QC",
      "treatmentItemSrvId": null,
      "isDeleted": false
    }
  ],
  "treatmentPlanDeleted": false
}
```

Total Sample Records Retrieved: 161

## Nested Entity: treatmentPlanDetails

| Field | Type |
|---------|---------|
| treatmentPlanDetailsId | string |
| treatmentPlanDetailName | null |
| treatmentItems | string |
| treatmentItemSrvId | null |
| isDeleted | boolean |

```json
{
  "treatmentPlanDetailsId": "404fb4c0-ccd7-4e1e-bd89-463bf5e9c246",
  "treatmentPlanDetailName": null,
  "treatmentItems": "تشخیص بیماری‌ها و اختلالات پوست Melasma (ملاسما / لک حاملگی)",
  "treatmentItemSrvId": null,
  "isDeleted": false
}
```
