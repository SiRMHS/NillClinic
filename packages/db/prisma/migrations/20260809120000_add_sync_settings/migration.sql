-- Backfilled migration. This table was originally created with `prisma db push`,
-- which leaves no migration file and no _prisma_migrations row, so the directory
-- existed but was empty and the history was out of sync with the database.
-- IF NOT EXISTS keeps it a no-op on databases that already have the table.

-- CreateTable
CREATE TABLE IF NOT EXISTS "sync_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "auto_sync_enabled" BOOLEAN NOT NULL DEFAULT false,
    "throttle_delay_ms" INTEGER NOT NULL DEFAULT 500,
    "page_size" INTEGER NOT NULL DEFAULT 50,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_settings_pkey" PRIMARY KEY ("id")
);
