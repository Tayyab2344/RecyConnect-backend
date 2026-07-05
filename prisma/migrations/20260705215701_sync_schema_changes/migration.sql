/*
  Warnings:

  - You are about to drop the column `plainPassword` on the `User` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "CollectorType" AS ENUM ('WAREHOUSE', 'INDEPENDENT');

-- AlterEnum
ALTER TYPE "CollectorTaskType" ADD VALUE 'SELF_DELIVERY';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DeliveryMethod" ADD VALUE 'INDEPENDENT_COLLECTOR_SERVICE';
ALTER TYPE "DeliveryMethod" ADD VALUE 'SELF_DELIVERY';
ALTER TYPE "DeliveryMethod" ADD VALUE 'BUYER_PICKUP';
ALTER TYPE "DeliveryMethod" ADD VALUE 'RECYCONNECT_PICKUP';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderStatus" ADD VALUE 'PAYMENT_PENDING';
ALTER TYPE "OrderStatus" ADD VALUE 'WAITING_FOR_DISPATCH';
ALTER TYPE "OrderStatus" ADD VALUE 'WAREHOUSE_ASSIGNED';
ALTER TYPE "OrderStatus" ADD VALUE 'COLLECTOR_ASSIGNED';
ALTER TYPE "OrderStatus" ADD VALUE 'COLLECTOR_ACCEPTED';
ALTER TYPE "OrderStatus" ADD VALUE 'TRAVELLING_TO_SELLER';
ALTER TYPE "OrderStatus" ADD VALUE 'ARRIVED_AT_PICKUP';
ALTER TYPE "OrderStatus" ADD VALUE 'MATERIAL_VERIFIED';
ALTER TYPE "OrderStatus" ADD VALUE 'PICKED_UP';
ALTER TYPE "OrderStatus" ADD VALUE 'IN_TRANSIT';
ALTER TYPE "OrderStatus" ADD VALUE 'ARRIVED_AT_BUYER';
ALTER TYPE "OrderStatus" ADD VALUE 'BUYER_VERIFICATION';
ALTER TYPE "OrderStatus" ADD VALUE 'WAREHOUSE_REJECTED';
ALTER TYPE "OrderStatus" ADD VALUE 'COLLECTOR_DECLINED';
ALTER TYPE "OrderStatus" ADD VALUE 'BUYER_CANCELLED';
ALTER TYPE "OrderStatus" ADD VALUE 'SELLER_CANCELLED';
ALTER TYPE "OrderStatus" ADD VALUE 'DELIVERY_FAILED';
ALTER TYPE "OrderStatus" ADD VALUE 'REFUND_INITIATED';

-- DropForeignKey
ALTER TABLE "CollectorProfile" DROP CONSTRAINT "CollectorProfile_warehouseId_fkey";

-- DropForeignKey
ALTER TABLE "CollectorTask" DROP CONSTRAINT "CollectorTask_warehouseId_fkey";

-- AlterTable
ALTER TABLE "CollectorProfile" ADD COLUMN     "activeOrdersCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "collectorType" "CollectorType" NOT NULL DEFAULT 'WAREHOUSE',
ADD COLUMN     "onlineStatus" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "vehicleType" TEXT DEFAULT 'MOTORCYCLE',
ALTER COLUMN "warehouseId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "CollectorTask" ALTER COLUMN "warehouseId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "plainPassword",
ADD COLUMN     "acceptsDispatchOrders" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "averageDispatchRating" DOUBLE PRECISION,
ADD COLUMN     "currentActiveDispatches" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryRadius" DOUBLE PRECISION DEFAULT 10.0,
ADD COLUMN     "dispatchStatus" TEXT NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "Dispatch" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "warehouseId" INTEGER,
    "collectorId" INTEGER,
    "pickupLocation" TEXT NOT NULL,
    "deliveryLocation" TEXT NOT NULL,
    "estimatedDistance" DOUBLE PRECISION,
    "estimatedDuration" DOUBLE PRECISION,
    "deliveryFee" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "dispatchStatus" TEXT NOT NULL DEFAULT 'PENDING_ACCEPTANCE',
    "assignedAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Dispatch_orderId_key" ON "Dispatch"("orderId");

-- AddForeignKey
ALTER TABLE "CollectorProfile" ADD CONSTRAINT "CollectorProfile_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectorTask" ADD CONSTRAINT "CollectorTask_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_collectorId_fkey" FOREIGN KEY ("collectorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
