# API داخلی — Express (`@jordan/api`)

Base: `http://localhost:4000`

## Health

`GET /health` — بدون auth

## احراز هویت و CSRF

نشست در کوکی httpOnly به نام `jc_session` است و مرورگر خودش آن را می‌فرستد.
هر درخواست تغییردهنده (غیر از GET/HEAD/OPTIONS) که با کوکی احراز شود باید مقدار
کوکی خوانا `jc_csrf` را در هدر `X-CSRF-Token` تکرار کند؛ در غیر این صورت پاسخ
`403` با پیام «درخواست نامعتبر است (CSRF)» است. درخواست‌های
`Authorization: Bearer` از این قاعده معاف‌اند.

* `POST /api/auth/login` — توکن CSRF را در بدنه هم برمی‌گرداند.
* اگر داشبورد و API روی دو هاستِ یک دامنه باشند (`dash.example.com` و
  `api.example.com`)، کوکی `jc_csrf` فقط برای هاست API معتبر است: مرورگر آن را
  می‌فرستد ولی صفحه‌ی داشبورد نمی‌تواند بخواندش. کلاینت در این حالت توکن را از
  `GET /api/auth/csrf` می‌گیرد و همه چیز بدون تغییر زیرساخت کار می‌کند.
* متغیر `COOKIE_DOMAIN` وجود دارد ولی **توصیه نمی‌شود** و پیش‌فرض خاموش است.
  ست‌کردنش توکن CSRF را برای همه‌ی ساب‌دامنه‌های آن دامنه خوانا می‌کند؛ اگر روی
  یکی از آن‌ها اپ شخص ثالثی نشسته باشد (مثل یک CRM پروکسی‌شده)، یک صفحه‌ی مخرب
  آنجا می‌تواند از نشست داشبورد درخواست جعل کند — چون ساب‌دامنه‌های هم‌دامنه
  same-site حساب می‌شوند و کوکی نشست هم ضمیمه می‌شود. فقط وقتی سراغش بروید که
  کلاینت قدیمی‌ای دارید که مسیر بالا را نمی‌شناسد.
* متغیر `CSRF_DISABLED=true` روی API این چک را کاملاً خاموش می‌کند. فقط برای
  رفع موقتی مشکل است: با خاموش‌بودنش هر صفحه‌ای که کاربرِ واردشده باز کند
  می‌تواند از طرف او درخواست تغییردهنده بفرستد، چون کوکی نشست را خود مرورگر
  ضمیمه می‌کند و دیگر چیزی ثابت نمی‌کند درخواست از داشبورد آمده. API موقع بالا
  آمدن در لاگ هشدار می‌دهد.
* `GET /api/auth/csrf` (auth لازم) — توکن CSRF نشست جاری را برمی‌گرداند و اگر
  کوکی‌اش موجود نباشد دوباره صادر می‌کند. برای وقتی است که صفحه نمی‌تواند کوکی را
  با `document.cookie` بخواند (مثلاً API روی هاست/ساب‌دامنه‌ای غیر از صفحه است):
  مرورگر کوکی را می‌فرستد ولی جاوااسکریپت آن را نمی‌بیند و بدون این مسیر هیچ
  درخواست تغییردهنده‌ای از کار در نمی‌آید. کلاینت وب توکن را نگه می‌دارد و در صورت
  دریافت ۴۰۳ یک بار با توکن تازه دوباره تلاش می‌کند.

## دسترسی‌ها (RBAC)

هر مسیر به یک «کلید دسترسی» گره خورده است. فهرست کامل کلیدها در
`apps/api/src/lib/permissions.ts` تعریف می‌شود و از `GET /api/admin/permissions`
هم قابل خواندن است؛ همان فهرست، چک‌باکس‌های صفحه مدیریت نقش‌ها را می‌سازد.

قواعد:

* `*` کلید مدیر سیستم است و همه چیز را باز می‌کند. API آن را به عنوان ورودی
  نمی‌پذیرد؛ فقط نقش seed شده `superadmin` آن را دارد.
* بعضی کلیدها کلیدهای ریزتر را هم می‌دهند (`analytics` → `analytics.medical`،
  `financial` → `financial.patients`، `settings` → `settings.leads-log` و …).
  نگاشت کامل در همان فایل، در `PERMISSION_IMPLIES`.
* **مالی جدا از گزارش است**: `analytics` هیچ‌وقت `financial` را نمی‌دهد. نقشی که
  باید آمار مراجعه را ببیند ولی مبالغ را نه، فقط `analytics` می‌گیرد.
