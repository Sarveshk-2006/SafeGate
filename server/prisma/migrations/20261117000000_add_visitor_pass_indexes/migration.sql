-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_passes_society_validity" ON "visitor_passes"("society_id", "valid_from", "valid_to");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_passes_society_qr" ON "visitor_passes"("society_id", "qr_code_hash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_passes_society_phone" ON "visitor_passes"("society_id", "phone");

