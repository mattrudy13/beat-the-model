-- Adds AP ranks and records going into each game (schema.sql has them for a fresh database).
-- Run once, before deploying the Worker that writes them:
--   npx wrangler d1 execute beat-the-model --remote --file=migrations/2026-10-27-ap-records.sql
ALTER TABLE games ADD COLUMN home_ap INTEGER;
ALTER TABLE games ADD COLUMN away_ap INTEGER;
ALTER TABLE games ADD COLUMN home_record TEXT;
ALTER TABLE games ADD COLUMN away_record TEXT;
