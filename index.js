'use strict';
const express = require('express');
const path    = require('path');
const fetch   = require('node-fetch');

const { BRACKET, SEED_PICKS, SCORING, USERS, ROUNDS } = require('./data');

const app  = express();
const PORT = process.env.PORT || 3000;

// CORS for all routes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  next();
});

app.use(express.json());

// Serve static files from the 'src' folder (this is where Render puts your files)
app.use(express.static(path.join(__dirname, 'src')));

// ── Supabase helpers ─────────────────────────────────────
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY;

async function sbGet(table) {
  if (!SB_URL || !SB_KEY) return [];
  try {
    const url = `${SB_URL}/rest/v1/${table}?select=*`;
    const r = await fetch(url, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
    });
    return r.ok ? await r.json() : [];
  } catch (e) { 
    console.error('sbGet error:', e.message); 
    return []; 
  }
}

async function sbUpsert(table, row) {
  if (!SB_URL || !SB_KEY) return true;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates'
      },
      body: JSON.stringify(row)
    });
    return r.ok;
  } catch (e) { 
    console.error('sbUpsert error:', e.message); 
    return false; 
  }
}

// In-memory cache
let picksCache = {};
let resultsCache = {};

async function loadCache() {
  console.log('Loading cache... Supabase connected:', !!SB_URL);
  try {
    const rows = await sbGet('bracket_picks');
    if (Array.isArray(rows) && rows.length > 0) {
      rows.forEach(r => picksCache[r.user_name] = r.picks);
      console.log('Loaded picks from Supabase for:', Object.keys(picksCache));
    } else {
      console.log('No picks in Supabase - using seed data');
    }

    for (const user of USERS) {
      if (!picksCache[user]) {
        console.log(`Seeding ${user}`);
        await sbUpsert('bracket_picks', { user_name: user, picks: SEED_PICKS[user] });
        picksCache[user] = SEED_PICKS[user];
      }
    }

    const rrows = await sbGet('bracket_results');
    if (Array.isArray(rrows)) {
      rrows.forEach(r => resultsCache[r.game_id] = r.winner);
    }

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
    let points = 0
