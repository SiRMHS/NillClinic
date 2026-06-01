import { prisma } from "@jordan/db";
import { createEncryptFn, decrypt } from "../src/security/encryption.js";

async function main() {
  const patients = await prisma.patient.findMany({
    select: { id: true, fullNameEnc: true, mobileEnc: true },
  });

  let updated = 0;
  for (const p of patients) {
    let fullName: string | null = null;
    let mobile: string | null = null;
    try {
      fullName = decrypt(p.fullNameEnc);
      mobile = p.mobileEnc ? decrypt(p.mobileEnc) : null;
    } catch {
      fullName = `[encrypted]`;
    }

    if (fullName || mobile) {
      await prisma.patient.update({
        where: { id: p.id },
        data: { fullName, mobile },
      });
      updated++;
    }
  }

  console.log(`✅ Backfilled ${updated} patients`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