* `/api/auth/me` فهرست **بسط‌داده‌شده** را برمی‌گرداند تا کلاینت فقط `includes`
  بزند و نگاشت بالا دو جا نگهداری نشود.
* مجوزها در هر درخواست از دیتابیس خوانده می‌شوند (کش ۳۰ ثانیه‌ای)، پس تغییر
  دسترسی یک نقش بدون خروج و ورود دوباره اعمال می‌شود.

| گروه | کلیدها |
|------|--------|
| اصلی | `dashboard` |
| بیماران | `patients.view`, `patients` |
| فروش | `leads`, `leads.assign`, `leads.delete`, `campaigns` |
| گزارشات | `analytics`, `analytics.medical`, `analytics.doctors`, `crm`, `crm.desk`, `crm.desk.manage`, `reports.doctors`, `reports.referrals`, `reports.export` |
| مالی | `financial`, `financial.patients`, `financial.tiers`, `financial.export`, `financial.recompute` |
| سینک | `sync`, `sync.run`, `sync.settings`, `sync.purge` |
| سیستم | `settings`, `settings.users`, `settings.roles`, `settings.login-log`, `settings.webhook-logs`, `settings.external-migration`, `settings.leads-log`, `settings.leads-bank`, `settings.telephony`, `settings.display` |

## Analytics (auth required، مجوز `analytics`)

| Method | Path | Query |
|--------|------|-------|
| GET | `/api/analytics/overview` | `range=24h\|7d\|31d\|all` |
| GET | `/api/analytics/patient-growth` | `range` |
| GET | `/api/analytics/medical-matrix` | — (مجوز `analytics.medical`) |
| GET | `/api/analytics/acquisition-channels` | — |
| GET | `/api/analytics/demographic-value` | — |
| GET | `/api/analytics/cohorts` | `limit` (پیش‌فرض ۲۴، سقف ۱۲۰) |
| GET | `/api/analytics/booking-follow-through` | `from`, `to` |
| GET | `/api/analytics/treatment-plan-coverage` | — (مجوز `analytics.medical`) |
| GET | `/api/analytics/doctor-detail/:name` | — (مجوز `analytics.doctors`) |
| GET | `/api/analytics/crm/patients` | — (مجوز `crm`) |

پاسخ‌ها مطابق schemaهای `packages/shared/src/schemas/analytics.ts`.

سرویس‌ها و پزشکان با مبنای پذیرش (شامل درآمد، نرخ تبدیل و نرخ مراجعه مجدد) از
`/api/visitors/services` و `/api/visitors/doctors` می‌آیند.

`/api/visitors/*` کلید مستقل ندارد: پنل‌های چند بخش را تغذیه می‌کند، پس با هر یک
از `dashboard`، `analytics`، `crm`، `financial.patients`، `financial.tiers` یا
`reports.referrals` باز می‌شود.

## Financial (auth required، مجوز `financial`)

همه مبالغ به ریال. مبنای محاسبه `reception_items` است (سطرهای مالی پذیرش).
`from` و `to` اختیاری‌اند و تاریخ **شمسی** `YYYY/MM/DD` می‌گیرند.

| Method | Path | Query |
|--------|------|-------|
| GET | `/api/financial/summary` | `from`, `to` |
| GET | `/api/financial/trend` | `from`, `to`, `granularity=day\|month\|year` |
| GET | `/api/financial/by-service` | `from`, `to`, `limit` |
| GET | `/api/financial/by-section` | `from`, `to` |
| GET | `/api/financial/by-personnel` | `from`, `to`, `limit` |

## رتبه‌بندی بیماران — RFM (auth required، مجوز `financial.patients`)

| Method | Path | Query |
|--------|------|-------|
| GET | `/api/financial/patients/ranking` | `limit`, `offset`, `segment`, `tier`, `sort=rfm\|revenue\|visits\|recency\|tier`, `search` |
| GET | `/api/financial/patients/segments` | — |
| POST | `/api/financial/patients/ranking/recompute` | — (مجوز `financial.recompute`) |

**R** و **F** با آستانه مطلق سنجیده می‌شوند، فقط **M** پنجک جمعیت است.
R: ≤۹۰ روز=۵، ≤۱۸۰=۴، ≤۳۶۵=۳، ≤۷۳۰=۲، بیشتر=۱.  F: ۱=۱، ۲=۲، ۳-۴=۳، ۵-۹=۴، ۱۰+=۵.

