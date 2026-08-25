# Jordan API Context

Generated from live API (Swagger: `/swagger/v1/swagger.json`, OpenAPI 3.0.4, title `JordanWebApi`).

BASE_URL (legacy, used by `sync-engine` default) = `http://217.114.46.158`
BASE_URL (HTTPS domain, same backend) = `https://sld.nilforoushzadeh.clinic`

USERNAME = "api"
PASSWORD = "jordan"
COMPANY = "Jordan"

## Authentication

`POST /api/Auth/Apilogin?username=...&password=...`

Returns JWT token as **plain text** (not JSON). Token claims: `sub` (username), role claim = `Api`, 1-year-ish expiry (`exp`).

⚠️ IIS requires a `Content-Length` header even for an empty body — a bare POST with no body gets `411 Length Required`. Send an explicit empty body (`-d ""` in curl; `fetch` with `Content-Type` header as `sync-engine`'s client already does works fine too).

`POST /api/Auth/ApiHashPassword?password=...` — returns the server-side hash for a given plaintext password. Not currently used by `sync-engine`.

Required headers for all protected routes:

```
Authorization: Bearer <token>
company: Jordan
```

## Hosts

Three base URLs exist in this project's history. They are **not** interchangeable:

| Host | Auth | Services / Reserves / Patients | Receptions |
|---|---|---|---|
| `https://sld.nilforoushzadeh.clinic` | ✅ | ✅ (~2.5s/page) | ✅ (slow, 8-30s) |
| `http://88.218.19.222` | ✅ | ✅ faster (~1.6s/page) | ❌ **connection reset**, HTTP 000 after ~5.5s |
| `http://217.114.46.158` | ❌ dead | — | — |

`JORDAN_API_BASE_URL` must point at the domain: the direct IP drops every reception request, so all financial data is unreachable through it.

## Date format

All `fromdate`/`todate` query params use **Jalali (Shamsi) dates**, format `YYYY/MM/DD` (e.g. `1405/05/19`). Gregorian dates or a missing date param silently return `[]` (HTTP 200, no error) — easy to misdiagnose as "no data" when it is a format mismatch.

## Pagination behaviour — verified per endpoint

Swagger advertises uniform `pageNumber`/`pageSize` paging. Two endpoints ignore it entirely and replay the same payload forever:

| Endpoint | Paging | End-of-data signal |
|---|---|---|
| `Basic/GetServices` | ❌ **ignored** | n/a — single request returns all ~218 |
| `Patient/GetAll` | ✅ honoured | empty array |
| `Reserve/GetReserves` | ✅ honoured | empty array |
| `Reception/GetReceptions` | ✅ honoured | **empty array only** |
| `Treatment/GetTreatments` | ❌ **ignored** | n/a — walk by date window |

Verified: `GetServices` page 1 and page 500 are byte-identical (218 rows each); `GetTreatments` page 1 and page 2 return identical 3.7MB payloads with the same checksum.

## Known quirks

- **`rows.length < pageSize` is NOT end-of-data.** `Reception/GetReceptions` with `pageSize=50` returns 40 rows on page 1 and 36 on page 2 with more pages still to come. Only an empty array terminates a scan. Treating a short page as the end silently truncates the entity.
- **HTTP 200 with a plain-text error body.** Deep or wide reception queries return status 200 whose body is `Execution Timeout Expired. The timeout period elapsed prior to completion of the operation...` — not JSON. A client that trusts the status code will treat this as data, or (worse) as an empty result and therefore as end-of-data. Always parse explicitly and treat a non-JSON body as a retryable server fault.
- **Reception paging degrades sharply with offset.** Over a wide range: page 1 ≈ 18s, page 2 ≈ 31s, page 5+ times out. Constrain by date window (~3 days ≈ 600 rows ≈ one page) instead of paging deep.
- **`Reserve/GetReserves` works without dates**; `Treatment/GetTreatments` and `Reception/GetReceptions` return `[]` unless a Jalali range is supplied.
- **Reserves have no id and no unique natural key.** `(reserveDate, reserveTime, doctorName)` is not unique — a 1000-row sample contained only 836 distinct triples, i.e. 164 rows would overwrite each other, and 566 rows had a null `patientCode`. The sync derives a synthetic `externalKey` from the full identity tuple; see `reserveExternalKey` in [mapping.engine.ts](sync-engine/src/mapping.engine.ts).
- **Nullable-in-practice fields.** The CRM returns `null` (or `""` / `" "`) for fields Swagger declares non-nullable — notably `gender`, `doctorName`, `patientCode`, `receptionNo`, `userName`, `birthDate`. Schemas must tolerate these; rejecting them cost ~6,729 patients and ~2,064 reserves in the previous sync.

## Approximate volumes (measured)

| Entity | Volume |
|---|---|
| Patients | ~121,000 |
| Reserves | ~250,000–300,000 |
| Services | 218 |
| Receptions | ~50–250/day, data from ~1400 onward |
| Treatments | sparse; ~3,000 over 17 months |

---

# Lookup / Reference entities

## GenderType

`GET /api/Basic/GenderType`

| Field | Type |
|---|---|
| id | integer |
| description | string |

```json
[{ "id": 20, "description": "مرد" }, { "id": 21, "description": "زن" }]
```

## MaritalType

`GET /api/Basic/MaritalType`

| Field | Type |
|---|---|
| id | integer |
| description | string |

```json
[{ "id": 18, "description": "متاهل" }, { "id": 19, "description": "مجرد" }]
```

## IntroductionType

`GET /api/Basic/IntroductionType`

Referenced by `Patient.introduction`.

| Field | Type |
|---|---|
| id | integer |
| description | string |

```json
[
  { "id": 132, "description": "اینستاگرام" },
  { "id": 133, "description": "وب سایت" },
  { "id": 134, "description": "تلویزیون" },
  { "id": 135, "description": "دوستان و آشنایان" },
  { "id": 136, "description": "سایر" }
]
```

---

# Entity: Services

Endpoint: `GET /api/Basic/GetServices`

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

Endpoint: `GET /api/Patient/GetAll`

Query: `pageNumber` (default 1), `pageSize` (default 100). No date filter.

## Fields

| Field | Type |
|---------|---------|
| fullName | string |
| mobile | string |
| patientCode | integer |
| tel | string |
| gender | integer (→ GenderType.id) |
| address | string |
| degree | string \| null |
| fatherName | string |
| birthDate | string (Jalali `YYYY/MM/DD`) |
| residentCountry | string \| null |
| introduction | integer \| null (→ IntroductionType.id) |
| job | string |
| isResident | boolean \| null |

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

# Entity: Receptions

Endpoint: `GET /api/Reception/GetReceptions`

Query: `fromdate`, `todate` (Jalali, **required** for non-empty results), `pageNumber`, `pageSize` (default 1 / 100).

## Fields

| Field | Type |
|---------|---------|
| receptionDate | string (Jalali) |
| receptionId | integer |
| receptionNo | integer |
| patientNo | integer |
| isReturn | boolean |
| receptionDescription | string |
| treatmentItemNames | string |
| userName | string (staff who registered the reception) |
| receptionDetailDtos | array |

## Sample Record

```json
{
  "receptionDate": "1405/05/19",
  "receptionId": 453726,
  "receptionNo": 20018,
  "patientNo": 110650,
  "isReturn": false,
  "receptionDescription": "کیوسک",
  "treatmentItemNames": "خشکی پوست",
  "userName": "صندوق کیوسک 1",
  "receptionDetailDtos": [
    {
      "secId": 10,
      "srvId": 4,
      "secName": "عمومی",
      "srvName": "ویزیت",
      "receptionPersonnelName": "معصومه محمدی",
      "receivedPrice": 5000000.00,
      "remainPrice": 0.00,
      "discount": 0.00,
      "depositPrice": 0
    }
  ]
}
```

## Nested Entity: receptionDetailDtos

| Field | Type |
|---|---|
| secId | integer (→ Services.sectionId) |
| srvId | integer (→ Services.srvId) |
| secName | string |
| srvName | string |
| receptionPersonnelName | string |
| receivedPrice | float |
| remainPrice | float |
| discount | float |
| depositPrice | float |

---

# Entity: Reserves

Endpoint: `GET /api/Reserve/GetReserves`

Query: `fromdate`, `todate` (Jalali, **required** for non-empty results), `pageNumber`, `pageSize`.

## Fields

| Field | Type |
|---------|---------|
| reserveDate | string (Jalali) |
| reserveTime | string (`HH:mm`) |
| services | string (comma-separated service names) |
| createDate | string (Jalali) |
| createTime | string (`HH:mm`) |
| isAccepted | boolean |
| doctorName | string |
| patientName | string |
| patientCode | integer |
| patientMobile | string |

Note: earlier sampling only observed `services`/`createDate`/`createTime` as `null`, which understated the schema — they're populated strings on records that have a booked service / creation audit trail.

## Sample Record

```json
{
  "reserveDate": "1405/05/20",
  "reserveTime": "18:30",
  "services": "ویزیت مجدد,",
  "createDate": "1405/05/20",
  "createTime": "17:15",
  "isAccepted": false,
  "doctorName": " پروسیجر پزشک",
  "patientName": "شادی F صمدیان",
  "patientCode": 102287,
  "patientMobile": "09122271754"
}
```

Total Sample Records Retrieved: 100

---

# Entity: Treatments

Endpoint: `GET /api/Treatment/GetTreatments`

Query: `fromdate`, `todate` (Jalali, **required** for non-empty results), `pageNumber`, `pageSize` (⚠️ **ignored server-side**, see Known quirks).

## Fields

| Field | Type |
|---------|---------|
| treatmentPlanId | string (guid) |
| treatmentPlanDate | string (Jalali) |
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
    }
  ],
  "treatmentPlanDeleted": false
}
```

Total Sample Records Retrieved: 161

## Nested Entity: treatmentPlanDetails

| Field | Type |
|---------|---------|
| treatmentPlanDetailsId | string (guid) |
| treatmentPlanDetailName | string \| null (observed always `null` so far) |
| treatmentItems | string |
| treatmentItemSrvId | integer \| null (observed always `null` so far — no reliable FK to Services) |
| isDeleted | boolean |
