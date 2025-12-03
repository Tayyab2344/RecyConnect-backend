-- AlterTable
ALTER TABLE "User" ADD COLUMN     "addressUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "city" TEXT,
ADD COLUMN     "locationPermission" BOOLEAN NOT NULL DEFAULT false;
