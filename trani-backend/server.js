require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const cors    = require('cors');
const helmet  = require('helmet');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ═══════════════════════════════════════════════════════
   DATABASE — Supabase Postgres (connessione diretta)
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
   CONSTANTS — deve corrispondere al frontend (7 zone)
   ═══════════════════════════════════════════════════════ */
const ZONE_NAMES = [
  'Via Andria', "Sant'Angelo", 'Via Superga',
  'Stadio', 'Centro', 'Pozzopiano', 'Capirro'
];
const VALID_ZONES = [0, 1, 2, 3, 4, 5, 6];

/* ═══════════════════════════════════════════════════════
   ROUTES — pubbliche
   ═══════════════════════════════════════════════════════ */

/** GET /api/stats — conteggio per zona */
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
    res.json({ stats: [] });
  }
});

/** GET /api/ideas?zone=2&limit=3 — idee recenti per zona */
app.get('/api/ideas', async (req, res) => {
  const zone  = Number(req.query.zone);
  const limit = Math.min(Number(req.query.limit) || 3, 10);

  if (!VALID_ZONES.includes(zone)) {
    return res.status(400).json({ error: 'Zona non valida' });
  }

  try {
    const [rows, countRow] = await Promise.all([
      pool.query(
        `SELECT name, text, street, type, created_at
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
    res.json({ ideas: [], total: 0 });
  }
});

/** GET /api/ideas/all?limit=100 — tutte le idee pubbliche */
app.get('/api/ideas/all', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 200);
  try {
    const result = await pool.query(
      `SELECT id, zone, zone_name, name, text, street, type, created_at
       FROM ideas
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json({ ideas: result.rows, total: result.rows.length });
  } catch (err) {
    console.error('GET /api/ideas/all:', err.message);
    res.json({ ideas: [], total: 0 });
  }
});

/** POST /api/ideas — invia nuova idea */
app.post('/api/ideas', async (req, res) => {
  const { zone, name, text, street, type } = req.body;
  const zoneIdx = Number(zone);

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
  const cleanType   = type === 'segnalazione' ? 'segnalazione' : 'idea';

  try {
    const result = await pool.query(
      `INSERT INTO ideas (zone, zone_name, name, text, street, type)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at`,
      [zoneIdx, ZONE_NAMES[zoneIdx], cleanName, cleanText, cleanStreet, cleanType]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /api/ideas:', err.message);
    res.status(500).json({ error: 'Errore del server' });
  }
});

/* ═══════════════════════════════════════════════════════
   ADMIN — autenticazione via header x-admin-auth (base64)
   Credenziali lette da variabili d'ambiente, mai nel codice
   ═══════════════════════════════════════════════════════ */
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;

function adminAuth(req, res, next) {
  const auth = req.headers['x-admin-auth'] || '';
  try {
    const [u, p] = Buffer.from(auth, 'base64').toString().split(':');
    if (u && u === ADMIN_USER && p === ADMIN_PASS) return next();
  } catch {}
  res.status(401).json({ error: 'Non autorizzato' });
}

/** POST /api/admin/verify — verifica credenziali (usato dal login frontend) */
app.post('/api/admin/verify', (req, res) => {
  const auth = req.headers['x-admin-auth'] || '';
  try {
    const [u, p] = Buffer.from(auth, 'base64').toString().split(':');
    if (u && u === ADMIN_USER && p === ADMIN_PASS) {
      return res.json({ ok: true });
    }
  } catch {}
  res.status(401).json({ error: 'Credenziali errate' });
});

/** GET /api/admin/ideas — tutte le idee (admin autenticato) */
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

/** DELETE /api/admin/ideas/:id — elimina idea per UUID */
app.delete('/api/admin/ideas/:id', adminAuth, async (req, res) => {
  const id = req.params.id;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!id || !UUID_RE.test(id)) {
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

/* Serve la pagina admin come file statico */
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'admin.html'));
});

/* ═══════════════════════════════════════════════════════
   HEALTH CHECK
   ═══════════════════════════════════════════════════════ */
app.get('/health', (req, res) => res.json({ status: 'ok' }));

/* ═══════════════════════════════════════════════════════
   START — solo in locale (Vercel importa come modulo)
   ═══════════════════════════════════════════════════════ */
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✓ Server avviato → http://localhost:${PORT}`);
  });
}

module.exports = app;