نسبی‌سنجیدن تازگی روی این داده غلط بود: چون ~۷۰٪ بیماران بیش از دو سال مراجعه نکرده‌اند،
«یک‌پنجم برتر» تا ۲٫۸ سال قدمت داشت و نیمی از «بیماران ویژه» بیش از یک سال غایب بودند.
ضمناً NTILE گره‌ها را می‌شکست: ۵۳ هزار بیمارِ تک‌مراجعه امتیاز ۱ تا ۳ می‌گرفتند.
سگمنت‌ها: `CHAMPION` (ویژه)، `LOYAL` (وفادار)، `POTENTIAL` (مستعد رشد)، `NEW` (تازه‌وارد)، `AT_RISK` (در خطر ریزش)، `DORMANT` (خفته)، `LOST` (از دست رفته).

فقط بیمارانی رتبه می‌گیرند که حداقل یک پذیرش مالی داشته باشند. چون امتیازها نسبی‌اند، `recompute` باید **پس از هر سینک** اجرا شود، نه در هر درخواست.

## رتبه ارزش بیماران — Tiers (auth required، مجوز `financial.tiers`)

رتبه ارزش بر پایه **مجموع پرداختی مادام‌العمر** است و از سگمنت رفتاری RFM جداست:
یک بیمار می‌تواند هم‌زمان `PLATINUM` و `AT_RISK` باشد — و دقیقاً همین ترکیب ارزش پیگیری دارد.

| Method | Path | Query / Body |
|--------|------|--------------|
| GET | `/api/reports/tiers/summary` | — |
| GET | `/api/reports/tiers/settings` | — |
| PUT | `/api/reports/tiers/settings` | `{ platinumMin, goldMin, silverMin, bronzeMin }` — ذخیره + بازمحاسبه همه بیماران |
| PATCH | `/api/visitors/patient/:externalCode/vip` | `{ vipFlag: "VIP" \| "CELEBRITY" \| null, note? }` — مجوز `patients.vip` |
| GET | `/api/reports/tiers/activity` | `tiers`, `kind=RECEPTION\|RESERVE`, `upcomingOnly`, `from`, `to`, `doctor`, `search`, `limit`, `offset` |
| GET | `/api/reports/tiers/activity/stats` | `tiers` |
| GET | `/api/reports/tiers/activity/export` | همان فیلترها → CSV |

رتبه‌ها: `PLATINUM` (پلاتینیوم)، `GOLD` (طلایی)، `SILVER` (نقره‌ای)، `BRONZE` (برنز)، `GRAY` (خاکستری).
آستانه‌ها ریالی و **مطلق**‌اند، نه صدکی — تا رتبه یک بیمار با خرجِ بقیه تغییر نکند.

پیش‌فرض‌ها باندهای خودِ کلینیک‌اند. کلینیک آن‌ها را به **تومان** می‌گوید و همه‌جای سیستم
مبالغ به **ریال** ذخیره می‌شود، پس هر عدد ×۱۰ نگهداری می‌شود
(`tomanToRial` / `rialToToman` در `@jordan/shared`، و فرم تنظیمات هم به تومان ورودی می‌گیرد):

| رتبه | آستانه (تومان) | ذخیره‌شده (ریال) |
|------|----------------|------------------|
| `PLATINUM` | بالای ۱ میلیارد | ۱۰٬۰۰۰٬۰۰۰٬۰۰۰ |
| `GOLD` | ۶۰۰ میلیون تا ۱ میلیارد | ۶٬۰۰۰٬۰۰۰٬۰۰۰ |
| `SILVER` | ۳۰۰ تا ۶۰۰ میلیون | ۳٬۰۰۰٬۰۰۰٬۰۰۰ |
| `BRONZE` | ۱۰۰ تا ۳۰۰ میلیون | ۱٬۰۰۰٬۰۰۰٬۰۰۰ |
| `GRAY` | کمتر از ۱۰۰ میلیون | — |

`GRAY` دیگر فقط «بدون پرداخت» نیست: هر بیمار زیر آستانه برنز — از جمله بیماران با
مجموع منفی (فقط عودت) — در این رتبه می‌افتد.

**رتبه ویژه دستی.** `VIP` و `CELEBRITY` را یک نفر تعیین می‌کند، نه خرج بیمار؛ هیچ‌کدام
در CRM مبدأ وجود ندارند و از مبلغ پرداختی هم مشتق نمی‌شوند. بیمار پرچم‌دار مستقل از
آستانه‌ها `PLATINUM` می‌شود و بازمحاسبه هرگز او را پایین نمی‌آورد. پرچم روی `patients`
ذخیره می‌شود (نه در `patient_metrics` که بعد از هر سینک بازساخته می‌شود) و تغییر آن رتبه
همان بیمار را بی‌درنگ دوباره حساب می‌کند.

