import { prisma } from "@jordan/db";
import { JordanApiClient, MappingEngine } from "@jordan/sync-engine";

function createJordanClient() {
  return new JordanApiClient({
    baseUrl: process.env.JORDAN_API_BASE_URL ?? "",
    username: process.env.JORDAN_API_USERNAME ?? "",
    password: process.env.JORDAN_API_PASSWORD ?? "",
    company: process.env.JORDAN_API_COMPANY ?? "Jordan",
  });
}

/** One billed line as the reception panel shows it — service, section, who did it. */
export interface ReceptionLine {
  secName: string | null;
  srvName: string | null;
  receptionPersonnelName: string | null;
}

export interface ReceptionView {
  id: string;
  externalId: number;
  // Nullable throughout: the CRM omits these on real rows, and rejecting such
  // records is what previously cost ~6.7k patients and ~2k reserves.
  receptionNo: number | null;
  receptionDate: string | null;
  treatmentItemNames: string | null;
  treatmentItemNamesList: string[];
  userName: string | null;
  isReturn: boolean;
  /**
   * The billed lines, narrowed to what the panel renders.
   *
   * This used to be `receptionDetailDtos` passed through verbatim, which meant
   * every line's `receivedPrice`, `discount`, `remainPrice` and `depositPrice`
   * travelled to the browser — on a route reachable with the `leads` key, i.e.
   * by the call centre, which has no business seeing what a patient paid. The
   * UI never rendered them; they were simply in the JSON. Projecting the three
   * fields the panel actually uses removes the question entirely, and keeps a
   * new upstream field from appearing in our response unreviewed.
   */
  detailsJson: ReceptionLine[];
  patientExternalCode: number | null;
  patient: {
    id: string;
    fullName: string | null;
    externalCode: number;
    mobile: string | null;
  } | null;
}

export interface FetchReceptionsOptions {
  limit?: number;
  search?: string;
  fromDate?: string;
  toDate?: string;
}

export async function fetchReceptionsLive(options: FetchReceptionsOptions = {}): Promise<ReceptionView[]> {
  const { limit = 100, search, fromDate = "1400/01/01", toDate } = options;
  const api = createJordanClient();
  const mapper = new MappingEngine();
  const pageSize = Math.min(limit, 100);

  const raw = await api.getReceptions({
    page: 1,
    pageSize,
    fromDate,
    toDate,
  });
  const { valid } = mapper.mapReceptions(raw);
  if (valid.length === 0 && raw.length > 0) {
    const { invalid } = mapper.mapReceptions(raw);
    console.warn("[receptions.service] all receptions invalid:", invalid);
  }

  const patientCodes = [...new Set(valid.map((v) => v.data.patientNo).filter((n): n is number => n !== null))];
  const patients = patientCodes.length
    ? await prisma.patient.findMany({
        where: { externalCode: { in: patientCodes } },
        select: { id: true, fullName: true, externalCode: true, mobile: true },
      })
    : [];
  const patientMap = new Map(patients.map((p) => [p.externalCode, p]));

  /** Keep the descriptive columns, drop the money. */
  const toReceptionLines = (details: unknown): ReceptionLine[] => {
    if (!Array.isArray(details)) return [];
    return details.map((line) => {
      const row = (line ?? {}) as Record<string, unknown>;
      const text = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : null);
      return {
        secName: text(row.secName),
        srvName: text(row.srvName),
        receptionPersonnelName: text(row.receptionPersonnelName),
      };
    });
  };

  let results: ReceptionView[] = valid.map(({ data, treatmentItemNamesList }) => ({
    id: String(data.receptionId),
    externalId: data.receptionId,
    receptionNo: data.receptionNo,
    receptionDate: data.receptionDate,
    treatmentItemNames: data.treatmentItemNames ?? null,
    treatmentItemNamesList,
    userName: data.userName ?? null,
    isReturn: data.isReturn,
    detailsJson: toReceptionLines(data.receptionDetailDtos),
    patientExternalCode: data.patientNo,
    patient: data.patientNo != null ? (patientMap.get(data.patientNo) ?? null) : null,
  }));

  if (search) {
    const q = search.toLowerCase();
    results = results.filter((r) =>
      (r.patient?.fullName?.toLowerCase().includes(q)) ||
      (r.treatmentItemNames?.toLowerCase().includes(q)) ||
      r.userName?.toLowerCase().includes(q) ||
      r.treatmentItemNamesList.some((t) => t.toLowerCase().includes(q)) ||
      String(r.receptionNo).includes(q) ||
      String(r.patientExternalCode).includes(q),
    );
  }

  return results.sort((a, b) => {
    const dateCmp = (b.receptionDate ?? "").localeCompare(a.receptionDate ?? "");
    return dateCmp !== 0 ? dateCmp : (b.receptionNo ?? 0) - (a.receptionNo ?? 0);
  });
}
