-- DropIndex
DROP INDEX "Position_symbol_key";

-- AlterTable
ALTER TABLE "Position" ADD COLUMN     "direction" TEXT,
ADD COLUMN     "entryPrice" DOUBLE PRECISION,
ADD COLUMN     "exchangeAccountId" TEXT,
ADD COLUMN     "leverage" INTEGER,
ADD COLUMN     "liquidationPrice" DOUBLE PRECISION,
ADD COLUMN     "margin" DOUBLE PRECISION,
ADD COLUMN     "unrealizedPnl" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "ExchangeAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "apiSecret" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExchangeAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Position_symbol_direction_key" ON "Position"("symbol", "direction");

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_exchangeAccountId_fkey" FOREIGN KEY ("exchangeAccountId") REFERENCES "ExchangeAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