`activity` پذیرش‌های انجام‌شده و نوبت‌های رزروشده را در یک جریان می‌آورد و نوبت‌های پیش‌رو
را اول فهرست می‌گذارد — تنها ردیف‌هایی که هنوز می‌شود رویشان کاری کرد.

## گزارش پزشکان و ارجاع (auth required، مجوز `reports.doctors` / `reports.referrals`)

خروجی‌های اکسل این بخش جداگانه به `reports.export` نیاز دارند (و خروجی‌های حاوی مبلغ به `financial.export`).

| Method | Path | Query |
|--------|------|-------|
| GET | `/api/reports/doctors` | `from`, `to` |
| GET | `/api/reports/doctors/report` | `from`, `to`, `doctors`, `tier`, `serviceKind=all\|consultation\|treatment`, `sort`, `direction`, `limit` |
| GET | `/api/reports/doctors/trend` | `doctor` (الزامی)، `from`, `to`, `granularity=day\|month\|year` |
| GET | `/api/reports/doctors/report/export` | همان فیلترها → CSV خام |
| GET | `/api/reports/doctors/report/export.xlsx` | همان فیلترها → فایل اکسل قالب‌بندی‌شده |
| GET | `/api/reports/referrals` | `consultingDoctor`, `treatingDoctors`, `from`, `to`, `tier`, `sort`, `direction`, `limit`, `offset`, `search` |
| GET | `/api/reports/referrals/export` | همان فیلترها → CSV |
| GET | `/api/reports/patients/ranking/export` | فیلترهای رتبه‌بندی → CSV |

**دو خروجی، برای دو خواننده.** `export` همان CSV تخت است برای کسی که خودش می‌خواهد
pivot بگیرد. `export.xlsx` گزارش را به‌عنوان *سند* می‌دهد: چهار شیت (خلاصه، رتبه‌بندی
پزشکان، تفکیک مشاوره و ویزیت، تبدیل به خدمت)، سربرگ تیره با عنوان، بازه تاریخ زیر آن، سطر هدر با
پس‌زمینه خاکستری، ستون‌های با عرض ثابت، قالب عددی `#,##0` برای ریال و `0.0%` برای
سهم، سطر «جمع»، فریز سطر هدر و جهت راست‌به‌چپ. ساختار در `lib/xlsx.ts` تعریف شده تا
هر گزارش بعدی هم همان شکل را داشته باشد.

ستون‌های مالی در xlsx هم مثل CSV با روشن‌بودن «مخفی کردن ارقام مالی» **حذف** می‌شوند
(نه خالی)، و شیت خلاصه هم سطرهای مالی‌اش را از دست می‌دهد.

**سه‌گانه مشاوره / ویزیت / خدمت:** خطی که نامش «مشاوره» یا «ویزیت» است راه *ورود* است —
بیمار دیده شده و هنوز کاری انجام نشده — و هر خط دیگری «خدمت» است، همان کلمه‌ای که کاتالوگ
و فاکتور به کار می‌برند. تا پیش از این ویزیت سمت «درمان» می‌افتاد، یعنی پرتکرارترین خط
کلینیک (~۳۶ هزار) به‌عنوان کار انجام‌شده شمرده می‌شد. ویزیت حالا کلاس خودش است و کنار
مشاوره گزارش می‌شود، چون «چند درصد از ویزیت‌ها به خدمت رسید» سؤال دیگری است از همان
سؤال درباره مشاوره. فیلتر `serviceKind` مقدارهای `all|consultation|visit|service` را
می‌گیرد؛ `treatment` قدیمی هم پذیرفته می‌شود و به `service` نگاشت می‌شود تا لینک‌های
ذخیره‌شده ۴۰۰ نگیرند.

**`entryConversion`:** به ازای هر خدمتِ ورودی (مشاوره زیبایی، ویزیت، ویزیت مجدد …) تعداد
بیمار، چند نفرشان به خدمت رسیدند و درآمد آن خدمت‌ها. بیمار وقتی «تبدیل‌شده» شمرده می‌شود
که در روز مشاوره/ویزیت یا بعد از آن، خدمتی *در کل کلینیک* گرفته باشد — نه لزوماً از همان
پزشک، وگرنه ارجاع درون‌کلینیکی به‌عنوان شکست امتیاز می‌خورد. این جدول عمداً از فیلتر
`serviceKind` پیروی نمی‌کند: آن فیلتر یا صورت کسر را حذف می‌کند یا مخرج را.

