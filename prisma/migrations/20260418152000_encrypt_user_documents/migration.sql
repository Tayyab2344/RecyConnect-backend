ALTER TABLE "UserDocument"
ADD COLUMN "encrypted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "encryptionAlgorithm" TEXT,
ADD COLUMN "encryptionIv" TEXT,
ADD COLUMN "encryptionAuthTag" TEXT,
ADD COLUMN "encryptionKeyVersion" TEXT,
ADD COLUMN "mimeType" TEXT,
ADD COLUMN "fileSize" INTEGER;
