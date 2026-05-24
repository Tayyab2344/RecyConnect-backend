-- CreateEnum
CREATE TYPE "CollectorAvailability" AS ENUM ('OFFLINE', 'ONLINE', 'ON_DUTY', 'BUSY', 'BREAK');

-- CreateEnum
CREATE TYPE "CollectorTaskType" AS ENUM ('SELLER_TO_WAREHOUSE', 'SELLER_TO_BUYER', 'WAREHOUSE_TO_BUYER', 'BUYER_REQUESTED_PICKUP');

-- CreateEnum
CREATE TYPE "CollectorTaskStatus" AS ENUM ('ASSIGNED', 'ACCEPTED', 'EN_ROUTE_TO_PICKUP', 'ARRIVED_AT_SOURCE', 'VERIFIED', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "WasteVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'FLAGGED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CollectorDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

-- CreateTable
CREATE TABLE "CollectorProfile" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "warehouseId" INTEGER NOT NULL,
    "employeeId" TEXT NOT NULL,
    "availabilityStatus" "CollectorAvailability" NOT NULL DEFAULT 'OFFLINE',
    "dutyStatus" TEXT NOT NULL DEFAULT 'OFF_DUTY',
    "vehicleInfo" JSONB,
    "currentLatitude" DOUBLE PRECISION,
    "currentLongitude" DOUBLE PRECISION,
    "lastLocationAt" TIMESTAMP(3),
    "lastActiveAt" TIMESTAMP(3),
    "checkedInAt" TIMESTAMP(3),
    "checkedOutAt" TIMESTAMP(3),
    "totalActiveMinutes" INTEGER NOT NULL DEFAULT 0,
    "completedTasks" INTEGER NOT NULL DEFAULT 0,
    "cancelledTasks" INTEGER NOT NULL DEFAULT 0,
    "totalCollectedKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reliabilityScore" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "rating" DOUBLE PRECISION,
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectorTask" (
    "id" SERIAL NOT NULL,
    "warehouseId" INTEGER NOT NULL,
    "collectorId" INTEGER,
    "taskType" "CollectorTaskType" NOT NULL,
    "status" "CollectorTaskStatus" NOT NULL DEFAULT 'ASSIGNED',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "sourceType" TEXT NOT NULL,
    "sourceUserId" INTEGER,
    "sourceName" TEXT,
    "sourceAddress" TEXT NOT NULL,
    "sourceContact" TEXT,
    "sourceLatitude" DOUBLE PRECISION,
    "sourceLongitude" DOUBLE PRECISION,
    "destinationType" TEXT NOT NULL,
    "destinationUserId" INTEGER,
    "destinationName" TEXT,
    "destinationAddress" TEXT NOT NULL,
    "destinationContact" TEXT,
    "destinationLatitude" DOUBLE PRECISION,
    "destinationLongitude" DOUBLE PRECISION,
    "materialCategory" TEXT NOT NULL,
    "materialType" TEXT,
    "estimatedWeight" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'kg',
    "listedPrice" DOUBLE PRECISION,
    "pricePerUnit" DOUBLE PRECISION,
    "deliveryFee" DOUBLE PRECISION,
    "estimatedValue" DOUBLE PRECISION,
    "finalValue" DOUBLE PRECISION,
    "images" TEXT[],
    "notes" TEXT,
    "instructions" TEXT,
    "routeInfo" JSONB,
    "metadata" JSONB,
    "acceptedAt" TIMESTAMP(3),
    "pickupStartedAt" TIMESTAMP(3),
    "arrivedAtSourceAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "transitStartedAt" TIMESTAMP(3),
    "arrivedDestinationAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectorTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WasteVerification" (
    "id" SERIAL NOT NULL,
    "taskId" INTEGER NOT NULL,
    "listedWeight" DOUBLE PRECISION NOT NULL,
    "verifiedWeight" DOUBLE PRECISION NOT NULL,
    "listedCategory" TEXT NOT NULL,
    "verifiedCategory" TEXT NOT NULL,
    "verifiedMaterial" TEXT,
    "proofImages" TEXT[],
    "notes" TEXT,
    "status" "WasteVerificationStatus" NOT NULL DEFAULT 'VERIFIED',
    "weightDifference" DOUBLE PRECISION NOT NULL,
    "priceBefore" DOUBLE PRECISION,
    "priceAfter" DOUBLE PRECISION,
    "verifiedById" INTEGER NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WasteVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectorDelivery" (
    "id" SERIAL NOT NULL,
    "taskId" INTEGER NOT NULL,
    "status" "CollectorDeliveryStatus" NOT NULL DEFAULT 'DELIVERED',
    "receiverName" TEXT,
    "receiverContact" TEXT,
    "receiverConfirmation" TEXT,
    "receivedWeight" DOUBLE PRECISION,
    "packageCondition" TEXT,
    "proofImages" TEXT[],
    "notes" TEXT,
    "deliveredById" INTEGER NOT NULL,
    "deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectorDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectorLocation" (
    "id" SERIAL NOT NULL,
    "taskId" INTEGER,
    "collectorId" INTEGER NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "status" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectorLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CollectorProfile_userId_key" ON "CollectorProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectorProfile_employeeId_key" ON "CollectorProfile"("employeeId");

-- CreateIndex
CREATE INDEX "CollectorProfile_warehouseId_idx" ON "CollectorProfile"("warehouseId");

-- CreateIndex
CREATE INDEX "CollectorProfile_availabilityStatus_idx" ON "CollectorProfile"("availabilityStatus");

-- CreateIndex
CREATE INDEX "CollectorTask_warehouseId_status_idx" ON "CollectorTask"("warehouseId", "status");

-- CreateIndex
CREATE INDEX "CollectorTask_collectorId_status_idx" ON "CollectorTask"("collectorId", "status");

-- CreateIndex
CREATE INDEX "CollectorTask_taskType_idx" ON "CollectorTask"("taskType");

-- CreateIndex
CREATE INDEX "CollectorTask_createdAt_idx" ON "CollectorTask"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WasteVerification_taskId_key" ON "WasteVerification"("taskId");

-- CreateIndex
CREATE INDEX "WasteVerification_verifiedById_idx" ON "WasteVerification"("verifiedById");

-- CreateIndex
CREATE INDEX "WasteVerification_status_idx" ON "WasteVerification"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CollectorDelivery_taskId_key" ON "CollectorDelivery"("taskId");

-- CreateIndex
CREATE INDEX "CollectorDelivery_deliveredById_idx" ON "CollectorDelivery"("deliveredById");

-- CreateIndex
CREATE INDEX "CollectorDelivery_status_idx" ON "CollectorDelivery"("status");

-- CreateIndex
CREATE INDEX "CollectorLocation_collectorId_createdAt_idx" ON "CollectorLocation"("collectorId", "createdAt");

-- CreateIndex
CREATE INDEX "CollectorLocation_taskId_createdAt_idx" ON "CollectorLocation"("taskId", "createdAt");

-- AddForeignKey
ALTER TABLE "CollectorProfile" ADD CONSTRAINT "CollectorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectorProfile" ADD CONSTRAINT "CollectorProfile_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectorTask" ADD CONSTRAINT "CollectorTask_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectorTask" ADD CONSTRAINT "CollectorTask_collectorId_fkey" FOREIGN KEY ("collectorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectorTask" ADD CONSTRAINT "CollectorTask_sourceUserId_fkey" FOREIGN KEY ("sourceUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectorTask" ADD CONSTRAINT "CollectorTask_destinationUserId_fkey" FOREIGN KEY ("destinationUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WasteVerification" ADD CONSTRAINT "WasteVerification_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CollectorTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WasteVerification" ADD CONSTRAINT "WasteVerification_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectorDelivery" ADD CONSTRAINT "CollectorDelivery_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CollectorTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectorDelivery" ADD CONSTRAINT "CollectorDelivery_deliveredById_fkey" FOREIGN KEY ("deliveredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectorLocation" ADD CONSTRAINT "CollectorLocation_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CollectorTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectorLocation" ADD CONSTRAINT "CollectorLocation_collectorId_fkey" FOREIGN KEY ("collectorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