**کدام ستون «پزشک» است:** `receptions.user_name` کاربر پذیرش است نه پزشک. پزشکِ واقعی
`reception_items.personnel_name` است — که پول هم همان‌جاست. همه گزارش‌های اینجا روی همان می‌روند.

**نام‌های چندتایی:** حدود ۱۳۰۰ ردیف دو پزشک را با ویرگول عربی کنار هم دارند
(`محمد علی نیلفروش زاده، فرناز محسن پور`). گروه‌بندی روی ستون خام، یک «پزشک» جعلی به نام
هر دو می‌سازد و آن ردیف را از سهم هر دو پزشک واقعی حذف می‌کند؛ پس نام‌ها split می‌شوند.
در نتیجه یک خدمت مشترک برای هر دو شمرده می‌شود و جمع ستون درآمد کمی از درآمد کل بیشتر است —
تعداد این ردیف‌ها در `sharedLineCount` گزارش می‌شود.

**تعریف ارجاع:** بیمار حداقل یک خط *مشاوره* با پزشک مبدأ دارد، و حداقل یک خط *درمان*
(غیرمشاوره) در همان روز یا بعد از آن، به نام پزشکی دیگر. شرط ترتیب تاریخ حیاتی است:
بدون آن، بیماری که سال‌ها قبل نزد پزشک دیگری درمان شده و تازه بعداً مشاوره گرفته هم
«ارجاع» شمرده می‌شود، که جهت جریان را برعکس اندازه می‌گیرد. بازه تاریخی *مشاوره* را
محدود می‌کند نه درمان را — وگرنه دقیقاً همان موردی که گزارش برایش ساخته شده
(مشاوره این ماه، درمان ماه بعد) حذف می‌شود.

**خروجی CSV:** با BOM یونیکد تا اکسل ویندوز فارسی را درست بخواند، و سلول‌هایی که با
`=`، `+`، `-` یا `@` شروع می‌شوند با tab محافظت می‌شوند تا اکسل آن‌ها را فرمول اجرا نکند.
خروجی همیشه کل مجموعه فیلترشده است (سقف ۵۰۰ ردیف)، نه فقط صفحه روی صفحه‌نمایش.

## میز CRM — تماس و نظرسنجی (auth required، مجوز `crm.desk`)

جایگزین فایل اکسل CRM کلینیک. هر ردیف یک **تماس** با بیمار است: تماس فالوآپ بعد از
مراجعه، پاسخ نظرسنجی پیامکی، مشاوره کاشت، پیگیری رنوویون، یا نارضایتی ثبت‌شده در پذیرش.

| Method | Path | Query / Body |
|--------|------|--------------|
| GET | `/api/crm-desk/meta` | — برچسب همه enumها + فهرست پزشکان + `serviceCatalogue` (خدمات کلینیک به تفکیک بخش) |
| GET | `/api/crm-desk/contacts` | `kind`, `from`, `to`, `doctorName`, `referredDoctorName`, `serviceName`, `callResult`, `segment`, `search`, `page`, `pageSize` |
| POST | `/api/crm-desk/contacts` | بدنه‌ی `crmContactInputSchema` |
| GET | `/api/crm-desk/contacts/:id` | — |
| PATCH | `/api/crm-desk/contacts/:id` | همان بدنه، به‌صورت partial |
| DELETE | `/api/crm-desk/contacts/:id` | — |
| GET | `/api/crm-desk/contacts/export` | همان فیلترها → CSV |
| GET | `/api/crm-desk/kpi` | `from`, `to`, `kind` |
| GET | `/api/crm-desk/doctor-scores` | `from`, `to`, `kind` |
| GET | `/api/crm-desk/doctor-scores/export` | همان فیلترها → CSV |
| GET | `/api/crm-desk/referrals` | `from`, `to`, `kind` — ارجاع پس از مشاوره بر پایه تماس‌های میز CRM |
| GET | `/api/crm-desk/referrals/export` | همان فیلترها → CSV |
| GET | `/api/crm-desk/schedule` | — روزهای حضور پزشکان |
| PUT | `/api/crm-desk/schedule` | `{ entries: [{ doctorName, weekday, note }] }` — کل جدول یکجا |
| GET | `/api/crm-desk/schedule/export` | — جدول هفتگی به شکل گرید → CSV |
| GET | `/api/crm-desk/import/contacts/template` | — قالب خالی ورود تماس‌ها → CSV |
| GET | `/api/crm-desk/import/schedule/template` | — قالب خالی برنامه هفتگی → CSV |
| POST | `/api/crm-desk/import/contacts/preview` | `{ csv }` → گزارش سطر‌به‌سطر، بدون نوشتن |
| POST | `/api/crm-desk/import/contacts/commit` | `{ csv }` → ثبت سطرهای معتبر |
| POST | `/api/crm-desk/import/schedule/preview` | `{ csv }` → گزارش سطر‌به‌سطر، بدون نوشتن |
| POST | `/api/crm-desk/import/schedule/commit` | `{ csv, mode: "merge" \| "replace" }` |

