require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const cors    = require('cors');
const helmet  = require('helmet');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ═══════════════════════════════════════════════════════
   DATABASE — Supabase Postgres (or any PG connection)
   ═══════════════════════════════════════════════════════ */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
});


/* ═══════════════════════════════════════════════════════
   MIDDLEWARE
   ═══════════════════════════════════════════════════════ */
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',')
    : '*'
}));
app.use(express.json({ limit: '16kb' }));


/* ═══════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════ */
const ZONE_NAMES = ['Pozzapiano', 'Via Corato', 'Centro', 'Via Andria'];
const VALID_ZONES = [0, 1, 2, 3];

/* ═══════════════════════════════════════════════════════
   ROUTES
   ═══════════════════════════════════════════════════════ */

/**
 * GET /api/stats
 * Returns idea count per zone.
 * Response: { stats: [{ zone: 0, count: 4 }, ...] }
 */
app.get('/api/stats', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT zone, COUNT(*)::int AS count
       FROM ideas
       GROUP BY zone
       ORDER BY zone`
    );
    res.json({ stats: result.rows });
  } catch (err) {
    console.error('GET /api/stats:', err.message);
    res.status(500).json({ error: 'Errore del server' });
  }
});

/**
 * GET /api/ideas?zone=2&limit=3
 * Returns recent ideas for a zone.
 * Response: { ideas: [{ name, text, created_at }], total: N }
 */
app.get('/api/ideas', async (req, res) => {
  const zone  = Number(req.query.zone);
  const limit = Math.min(Number(req.query.limit) || 3, 10);

  if (!VALID_ZONES.includes(zone)) {
    return res.status(400).json({ error: 'Zona non valida' });
  }

  try {
    const [rows, countRow] = await Promise.all([
      pool.query(
        `SELECT name, text, created_at
         FROM ideas
         WHERE zone = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [zone, limit]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count FROM ideas WHERE zone = $1`,
        [zone]
      )
    ]);

    res.json({
      ideas: rows.rows,
      total: countRow.rows[0].count
    });
  } catch (err) {
    console.error('GET /api/ideas:', err.message);
    res.status(500).json({ error: 'Errore del server' });
  }
});

/**
 * POST /api/ideas
 * Body: { zone: 2, name: "Mario", text: "Più alberi qui" }
 * Response: { id, created_at }
 */
app.post('/api/ideas', async (req, res) => {
  const { zone, name, text, street } = req.body;
  const zoneIdx = Number(zone);

  // ── Input validation ───────────────────────────────
  if (!VALID_ZONES.includes(zoneIdx)) {
    return res.status(400).json({ error: 'Zona non valida' });
  }
  if (typeof text !== 'string' || text.trim().length < 3) {
    return res.status(400).json({ error: 'Testo troppo breve (min 3 caratteri)' });
  }
  if (text.trim().length > 500) {
    return res.status(400).json({ error: 'Testo troppo lungo (max 500 caratteri)' });
  }

  const cleanName   = (typeof name   === 'string' ? name.trim()   : '') || 'Anonimo';
  const cleanText   = text.trim();
  const cleanStreet = (typeof street === 'string' ? street.trim() : '') || null;

  try {
    const result = await pool.query(
      `INSERT INTO ideas (zone, zone_name, name, text, street)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at`,
      [zoneIdx, ZONE_NAMES[zoneIdx], cleanName, cleanText, cleanStreet]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /api/ideas:', err.message);
    res.status(500).json({ error: 'Errore del server' });
  }
});

/* ═══════════════════════════════════════════════════════
   ADMIN — autenticazione semplice via header
   ═══════════════════════════════════════════════════════ */
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;

function adminAuth(req, res, next) {
  const auth = req.headers['x-admin-auth'] || '';
  const [u, p] = Buffer.from(auth, 'base64').toString().split(':');
  if (u === ADMIN_USER && p === ADMIN_PASS) return next();
  res.status(401).json({ error: 'Non autorizzato' });
}

/* Serve la pagina admin */
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'admin.html'));
});

/* GET /api/admin/ideas — tutte le idee */
app.get('/api/admin/ideas', adminAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, zone, zone_name, name, text, street, type, created_at
       FROM ideas ORDER BY created_at DESC`
    );
    res.json({ ideas: result.rows, total: result.rows.length });
  } catch (err) {
    console.error('GET /api/admin/ideas:', err.message);
    res.status(500).json({ error: 'Errore del server' });
  }
});

/* DELETE /api/admin/ideas/:id — elimina un'idea */
app.delete('/api/admin/ideas/:id', adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'ID non valido' });
  }
  try {
    const result = await pool.query('DELETE FROM ideas WHERE id=$1 RETURNING id', [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Idea non trovata' });
    res.json({ deleted: result.rows[0].id });
  } catch (err) {
    console.error('DELETE /api/admin/ideas:', err.message);
    res.status(500).json({ error: 'Errore del server' });
  }
});

/* ═══════════════════════════════════════════════════════
   HEALTH CHECK
   ═══════════════════════════════════════════════════════ */
app.get('/health', (req, res) => res.json({ status: 'ok' }));

/* ═══════════════════════════════════════════════════════
   START — local dev only (Vercel imports this as a module)
   ═══════════════════════════════════════════════════════ */
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✓ Server avviato → http://localhost:${PORT}`);
  });
}

module.exports = app;
