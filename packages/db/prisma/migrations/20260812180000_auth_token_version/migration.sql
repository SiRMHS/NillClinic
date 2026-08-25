-- AlterTable
ALTER TABLE "users" ADD COLUMN     "last_login_at" TIMESTAMP(3),
ADD COLUMN     "token_version" INTEGER NOT NULL DEFAULT 0;

