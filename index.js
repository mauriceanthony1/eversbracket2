'use strict';
const express = require('express');
const path    = require('path');
const fetch   = require('node-fetch');

const { BRACKET, SEED_PICKS, SCORING, USERS, ROUNDS } = require('./data');

const app  = express();
const PORT = process.env.PORT || 3000;

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  next();
});

app.use(express.json());

// Serve static files from ROOT (where index.html actually lives)
app.use(express.static(path.join(__dirname, 'public')));
// Supabase helpers
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY;

async function sbGet(table) {
  if (!SB_URL || !SB_KEY) return [];
  try {
    const url = `${SB_URL}/rest/v1/${table}?select=*`;
    const r = await fetch(url, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
    return r.ok ? await r.json() : [];
  } catch (e) { console.error('sbGet error:', e.message); return []; }
}

async function sbUpsert(table, row) {
  if (!SB_URL || !SB_KEY) return true;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(row)
    });
    return r.ok;
  } catch (e) { console.error('sbUpsert error:', e.message); return false; }
}

// Cache + other functions (unchanged)
let picksCache = {};
let resultsCache = {};
let picksLocked = false;

async function loadCache() {
  console.log('Loading cache... Supabase:', !!SB_URL);
  try {
    const rows = await sbGet('bracket_picks');
    if (Array.isArray(rows) && rows.length > 0) {
      rows.forEach(r => { if (r.user_name !== '__lock__') picksCache[r.user_name] = r.picks; });
      const lockRow = rows.find(r => r.user_name === '__lock__');
      if (lockRow && lockRow.picks && lockRow.picks.locked) picksLocked = true;
    }
    for (const user of USERS) {
      if (!picksCache[user]) {
        console.log(`Seeding ${user}`);
        await sbUpsert('bracket_picks', { user_name: user, picks: SEED_PICKS[user] });
        picksCache[user] = SEED_PICKS[user];
      }
    }
    const rrows = await sbGet('bracket_results');
    if (Array.isArray(rrows)) rrows.forEach(r => resultsCache[r.game_id] = r.winner);
    console.log(`Cache ready → Users: ${Object.keys(picksCache).length} | Results: ${Object.keys(resultsCache).length}`);
  } catch (e) {
    console.error('Cache load failed:', e.message);
    USERS.forEach(u => { if (!picksCache[u]) picksCache[u] = SEED_PICKS[u]; });
  }
}

function buildRoundWinners() {
  const rw = {};
  ROUNDS.forEach(r => rw[r] = new Set());
  Object.entries(resultsCache).forEach(([id, winner]) => {
    const lo = id.toLowerCase();
    if (lo.startsWith('chip')) ROUNDS.forEach(r => rw[r].add(winner));
    else if (lo.startsWith('f4')) ['R64','R32','S16','E8','F4'].forEach(r => rw[r].add(winner));
    else if (lo.startsWith('e8')) ['R64','R32','S16','E8'].forEach(r => rw[r].add(winner));
    else if (lo.startsWith('s16')) ['R64','R32','S16'].forEach(r => rw[r].add(winner));
    else if (lo.startsWith('r32')) ['R64','R32'].forEach(r => rw[r].add(winner));
    else rw['R64'].add(winner);
  });
  return rw;
}

function calcLeaderboard() {
  const roundWinners = buildRoundWinners();
  return USERS.map(user => {
    const picks = picksCache[user] || {};
    let points = 0, correct = 0;
    const rounds = {};
    ROUNDS.forEach(rnd => {
      rounds[rnd] = 0;
      (picks[rnd] || []).forEach(team => {
        if (roundWinners[rnd].has(team)) {
          points += SCORING[rnd];
          correct += 1;
          rounds[rnd]++;
        }
      });
    });
    return { user, points, correct, rounds };
  }).sort((a, b) => b.points - a.points || b.correct - a.correct);
}

// ── Auto-scoring helpers ──────────────────────────────────────────────────────

// All bracket team short-names for fuzzy matching
const ALL_BRACKET_TEAMS = [...new Set(
  Object.values(BRACKET.bracket).flatMap(matchups =>
    matchups.flatMap(m => [m.team1, m.team2])
  )
)];

// Manual overrides for ESPN display names that don't contain the bracket short-name
// (e.g. "Miami FL" won't appear in "Miami Hurricanes") or that are ambiguous.
const ESPN_NAME_OVERRIDES = {
  'miami hurricanes':        'Miami FL',
  'miami (fl)':              'Miami FL',
  'miami ohio redhawks':     'Miami OH',
  'miami ohio':              'Miami OH',
  'miami (oh)':              'Miami OH',
  "saint mary's gaels":      'Saint Marys',
  "st. mary's gaels":        'Saint Marys',
  "saint mary's":            'Saint Marys',
  "st. mary's":              'Saint Marys',
};

// Map an ESPN full display name → bracket short name (e.g. "Duke Blue Devils" → "Duke")
// Sorted longest-first so "Michigan State" matches before "Michigan", "Iowa State" before "Iowa", etc.
function espnToBracketName(espnName) {
  if (!espnName) return null;
  const lower = espnName.toLowerCase();

  // Check explicit overrides first (handles abbreviations like "Miami FL")
  if (ESPN_NAME_OVERRIDES[lower]) return ESPN_NAME_OVERRIDES[lower];

  // Sort by full name length descending so more-specific names win:
  // "Michigan State Spartans" → matches "Michigan State" (15 chars) before "Michigan" (8 chars)
  const sorted = [...ALL_BRACKET_TEAMS].sort((a, b) => b.length - a.length);
  return sorted.find(short => lower.includes(short.toLowerCase())) || null;
}

