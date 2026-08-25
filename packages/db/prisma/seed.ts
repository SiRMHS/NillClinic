import { PrismaClient } from "@jordan/db";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const adminRole = await prisma.role.upsert({
    where: { name: "superadmin" },
    update: {},
    create: {
      name: "superadmin",
      label: "مدیر سیستم",
      description: "دسترسی کامل به همه بخش‌ها",
      permissions: ["*"],
    },
  });

  await prisma.role.upsert({
    where: { name: "admin" },
    update: {},
    create: {
      name: "admin",
      label: "مدیر کلینیک",
      description: "مدیریت کاربران و مشاهده همه بخش‌ها",
      // Parent keys only: "analytics" carries the report sub-keys, "financial"
      // carries the money sub-keys, and so on (see apps/api/src/lib/permissions.ts).
      permissions: [
        "dashboard",
        "patients",
        "leads",
        "campaigns",
        "crm",
        "crm.desk",
        "analytics",
        "financial",
        "sync",
        "sync.settings",
        "settings",
        "settings.users",
        "settings.roles",
      ],
    },
  });

  await prisma.role.upsert({
    where: { name: "analyst" },
    update: {},
    create: {
      name: "analyst",
      label: "تحلیلگر",
      description: "مشاهده گزارش‌ها و تحلیل‌ها",
      // Reporting without money: the point of splitting the financial keys out.
      permissions: ["dashboard", "patients.view", "crm", "analytics"],
    },
  });

  await prisma.role.upsert({
    where: { name: "reception" },
    update: {},
    create: {
      name: "reception",
      label: "پذیرش",
      description: "مدیریت بیماران و نوبت‌دهی",
      permissions: ["dashboard", "patients", "leads"],
    },
  });

  const password = await bcrypt.hash("admin123", 12);
  await prisma.user.upsert({
    where: { email: "admin@jordanclinic.ir" },
    update: {},
    create: {
      email: "admin@jordanclinic.ir",
      fullName: "مدیر سیستم",
      password,
      roleId: adminRole.id,
      isActive: true,
    },
  });

  console.log("✅ Seed complete: admin@jordanclinic.ir / admin123");
}

main().catch(console.error).finally(() => prisma.$disconnect());