**خدمات انتخابی، نه متن آزاد.** `serviceNames` و `treatmentServiceNames` از `serviceCatalogue`
(همان جدول `services` سینک‌شده) انتخاب می‌شوند، پس یک خدمت در میز CRM و در خط پذیرش یک نام
دارد و قابل گروه‌بندی است. `serviceName` به‌عنوان تنها شکل متنیِ قابل جستجو و قابل خروجی
باقی می‌ماند و از روی `serviceNames` نوشته می‌شود، تا این دو هرگز از هم جدا نیفتند؛ ردیف‌های
قدیمی که فقط متن دارند هم دست‌نخورده می‌مانند.

**ارجاع پس از مشاوره.** `referredDoctorName` (به چه پزشکی ارجاع شد)، `treatmentDoctorName`
(درمان را چه کسی انجام داد)، `treatmentServiceNames` (چه خدمتی گرفته شد) و `treatmentDate`.
دو فیلد اول عمداً جدا هستند: ارجاع همیشه همان‌جایی نمی‌نشیند که فرستاده شده. سگمنت‌های
`referred` و `referred-pending` روی `/contacts` همین را فیلتر می‌کنند.

این گزارش از `/api/reports/referrals` جداست: آن یکی همین مسیر را از خطوط صورتحساب
بازسازی می‌کند و روی مبالغ معتبر است ولی ارجاعی را که به فاکتور نرسیده نمی‌بیند — و
دقیقاً همان‌ها هستند که باید پیگیری شوند. این یکی ثبت خودِ میز CRM است و مبلغ ندارد.

**ورود از فایل، دو مرحله‌ای:** `preview` فقط فایل را می‌خواند و برای هر سطر خطا و هشدار
برمی‌گرداند؛ `commit` همان متن را دوباره در سرور پارس می‌کند و فقط سطرهای معتبر را ثبت
می‌کند — یعنی مرورگر تصمیم نمی‌گیرد چه چیزی ذخیره شود. سقف هر بارگذاری ۶۰۰۰ سطر و
۱۲ مگابایت است. ستون‌های محاسباتی (`رضایت کلی`، `ریسک ریزش`، `امتیاز وفاداری`،
`شاخص NPS`) در ورودی نادیده گرفته می‌شوند چون از روی امتیازها ساخته می‌شوند.

**یک جدول به‌جای یک شیت در ماه:** اکسل برای هر ماه یک شیت تازه می‌ساخت با همان ستون‌ها.
اینجا `kind` + `contactDate` همان تفکیک را می‌دهد بدون اینکه ماه بعد یک تغییر schema باشد.

**امتیازها محاسبه‌شده‌اند، نه ذخیره‌شده:** `satisfaction`، `npsBucket`، `churnRisk`،
`riskLevel` و `loyalty` در سرور از روی ستون‌های خام ساخته می‌شوند، تا جدول، خروجی CSV و
کاشی‌های KPI نتوانند سر یک عدد با هم اختلاف پیدا کنند.

- **رضایت** میانگین پنج بُعد پرشده است (خالی‌ها شمرده نمی‌شوند، نه صفر حساب می‌شوند —
  وگرنه یک تماس بی‌پاسخ امتیاز پزشک را پایین می‌کشد).
- **NPS** استاندارد: درصد مروج منهای درصد منتقد، بر پایه «احتمال معرفی به دیگران».
- **ریسک ریزش** ترکیب ۶۰/۴۰ از «احتمال مراجعه مجدد» و رضایت اندازه‌گیری‌شده — بیماری که
  همه‌چیز را «عالی» داده ولی می‌گوید برنمی‌گردد هم پرریسک است.
- **وفاداری** نیمی از کیفیت مراجعه، نیمی از آنچه بیمار می‌گوید بعداً می‌کند.

