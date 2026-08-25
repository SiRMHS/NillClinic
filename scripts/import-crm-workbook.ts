/**
 * Backfill the CRM desk from the clinic's legacy workbook.
 *
 * Input is the JSON produced by `scripts/crm-workbook-to-json.py`, which is
 * where the xlsx parsing lives — the workbook is a one-time import of a file
 * that no longer receives writes, so it does not justify a spreadsheet parser
 * in the API's runtime dependencies.
 *
 *   pnpm build                                    # dist output this script imports
 *   python3 scripts/crm-workbook-to-json.py "CRM اصلی.xlsx" /tmp/crm.json
 *   pnpm tsx scripts/import-crm-workbook.ts /tmp/crm.json
 *
 * Re-running is safe: the previously imported set is cleared first, so a second
 * pass replaces it instead of duplicating. Rows the desk enters through the app
 * always carry an author, and are never touched.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(import.meta.dirname, "../.env");
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq);
  const val = trimmed.slice(eq + 1).replace(/^["']|["']$/g, "");
  if (!process.env[key]) process.env[key] = val;
}

interface RawContact {
  kind: string;
  sheet: string;
  patientExternalCode?: number | null;
  patientName?: string | null;
  doctorName?: string | null;
  visitDate?: string | null;
  contactDate: string;
  serviceName?: string | null;
  amountText?: string | null;
  amount?: number | null;
  schedulingRating?: string | null;
  doctorRating?: string | null;
  assistantRating?: string | null;
  receptionRating?: string | null;
  hygieneRating?: string | null;
  referralLikelihood?: string | null;
  revisitLikelihood?: string | null;
  channels?: string[];
  callResult?: string | null;
  suggestion?: string | null;
  notes?: string | null;
  rebookNote?: string | null;
  resultsOnset?: string | null;
  sideEffect?: string | null;
  overallOpinion?: string | null;
  callCenterReferral?: string | null;
}

interface Payload {
  contacts: RawContact[];
  schedule: { doctorName: string; weekday: number; note: string }[];
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error("usage: tsx scripts/import-crm-workbook.ts <crm.json>");
    process.exit(1);
  }

  // Built output, imported by path: the repo root is not a workspace package,
  // so bare specifiers do not resolve here. Same approach as run-sync.ts.
  const { prisma } = await import("../packages/db/dist/index.js");
  const { jalaliToDate } = await import("../packages/shared/dist/index.js");
  const { createEncryptFn } = await import("../apps/api/dist/security/encryption.js");
  const encrypt = createEncryptFn();

  const payload = JSON.parse(readFileSync(resolve(input), "utf8")) as Payload;
  console.log(`loaded ${payload.contacts.length} contacts, ${payload.schedule.length} schedule cells`);

  // Resolving each file number to a synced patient is what links the imported
  // history to the rest of the dashboard; rows whose number is unknown keep the
  // name the sheet recorded and simply stay unlinked.
  const codes = [...new Set(payload.contacts.map((c) => c.patientExternalCode).filter((c): c is number => typeof c === "number"))];
  const patients = await prisma.patient.findMany({
    where: { externalCode: { in: codes } },
    select: { id: true, externalCode: true, fullName: true, mobile: true },
  });
  const byCode = new Map(patients.map((p) => [p.externalCode, p]));
  console.log(`matched ${patients.length} of ${codes.length} file numbers to synced patients`);

  // Imported rows are exactly the authorless ones — everything entered through
  // the app carries the user who typed it. Clearing them makes a re-import a
  // replace rather than a merge.
  //
  // Matching on the row's own contents was tried first and was wrong: the sheet
  // has no natural key, and 486 records shared a (kind, date, patient, service)
  // tuple with another row — they collapsed into each other and vanished.
  const removed = await prisma.crmContact.deleteMany({ where: { createdById: null } });
  if (removed.count > 0) console.log(`cleared ${removed.count} previously imported rows`);

  const rows = payload.contacts.map((c) => {
    const patient = c.patientExternalCode ? byCode.get(c.patientExternalCode) : undefined;
    const name = patient?.fullName ?? c.patientName ?? null;
    const mobile = patient?.mobile ?? null;

    return {
      kind: c.kind as never,
      patientId: patient?.id ?? null,
      patientExternalCode: c.patientExternalCode ?? null,
      patientName: name,
      patientNameEnc: name ? encrypt(name) : null,
      patientMobile: mobile,
      patientMobileEnc: mobile ? encrypt(mobile) : null,
      doctorName: c.doctorName ?? null,
      visitDate: c.visitDate ?? null,
      contactDate: c.contactDate,
      contactAt: jalaliToDate(c.contactDate),
      serviceName: c.serviceName ?? null,
      amountText: c.amountText ?? null,
      amount: c.amount ?? null,
      schedulingRating: (c.schedulingRating ?? null) as never,
      doctorRating: (c.doctorRating ?? null) as never,
      assistantRating: (c.assistantRating ?? null) as never,
      receptionRating: (c.receptionRating ?? null) as never,
      hygieneRating: (c.hygieneRating ?? null) as never,
      referralLikelihood: (c.referralLikelihood ?? null) as never,
      revisitLikelihood: (c.revisitLikelihood ?? null) as never,
      channels: (c.channels ?? []) as never,
      callResult: (c.callResult ?? null) as never,
      suggestion: c.suggestion ?? null,
      notes: c.notes ?? null,
      rebookNote: c.rebookNote ?? null,
      resultsOnset: c.resultsOnset ?? null,
      sideEffect: c.sideEffect ?? null,
      overallOpinion: c.overallOpinion ?? null,
      callCenterReferral: c.callCenterReferral ?? null,
    };
  });

  let created = 0;
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const res = await prisma.crmContact.createMany({ data: batch });
    created += res.count;
    console.log(`  inserted ${created}/${rows.length}`);
  }

  for (const s of payload.schedule) {
    await prisma.crmDoctorSchedule.upsert({
      where: { doctorName_weekday: { doctorName: s.doctorName, weekday: s.weekday } },
      create: s,
      update: { note: s.note },
    });
  }

  console.log(`done — imported ${created} contacts, ${payload.schedule.length} schedule cells`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
