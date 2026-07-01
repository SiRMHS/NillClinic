import { prisma } from "@jordan/db";

/** Delete all CRM-synced entities so a clean re-sync can run with normalized data. */
export async function purgeCrmData() {
  const [treatments, receptions, reserves, services, patients] = await prisma.$transaction([
    prisma.treatment.deleteMany(),
    prisma.reception.deleteMany(),
    prisma.reserve.deleteMany(),
    prisma.service.deleteMany(),
    prisma.patient.deleteMany(),
  ]);

  return {
    patients: patients.count,
    services: services.count,
    reserves: reserves.count,
    treatments: treatments.count,
    receptions: receptions.count,
  };
}