**فیلترهای `segment`:** `risky`، `unanswered`، `rebook`، `promoters`، `detractors`.
سه‌تای اول در SQL اعمال می‌شوند؛ بقیه چون به امتیاز محاسبه‌شده وابسته‌اند بعد از کوئری
فیلتر می‌شوند — تا تعریف امتیاز در دو جا (TypeScript و یک درخت CASE در SQL) تکرار نشود.

**ورود اکسل CRM — راه معمول:** `scripts/crm-workbook-to-csv.py "فایل.xlsx" ./out`
دو فایل `تماس-CRM.csv` و `برنامه-هفتگی-پزشکان.csv` می‌سازد که از «ورود از فایل» در
صفحه CRM بالا می‌روند — با پیش‌نمایش، هشدار سطر به سطر و همان دسترسی
`crm.desk.manage`. خواندن خود اکسل در `scripts/crm_workbook.py` است و بین این
اسکریپت و اسکریپت JSON مشترک؛ شیت‌های فالوآپ خودکار پیدا می‌شوند، پس ماه جدید
نیازی به تغییر کد ندارد.

**ورود داده تاریخی (backfill مستقیم):** `scripts/crm-workbook-to-json.py` فایل اکسل
را می‌خواند و `scripts/import-crm-workbook.ts` آن را وارد دیتابیس می‌کند. اجرای دوباره
امن است: ردیف‌های واردشده (آن‌هایی که `created_by_id` ندارند) اول پاک می‌شوند، پس
import دوم جایگزین می‌شود نه اضافه. چیزی که کاربران در خود برنامه ثبت کرده‌اند دست
نمی‌خورد.

## تنظیمات نمایش (auth required)

سه کلید سراسری که تعیین می‌کنند چه ارقامی اصلاً روی سایت نشان داده شوند. این محور
جدا از RBAC است: دسترسی می‌گوید چه کسی وارد کدام بخش می‌شود، این کلیدها می‌گویند
داخل همان بخش چه ستون‌هایی دیده شوند — برای وقتی که کارشناس باید در CRM کار کند
ولی نباید مبلغ پرداختی بیمار را ببیند.

| Method | Path | Body |
|--------|------|------|
| GET | `/api/display` | — هر کاربر واردشده (هر صفحه قبل از رندر لازمش دارد) |
| PUT | `/api/display` | `{ hideAmounts?, hideCrmAmounts?, hideCrmRates? }` — مجوز `settings.display` |

- `hideAmounts` — همه ارقام مالی در کل سایت.
- `hideCrmAmounts` — فقط در میز CRM و تحلیل مراجعین.
- `hideCrmRates` — نرخ‌ها و درصدهای بخش CRM.

**مخفی‌سازی در سرور انجام می‌شود، نه در مرورگر:** مقادیر پنهان در پاسخ `null`
می‌شوند و ستون متناظر از فایل CSV **حذف** می‌شود (نه خالی)، پس کاربر از طریق
DevTools یا خروجی اکسل هم به عدد نمی‌رسد.

**دامنه: کل `/api`.** ماسک به‌صورت میدل‌ور یک‌جا روی `/api` سوار است
(`middleware/display.middleware.ts`)، نه روی تک‌تک روت‌ها. قبلاً هر روت خودش
ماسک را صدا می‌زد: دو روتر این کار را می‌کردند و پانزده‌تا نه — یعنی با روشن‌بودن
«مخفی کردن همه ارقام مالی»، `/api/financial/*`، `/api/reports/*` و
`/api/analytics/*` همچنان درآمد کامل برمی‌گرداندند. حالا هر اندپوینت جدید از
روز اول پوشش دارد، و فهرست فیلدهای پولی در `AMOUNT_FIELDS` یک‌جا نگهداری می‌شود.

کلیدهای مخصوص CRM فقط روی `/api/crm-desk/*` اعمال می‌شوند — چون `/api/visitors/*`
داشبورد و پرونده بیمار را هم تغذیه می‌کند و ماسک‌کردنش صفحه‌هایی را خالی می‌کرد که
این کلید درباره آن‌ها حرفی نزده.

**هیچ‌کس معاف نیست، از جمله مدیر سیستم.** استثنای `*` در طراحی اول بود، ولی
باعث می‌شد سوییچ دقیقاً برای کسی که احتمالاً آن را تست می‌کند بی‌اثر به‌نظر برسد.
راه برگشت خودِ سوییچ است: هر کسی که می‌تواند روشنش کند می‌تواند خاموشش کند.

## Sync (auth required، مجوز `sync`)

سه حالت جدا:

