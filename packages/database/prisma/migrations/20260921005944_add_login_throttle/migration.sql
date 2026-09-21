-- CreateTable
CREATE TABLE "login_throttles" (
    "keyHash" CHAR(64) NOT NULL,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "windowStartedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockedUntil" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "login_throttles_pkey" PRIMARY KEY ("keyHash")
);

-- CreateIndex
CREATE INDEX "login_throttles_blockedUntil_idx" ON "login_throttles"("blockedUntil");
