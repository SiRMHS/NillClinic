-- CreateTable
CREATE TABLE "receptions" (
    "id" TEXT NOT NULL,
    "external_id" INTEGER NOT NULL,
    "reception_no" INTEGER NOT NULL,
    "patient_external_code" INTEGER,
    "patient_id" TEXT,
    "reception_date" TEXT NOT NULL,
    "is_return" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "treatment_item_names" TEXT,
    "treatment_item_names_list" JSONB NOT NULL DEFAULT '[]',
    "user_name" TEXT NOT NULL,
    "details_json" JSONB NOT NULL DEFAULT '[]',
    "synced_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "receptions_external_id_key" ON "receptions"("external_id");

-- CreateIndex
CREATE INDEX "receptions_reception_date_idx" ON "receptions"("reception_date");

-- CreateIndex
CREATE INDEX "receptions_patient_external_code_idx" ON "receptions"("patient_external_code");

-- CreateIndex
CREATE INDEX "receptions_user_name_idx" ON "receptions"("user_name");

-- AddForeignKey
ALTER TABLE "receptions" ADD CONSTRAINT "receptions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterEnum
ALTER TYPE "SyncEntity" ADD VALUE 'RECEPTIONS';
