-- ═══════════════════════════════════════════════════════
-- Trani Partecipa — schema SQL
-- Esegui questo nell'SQL Editor di Supabase (o su qualsiasi PostgreSQL)
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ideas (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  zone        SMALLINT    NOT NULL CHECK (zone BETWEEN 0 AND 3),
  zone_name   TEXT        NOT NULL,
  name        TEXT        NOT NULL DEFAULT 'Anonimo',
  text        TEXT        NOT NULL CHECK (char_length(text) BETWEEN 3 AND 500),
  street      TEXT,                          -- via specifica selezionata da Places Autocomplete
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Indice per query per zona (ordinamento cronologico)
CREATE INDEX IF NOT EXISTS ideas_zone_ts ON ideas (zone, created_at DESC);

-- ── Row Level Security (opzionale, consigliato su Supabase) ─────────────────
-- Abilita RLS e permetti solo INSERT/SELECT pubblici (no UPDATE/DELETE)
ALTER TABLE ideas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Chiunque può leggere le idee"
  ON ideas FOR SELECT USING (true);

CREATE POLICY "Chiunque può inviare un'idea"
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
