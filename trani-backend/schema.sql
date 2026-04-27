-- ═══════════════════════════════════════════════════════
-- Trani Partecipa — schema SQL
-- Esegui nell'SQL Editor di Supabase (Database → SQL Editor)
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ideas (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  zone        SMALLINT    NOT NULL CHECK (zone BETWEEN 0 AND 6),
  zone_name   TEXT        NOT NULL,
  name        TEXT        NOT NULL DEFAULT 'Anonimo',
  text        TEXT        NOT NULL CHECK (char_length(text) BETWEEN 3 AND 500),
  street      TEXT,
  type        TEXT        NOT NULL DEFAULT 'idea' CHECK (type IN ('idea', 'segnalazione')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ideas_zone_ts ON ideas (zone, created_at DESC);

-- ── Row Level Security ──────────────────────────────────────────────────────
-- SELECT e INSERT pubblici; DELETE solo via API con autenticazione server-side
ALTER TABLE ideas ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Chiunque può leggere le idee"
  ON ideas FOR SELECT USING (true);

CREATE POLICY IF NOT EXISTS "Chiunque può inviare un'idea"
  ON ideas FOR INSERT WITH CHECK (true);

-- ── Vista riassuntiva per zona ──────────────────────────────────────────────
CREATE OR REPLACE VIEW zone_stats AS
  SELECT
    zone,
    zone_name,
    COUNT(*)::int AS total_ideas,
    MAX(created_at) AS last_idea_at
  FROM ideas
  GROUP BY zone, zone_name
  ORDER BY zone;


-- ══════════════════════════════════════════════════════════════════════════════
-- MIGRAZIONE — esegui solo se la tabella ideas esiste già
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. Aggiorna il vincolo di zona da 0-3 a 0-6
ALTER TABLE ideas DROP CONSTRAINT IF EXISTS ideas_zone_check;
ALTER TABLE ideas ADD CONSTRAINT ideas_zone_check CHECK (zone BETWEEN 0 AND 6);

-- 2. Aggiungi la colonna type se mancante
ALTER TABLE ideas ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'idea'
  CHECK (type IN ('idea', 'segnalazione'));
