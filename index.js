'use strict';
const express = require('express');
const path    = require('path');
const fetch   = require('node-fetch');

const { BRACKET, SEED_PICKS, SCORING, USERS, ROUNDS } = require('./data');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Supabase REST helpers ─────────────────────────────────────
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY;

async function sbGet(table, filters = {}) {
  let url = `${SB_URL}/rest/v1/${table}?`;
  Object.entries(filters).forEach(([k, v]) => { url += `${k}=eq.${encodeURIComponent(v)}&`; });
  url += 'select=*';
  const r = await fetch(url, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
  return r.json();
}

async function sbUpsert(table, row) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(row),
  });
  return r.ok;
}

// ── In-memory cache (refreshed from Supabase on startup) ──────
let picksCache   = {};
let resultsCache = {};

async function loadCache() {
  try {
    const rows = await sbGet('bracket_picks');
    if (Array.isArray(rows)) {
      rows.forEach(r => { picksCache[r.user_name] = r.picks; });
    }
    for (const user of USERS) {
      if (!picksCache[user]) {
        console.log(`Seeding picks for ${user} from backup…`);
        await sbUpsert('bracket_picks', { user_name: user, picks: SEED_PICKS[user] });
        picksCache[user] = SEED_PICKS[user];
      }
    }
    const rrows = await sbGet('bracket_results');
    if (Array.isArray(rrows)) {
      rrows.forEach(r => { resultsCache[r.game_id] = r.winner; });
    }
    console.log('Cache loaded. Picks:', Object.keys(picksCache), '| Results:', Object.keys(resultsCache).length, 'games');
  } catch (e) {
    console.error('Cache load error (continuing with seed data):', e.message);
    USERS.forEach(u => { if (!picksCache[u]) picksCache[u] = SEED_PICKS[u]; });
  }
}

// ── Leaderboard calculation ───────────────────────────────────
function calcLeaderboard() {
  return USERS.map(user => {
    const picks  = picksCache[user] || {};
    let points   = 0;
    let correct  = 0;
    const rounds = {};
    ROUNDS.forEach(rnd => {
      rounds[rnd] = 0;
      (picks[rnd] || []).forEach(team => {
        const isCorrect = Object.values(resultsCache).includes(team);
        if (isCorrect) { points += SCORING[rnd]; correct += 1; rounds[rnd]++; }
      });
    });
    return { user, points, correct, rounds };
  }).sort((a, b) => b.points - a.points || b.correct - a.correct);
}

// ── ESPN scores proxy ─────────────────────────────────────────
async function fetchScores() {
  try {
    const url = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?groups=50&limit=200';
    const r = await fetch(url, { timeout: 5000 });
    const d = await r.json();
    return (d.events || []).map(e => {
      const comp = e.competitions?.[0];
      return {
        id:           e.id,
        statusState:  comp?.status?.type?.state,
        statusDetail: comp?.status?.type?.shortDetail,
        teams: (comp?.competitors || []).map(t => ({
          name:   t.team?.displayName,
          abbr:   t.team?.abbreviation,
          score:  t.score,
          winner: t.winner,
        })),
      };
    });
  } catch { return []; }
}

// ── SSE clients ───────────────────────────────────────────────
const sseClients = new Set();

function broadcast(payload) {
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  sseClients.forEach(res => { try { res.write(msg); } catch {} });
}

setInterval(async () => {
  const games = await fetchScores();
  broadcast({ type: 'scores', data: games });
  broadcast({ type: 'leaderboard', data: calcLeaderboard() });
}, 45_000);

// ── Middleware ────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ────────────────────────────────────────────────
app.get('/api/bracket', (_, res) => res.json(BRACKET));

app.get('/api/scores', async (_, res) => {
  res.json({ games: await fetchScores() });
});

app.get('/api/leaderboard', (_, res) => {
  res.json({ leaderboard: calcLeaderboard(), lastUpdated: Date.now() });
});

app.get('/api/picks/:user', (req, res) => {
  const user = req.params.user;
  if (!USERS.includes(user)) return res.status(404).json({ error: 'User not found' });
  res.json({ user, picks: picksCache[user] || {} });
});

app.post('/api/picks/:user', async (req, res) => {
  const user = req.params.user;
  if (!USERS.includes(user)) return res.status(404).json({ error: 'User not found' });
  picksCache[user] = req.body;
  const ok = await sbUpsert('bracket_picks', { user_name: user, picks: req.body });
  broadcast({ type: 'picks', user, picks: req.body });
  res.json({ ok });
});

app.post('/api/results', async (req, res) => {
  const { game_id, winner, secret } = req.body;
  if (secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Forbidden' });
  resultsCache[game_id] = winner;
  await sbUpsert('bracket_results', { game_id, winner });
  broadcast({ type: 'leaderboard', data: calcLeaderboard() });
  res.json({ ok: true, leaderboard: calcLeaderboard() });
});

app.get('/api/stream', async (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  sseClients.add(res);
  res.write(`data: ${JSON.stringify({ type: 'leaderboard', data: calcLeaderboard() })}\n\n`);
  const scores = await fetchScores();
  res.write(`data: ${JSON.stringify({ type: 'scores', data: scores })}\n\n`);
  USERS.forEach(u => {
    res.write(`data: ${JSON.stringify({ type: 'picks', user: u, picks: picksCache[u] || {} })}\n\n`);
  });
  req.on('close', () => sseClients.delete(res));
});

// ── Start ─────────────────────────────────────────────────────
loadCache().then(() => {
  app.listen(PORT, () => console.log(`eversbracket running on :${PORT}`));
});
