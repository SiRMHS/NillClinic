-- Postgres does not index a foreign key column automatically.
--
-- Without this, "the line items of reception X" is a sequential scan of ~400k
-- rows. Any query that resolves the practitioner per reception — the tier
-- activity feed does exactly that — degrades into one full scan per row and
-- never returns. It also makes every reception delete scan the child table.
CREATE INDEX IF NOT EXISTS "reception_items_reception_id_idx"
  ON "reception_items"("reception_id");