// Detect tournament round from ESPN competition notes / event name
function detectRound(event) {
  const comp = event.competitions?.[0];
  const notes = (comp?.notes || []).map(n => (n.headline || n.type || '')).join(' ');
  const eventName = event.name || event.shortName || '';
  const text = (notes + ' ' + eventName).toLowerCase();

  if (text.includes('first round') || text.includes('round of 64'))  return 'R64';
  if (text.includes('second round') || text.includes('round of 32')) return 'R32';
  if (text.includes('sweet 16') || text.includes('sweet sixteen'))   return 'S16';
  if (text.includes('elite eight') || text.includes('elite 8'))      return 'E8';
  if (text.includes('final four'))                                    return 'F4';
  if (text.includes('national championship') || text.includes('championship game')) return 'CHIP';
  return null;
}

// Auto-score any finished ESPN games not yet in resultsCache
async function autoScoreFromESPN(rawEvents) {
  let leaderboardChanged = false;

  for (const event of rawEvents) {
    const comp = event.competitions?.[0];
    if (!comp || comp.status?.type?.state !== 'post') continue;

    const round = detectRound(event);
    if (!round) continue;

    const winnerComp = comp.competitors?.find(t => t.winner);
    if (!winnerComp) continue;

    const winnerShort = espnToBracketName(winnerComp.team?.displayName);
    if (!winnerShort) continue;

    // Use ESPN event ID + round as stable game_id (prefix must match round for buildRoundWinners)
    const gameId = `${round.toLowerCase()}_espn_${event.id}`;
    if (resultsCache[gameId]) continue; // already recorded

    console.log(`[auto-score] ${round}: ${winnerShort} (ESPN id ${event.id})`);
    resultsCache[gameId] = winnerShort;
    await sbUpsert('bracket_results', { game_id: gameId, winner: winnerShort });
    leaderboardChanged = true;
  }

  return leaderboardChanged;
}

// ── ESPN fetch (raw events for auto-scoring + formatted for display) ──────────
async function fetchRawEvents() {
  try {
    const r = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?groups=50&limit=200');
    const d = await r.json();
    return d.events || [];
  } catch { return []; }
}

function formatScores(rawEvents) {
  return rawEvents.map(e => {
    const comp = e.competitions?.[0];
    return {
      id: e.id,
      statusState: comp?.status?.type?.state,
      statusDetail: comp?.status?.type?.shortDetail,
      teams: (comp?.competitors || []).map(t => ({
        name: t.team?.displayName,
        score: t.score,
        winner: t.winner
      }))
    };
  });
}

async function fetchScores() {
  return formatScores(await fetchRawEvents());
}

const sseClients = new Set();
function broadcast(payload) {
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  sseClients.forEach(res => { try { res.write(msg); } catch {} });
}

setInterval(async () => {
  const rawEvents = await fetchRawEvents();

  // Auto-score any newly finished games
  const changed = await autoScoreFromESPN(rawEvents);

  broadcast({ type: 'scores', data: formatScores(rawEvents) });
  // Always broadcast leaderboard; if scoring changed it will reflect new points
  broadcast({ type: 'leaderboard', data: calcLeaderboard() });
}, 45000);

// API Routes
app.get('/api/bracket', (_, res) => res.json(BRACKET));
app.get('/api/scores', async (_, res) => res.json({ games: await fetchScores() }));
app.get('/api/leaderboard', (_, res) => res.json({ leaderboard: calcLeaderboard() }));

app.get('/api/picks/:user', (req, res) => {
  const user = req.params.user;
  if (!USERS.includes(user)) return res.status(404).json({ error: 'User not found' });
  res.json({ user, picks: picksCache[user] || {} });
});

app.post('/api/picks/:user', async (req, res) => {
  const user = req.params.user;
  if (!USERS.includes(user)) return res.status(404).json({ error: 'User not found' });
  if (picksLocked) return res.status(423).json({ error: 'Picks are locked' });
  picksCache[user] = req.body;
  await sbUpsert('bracket_picks', { user_name: user, picks: req.body });
  broadcast({ type: 'picks', user, picks: req.body });
  res.json({ ok: true });
});

app.post('/api/results', async (req, res) => {
  const { game_id, winner, secret } = req.body;
  if (secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Forbidden' });
  resultsCache[game_id] = winner;
  await sbUpsert('bracket_results', { game_id, winner });
  broadcast({ type: 'leaderboard', data: calcLeaderboard() });
  res.json({ ok: true });
});

app.get('/api/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  sseClients.add(res);

  res.write(`data: ${JSON.stringify({ type: 'leaderboard', data: calcLeaderboard() })}\n\n`);
  res.write(`data: ${JSON.stringify({ type: 'scores', data: await fetchScores() })}\n\n`);
  USERS.forEach(u => res.write(`data: ${JSON.stringify({ type: 'picks', user: u, picks: picksCache[u] || {} })}\n\n`));

  res.write('data: ' + JSON.stringify({ type: 'lock', locked: picksLocked }) + '\n\n');
  req.on('close', () => sseClients.delete(res));
});

app.post('/api/admin/lock', async (req, res) => {
  const { locked, secret } = req.body;
  if (secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: 'Forbidden' });
  picksLocked = !!locked;
  await sbUpsert('bracket_picks', { user_name: '__lock__', picks: { locked: picksLocked } });
  broadcast({ type: 'lock', locked: picksLocked });
  res.json({ ok: true, locked: picksLocked });
});

// Fallback route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start
loadCache().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`Supabase: ${SB_URL ? 'CONNECTED' : 'NOT SET'}`);
    console.log(`Admin secret: ${process.env.ADMIN_SECRET ? 'SET' : 'NOT SET'}`);
  });
});