1. **سینک دستی** — `POST /api/sync/run` روی چند صفحه اول اجرا می‌شود.
2. **سینک کامل خودکار** — یک بار کل CRM را با checkpoint می‌خواند و تمام می‌شود.
3. **سینک زمان‌بندی‌شده (ساعتی)** — بعد از پایان سینک کامل، هر `intervalMinutes`
   دقیقه فقط برش اخیر داده را دوباره می‌خواند تا داشبورد به‌روز بماند.

| Method | Path | Body / Query | مجوز |
|--------|------|--------------|------|
| GET | `/api/sync/status` | — | `sync` |
| GET | `/api/sync/logs` | `?limit=20&entity=` | `sync` |
| GET | `/api/sync/logs/:id/errors` | `?page&limit` | `*` |
| GET | `/api/sync/auto` | — | `sync` |
| POST | `/api/sync/auto` | `{ enabled }` | `sync.run` |
| PATCH | `/api/sync/auto/settings` | `{ throttleDelayMs, pageSize }` | `sync.settings` |
| POST | `/api/sync/auto/reset` | `{ entity? }` | `sync.run` |
| POST | `/api/sync/run` | `?maxPages&pageSize`, `{ entities? }` | `sync.run` |
| POST | `/api/sync/run/:entity` | `?maxPages&pageSize` | `sync.run` |
| POST | `/api/sync/cancel` | — | `sync.run` |
| POST | `/api/sync/purge` | — | `sync.purge` |
| GET | `/api/sync/schedule` | — | `sync` |
| PATCH | `/api/sync/schedule` | `{ scheduleEnabled?, intervalMinutes?, lookbackDays?, scheduleEntities? }` | `sync.settings` |
| POST | `/api/sync/schedule/run` | — | `sync.run` |
| POST | `/api/sync/schedule/cancel` | — | `sync.run` |

### سینک زمان‌بندی‌شده

`intervalMinutes` بین ۱۵ تا ۱۴۴۰ (پیش‌فرض ۶۰ = ساعتی). `lookbackDays` تعیین می‌کند
هر بار چند روز عقب‌تر دوباره خوانده شود (پیش‌فرض ۷) — رکوردهایی که بعداً ویرایش
می‌شوند، مثل تسویه پرداخت، فقط از این راه به‌روز می‌شوند.

هر موجودیت به شکلی باریک می‌شود که endpoint اجازه می‌دهد:

| موجودیت | روش |
|---------|-----|
| `RECEPTIONS`, `TREATMENTS` | پنجره تاریخ از `today - lookbackDays` تا امروز |
| `RESERVES` | پنجره تاریخ از `today - lookbackDays` تا **۳۰ روز آینده** (رزرو تاریخ آینده دارد) |
| `SERVICES` | کل کاتالوگ در یک درخواست |
| `PATIENTS` | چند صفحه آخر offset — تا وقتی سینک کامل بیماران تمام نشده، رد می‌شود |

زمان اجرای بعدی در `sync_settings.next_run_at` ذخیره می‌شود، پس ری‌استارت
برنامه زمان‌بندی را از سر نمی‌گیرد. سینک زمان‌بندی‌شده با سینک کامل هم‌زمان
اجرا نمی‌شود؛ اگر سینک کامل در حال اجرا باشد، tick بعدی دوباره تلاش می‌کند.

`SYNC_CRON_ENABLED=true` یک مسیر جایگزین مبتنی بر env است (`SYNC_CRON_SCHEDULE`)
برای استقراری که ترجیح می‌دهد زمان‌بندی در کانفیگ بماند.

## Leads

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/leads` | مجوز `leads` |
| POST | `/api/leads` | مجوز `leads` |
| PATCH | `/api/leads/:id/status` | مجوز `leads` |
| PATCH | `/api/leads/:id/assign` | مجوز `leads.assign` |
| DELETE | `/api/leads/:id` | مجوز `leads.delete` |
| POST | `/api/leads/webhook` | `x-webhook-secret` (بدون JWT) |

**دامنه دید هر کارشناس.** `leads` یعنی «لیدهای خودم + لیدهای واگذارنشده»، نه همه
لیدها؛ `leads.all` قید را برمی‌دارد (سرپرست فروش). قاعده در `lib/lead-scope.ts`
تعریف شده و روی `/api/campaigns/:id/leads` هم اعمال می‌شود، چون همان داده است و
`leads` کلید `campaigns` را هم می‌دهد. لیدی که متعلق به شما نیست **۴۰۴** می‌دهد،
نه ۴۰۳ — تا اندپوینت به ابزار شمارش لیدها تبدیل نشود. جزئیات در `docs/SECURITY.md`.

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
