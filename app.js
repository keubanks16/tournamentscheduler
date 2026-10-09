/* Tournament Manager — pool play, scheduling, standings and championship bracket.
   Plain JavaScript, no build step. Everything is stored in this browser (localStorage). */
(() => {
'use strict';

const KEY = 'tournament-manager-v5';
const OLD_KEY = 'tournament-manager-v4-all-teams';
const SESSION_KEY = 'tm-session';
/* Sign-in accounts. Only a SHA-256 of "username:password" is stored here. */
const ACCOUNTS = {
  luke: { hash: '1b4494ee699f677d90981675c58654af3b8fac0683d035e6755d585182feca1d', name: 'Luke', role: 'organizer', profile: 'butler' },
  admin: { hash: '8da193366e1554c08b2870c50f737b9587c3372b656151c4a96028af26f51334', name: 'Admin', role: 'admin' }
};
let user = null;   // the signed-in account key ('luke' | 'admin')
const account = () => (user && ACCOUNTS[user]) || null;
const isAdmin = () => !!account() && account().role === 'admin';
const lockedProfile = () => (account() && account().profile) || null;
const userKey = () => user ? `${KEY}:${user}` : KEY;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const EMBEDDED = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
const STANDALONE = !!((window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone);
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let installEvt = null;
const LIVE_API = location.hostname === 'localhost' ? 'http://localhost:8787' : 'https://tournament-live.kollinmeubanks.workers.dev';
let liveView = null;   // { id, updated, error } when following someone else's live link
const REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const SAMPLE = ['GS Baseball', 'Dirtdogs', 'Bandits', 'Titans', 'Warriors', 'Braves', 'Bulldogs', 'Raptors'];
const RIBBON = '<svg class="ribbon" viewBox="0 0 24 32" aria-hidden="true"><path fill="currentColor" d="M12 1.5c-3.3 0-5.6 2.4-5.6 5.6 0 2.2 1.1 4.6 2.9 7.5L2.6 26.2l3.6 2.6 5.8-9.6 5.8 9.6 3.6-2.6-6.7-11.6c1.8-2.9 2.9-5.3 2.9-7.5 0-3.2-2.3-5.6-5.6-5.6Zm0 3.4c1.3 0 2.2 1 2.2 2.3 0 1.3-.8 3-2.2 5.3-1.4-2.3-2.2-4-2.2-5.3 0-1.3.9-2.3 2.2-2.3Z"/></svg>';
const PROFILES = {
  standard: { label: 'Standard' },
  butler: {
    label: 'Butler Fire Department',
    presenter: 'Presented by Butler Fire Department',
    logo: 'icons/butler-fd.png',
    logoAlt: 'Butler Fire Department badge',
    tagline: 'Together we fight',
    cause: 'Raise awareness. Support survivors. Find a cure.',
    thanks: 'Thank you for supporting the fight against breast cancer.',
    themeColor: '#050506',
    event: {
      name: 'Breast Cancer Awareness One Pitch Softball',
      date: '2026-10-24',
      location: 'Taylor County Rec Department, 183 Charing Road, Butler, GA 31006'
    },
    details: ['Co-ed teams · All skill levels welcome', '$200 per team · Proceeds support breast cancer research & support', 'Info: Luke Arnold · lmarnold@gmail.com']
  }
};
const profileOf = () => PROFILES[state.profile] || PROFILES.standard;
const TIE = { pct: ['Win %', 'PCT'], h2h: ['Head-to-head', 'H2H'], rd: ['Run differential', 'RD'], ra: ['Fewest runs allowed', 'RA'], rf: ['Most runs scored', 'RF'] };

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
};

/* ============================ State ============================ */
function defaults() {
  return {
    v: 5, profile: 'standard', name: '', date: '', location: '', teams: [], order: [], short: [],
    settings: { gamesPerTeam: 3, fields: ['Field 1', 'Field 2'], startTime: '08:00', slotMinutes: 90, bracketFormat: 'single', advance: 0, runCap: 0, ties: ['pct', 'h2h', 'rd', 'ra', 'rf'] },
    games: [], bracket: null, tab: 'setup', demo: false
  };
}
let state = defaults();
let viewOnly = false;
const ui = { team: '', edit: false, printSel: 'both' };

function normalize(s) {
  const d = defaults();
  const o = { ...d, ...(s || {}), settings: { ...d.settings, ...((s && s.settings) || {}) } };
  if (!Array.isArray(o.settings.fields) || !o.settings.fields.length) o.settings.fields = ['Field 1'];
  const t = (o.settings.ties || []).filter(k => TIE[k]);
  Object.keys(TIE).forEach(k => { if (!t.includes(k)) t.push(k); });
  o.settings.ties = t;
  o.games = (o.games || []).map(g => ({ ...g, sa: g.sa ?? '', sb: g.sb ?? '', field: Math.min(o.settings.fields.length - 1, Math.max(0, +g.field || 0)) }));
  o.teams = Array.isArray(o.teams) ? o.teams : [];
  o.order = Array.isArray(o.order) ? o.order : [];
  o.short = Array.isArray(o.short) ? o.short : [];
  if (o.live && !(o.live.id && o.live.key)) o.live = null;
  if (o.bracket) { o.bracket = { results: {}, overrides: {}, delay: 0, ...o.bracket }; if (!o.bracket.count) o.bracket.count = (o.bracket.seeds || []).length; }
  return o;
}
function migrateOld(raw) {
  try {
    const s = JSON.parse(raw); const n = defaults();
    n.name = s.name || ''; n.teams = s.teams || []; n.order = (s.pools && s.pools[0]) || [];
    const fc = Math.max(1, +s.fieldCount || 1);
    n.settings.fields = Array.from({ length: fc }, (_, i) => `Field ${i + 1}`);
    n.settings.startTime = s.startTime || '09:00';
    n.settings.slotMinutes = +s.slotMinutes || 75;
    n.settings.gamesPerTeam = s.gamesPerTeam ?? 2;
    n.settings.bracketFormat = s.bracketFormat || 'single';
    n.games = (s.games || []).map((g, i) => ({ id: 'g' + i, a: g.a, b: g.b, sa: g.sa ?? '', sb: g.sb ?? '', time: g.time || n.settings.startTime, field: Math.min(fc - 1, Math.max(0, (+g.field || 1) - 1)) }));
    n.tab = n.games.length ? 'schedule' : 'setup';
    return n;
  } catch (e) { return null; }
}
function freshFor(profileKey) {
  const s = defaults(), P = PROFILES[profileKey];
  s.profile = profileKey;
  if (P && P.event) { s.name = P.event.name; s.date = P.event.date; s.location = P.event.location; }
  return s;
}
function load() {
  const raw = store.get(userKey());
  if (raw) { try { state = normalize(JSON.parse(raw)); enforceProfile(); return; } catch (e) { /* fall through */ } }
  if (lockedProfile()) { state = freshFor(lockedProfile()); persist(); return; }
  // Admin (or no account): pick up a tournament saved before sign-in existed
  const legacy = store.get(KEY);
  if (legacy) { try { state = normalize(JSON.parse(legacy)); persist(); return; } catch (e) { /* fall through */ } }
  const old = store.get(OLD_KEY);
  if (old) { const m = migrateOld(old); if (m && m.teams.length) { state = normalize(m); persist(); return; } }
  state = makeDemo();
}
function enforceProfile() { if (lockedProfile()) state.profile = lockedProfile(); }
function persist() { if (!viewOnly) store.set(userKey(), JSON.stringify(state)); }
function save() { if (viewOnly) return; persist(); queueSync(); }

/* ============================ Time ============================ */
const toMin = t => { if (typeof t === 'number') return t; const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const toHHMM = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const fmt = t => { const m = toMin(t); const h = Math.floor(m / 60) % 24, mm = ((m % 60) + 60) % 60; return `${h % 12 || 12}:${String(mm).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
const fmtDate = d => { if (!d) return ''; const [y, mo, da] = d.split('-').map(Number); if (!y) return ''; return new Date(y, mo - 1, da).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }); };
const pctStr = p => p >= 1 ? '1.000' : '.' + String(Math.round(p * 1000)).padStart(3, '0');
const fieldName = i => state.settings.fields[i] || `Field ${i + 1}`;
const isFinal = g => g.sa !== '' && g.sb !== '' && g.sa != null && g.sb != null;

/* ============================ Helpers ============================ */
function shuffle(a) { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const pairKey = (a, b) => a < b ? a + '\u0001' + b : b + '\u0001' + a;
const domId = s => String(s).replace(/[^\w-]/g, c => '_' + c.charCodeAt(0));
function uid() { return Math.random().toString(36).slice(2, 9); }
function nextPow2(n) { let p = 1; while (p < n) p *= 2; return p; }
function seedPositions(size) { let a = [1]; while (a.length < size) { const n = a.length * 2; a = a.flatMap(x => [x, n + 1 - x]); } return a; }

/* ===================== Pool games & scheduling ===================== */
function circleRounds(teams) {
  const a = [...teams]; if (a.length % 2) a.push(null);
  const n = a.length, rounds = [];
  let cur = a;
  for (let r = 0; r < n - 1; r++) {
    const round = [];
    for (let i = 0; i < n / 2; i++) {
      const x = cur[i], y = cur[n - 1 - i];
      if (x && y) round.push(r % 2 && i === 0 ? [y, x] : [x, y]);
    }
    rounds.push(round);
    cur = [cur[0], cur[n - 1], ...cur.slice(1, n - 1)];
  }
  return rounds;
}
function buildPairs(order, N) {
  const n = order.length, rounds = circleRounds(order);
  if (!N || N >= n - 1) return { pairs: rounds.flat(), short: [] };
  const count = Object.fromEntries(order.map(t => [t, 0])), played = new Set(), pairs = [];
  const add = (a, b) => { pairs.push([a, b]); count[a]++; count[b]++; played.add(pairKey(a, b)); };
  for (const round of rounds) for (const [a, b] of round) if (count[a] < N && count[b] < N) add(a, b);
  let short = order.filter(t => count[t] < N);
  for (let i = 0; i < short.length; i++) for (let j = i + 1; j < short.length; j++) {
    const a = short[i], b = short[j];
    if (count[a] < N && count[b] < N && !played.has(pairKey(a, b))) add(a, b);
  }
  short = order.filter(t => count[t] < N);
  return { pairs, short };
}
/* Fill each time slot field by field. Never double-book a team; prefer teams that sat out the
   previous slot, then teams that have played the fewest games so far. */
function trySlots(games, F, jitter) {
  const rem = games.map((g, i) => ({ g, i, r: jitter ? Math.random() * jitter : 0 })), last = new Map(), played = {}, out = [];
  let slot = 0, b2b = 0;
  while (rem.length && slot < 1000) {
    const used = new Set();
    for (let f = 0; f < F; f++) {
      let best = -1, bs = Infinity;
      for (let k = 0; k < rem.length; k++) {
        const { g, i, r } = rem[k];
        if (used.has(g.a) || used.has(g.b)) continue;
        const bb = (last.get(g.a) === slot - 1) + (last.get(g.b) === slot - 1);
        const s = bb * 100 + ((played[g.a] || 0) + (played[g.b] || 0)) * 3 + i * 0.01 + r;
        if (s < bs) { bs = s; best = k; }
      }
      if (best < 0) break;
      const { g } = rem.splice(best, 1)[0];
      if (last.get(g.a) === slot - 1) b2b++;
      if (last.get(g.b) === slot - 1) b2b++;
      out.push({ g, slot, field: f });
      used.add(g.a); used.add(g.b);
    }
    used.forEach(t => { last.set(t, slot); played[t] = (played[t] || 0) + 1; });
    slot++;
  }
  return { out, cost: slot * 10000 + b2b * 10 };
}
function assignSlots(games, startMin) {
  const F = state.settings.fields.length, len = state.settings.slotMinutes;
  let best = trySlots(games, F, 0);
  for (let k = 0; k < 300 && best.cost % 10000; k++) {
    const t = trySlots(games, F, 1 + (k % 5) * 4);
    if (t.cost < best.cost) best = t;
  }
  best.out.forEach(({ g, slot, field }) => { g.field = field; g.time = toHHMM(startMin + slot * len); });
}
function buildSchedule() {
  const { pairs, short } = buildPairs(state.order, state.settings.gamesPerTeam);
  state.games = pairs.map(([a, b]) => ({ id: 'g' + uid(), a, b, sa: '', sb: '', time: state.settings.startTime, field: 0 }));
  state.short = short;
  assignSlots(state.games, toMin(state.settings.startTime));
  state.bracket = null;
}
function retime() {
  const ordered = [...state.games].sort((x, y) => gMin(x) - gMin(y) || x.field - y.field);
  assignSlots(ordered, toMin(state.settings.startTime));
}
/* Pool game time in minutes, counting games after midnight as the next day */
function gMin(g) { const m = toMin(g.time), st = toMin(state.settings.startTime); return m < st - 180 ? m + 1440 : m; }
const poolSorted = () => [...state.games].sort((x, y) => gMin(x) - gMin(y) || x.field - y.field);

/* ============================ Standings ============================ */
function poolStats() {
  const cap = +state.settings.runCap || 0, r = {};
  state.order.forEach(t => { r[t] = { team: t, gp: 0, w: 0, l: 0, t: 0, rf: 0, ra: 0, rd: 0, pct: 0 }; });
  state.games.filter(isFinal).forEach(g => {
    const a = r[g.a], b = r[g.b]; if (!a || !b) return;
    const sa = +g.sa, sb = +g.sb;
    let d = sa - sb; if (cap) d = Math.max(-cap, Math.min(cap, d));
    a.gp++; b.gp++; a.rf += sa; a.ra += sb; b.rf += sb; b.ra += sa; a.rd += d; b.rd -= d;
    if (sa > sb) { a.w++; b.l++; } else if (sb > sa) { b.w++; a.l++; } else { a.t++; b.t++; }
  });
  Object.values(r).forEach(x => { x.pct = x.gp ? (x.w + x.t * 0.5) / x.gp : 0; });
  return r;
}
function rankTeams() {
  const stats = poolStats(), finals = state.games.filter(isFinal), ties = state.settings.ties, notes = {};
  const drawIdx = t => state.order.indexOf(t);
  function value(k, t, group) {
    const s = stats[t];
    if (k === 'h2h') {
      const set = new Set(group);
      for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++)
        if (!finals.some(g => pairKey(g.a, g.b) === pairKey(group[i], group[j]))) return 0;
      let w = 0, gp = 0;
      finals.forEach(g => {
        if (!set.has(g.a) || !set.has(g.b) || (g.a !== t && g.b !== t)) return;
        gp++; const mine = g.a === t ? +g.sa : +g.sb, theirs = g.a === t ? +g.sb : +g.sa;
        w += mine > theirs ? 1 : mine === theirs ? 0.5 : 0;
      });
      return gp ? w / gp : 0;
    }
    if (k === 'ra') return -s.ra;
    return s[k];
  }
  function rank(group, k) {
    if (group.length < 2) return group;
    if (k >= ties.length) { group.forEach(t => { notes[t] = notes[t] || 'Draw'; }); return [...group].sort((a, b) => drawIdx(a) - drawIdx(b)); }
    const key = ties[k], vals = new Map(group.map(t => [t, value(key, t, group)]));
    const sorted = [...group].sort((a, b) => vals.get(b) - vals.get(a));
    const buckets = [];
    sorted.forEach(t => { const lb = buckets[buckets.length - 1]; if (lb && Math.abs(vals.get(lb[0]) - vals.get(t)) < 1e-9) lb.push(t); else buckets.push([t]); });
    if (buckets.length === 1) return rank(group, k + 1);
    if (k > 0) group.forEach(t => { notes[t] = notes[t] || TIE[key][1]; });
    return buckets.flatMap(b => b.length > 1 ? rank(b, 0) : b);
  }
  const anyGames = finals.length > 0;
  const order = anyGames ? rank([...state.order], 0) : [...state.order];
  return order.map(t => ({ ...stats[t], note: anyGames ? notes[t] || '' : '' }));
}
function advancingCount() { const n = state.order.length, a = +state.settings.advance || 0; return a && a < n ? a : n; }
function projectedSeeds() { return rankTeams().slice(0, advancingCount()).map(r => r.team); }

/* ============================ Bracket ============================ */
function poolEnd() { return state.games.length ? Math.max(...state.games.map(gMin)) : toMin(state.settings.startTime) - state.settings.slotMinutes; }
function bracketStart() { return poolEnd() + state.settings.slotMinutes; }
function roundName(r, total) { const left = total - r; return left === 1 ? 'Championship' : left === 2 ? 'Semifinals' : left === 3 ? 'Quarterfinals' : `Round ${r + 1}`; }
function resultFor(br, key, a, b) { const r = br.results[key]; return r && a && b && r.a === a.team && r.b === b.team ? r : null; }
function timeFor(br, key, structural, res, fieldIdx) {
  const ov = br.overrides[key] || {};
  if (res && res.sa !== '' && res.sb !== '' && res.time != null) return { time: res.time, field: res.field ?? fieldIdx };
  return { time: ov.time != null ? ov.time : structural + (br.delay || 0), field: ov.field != null ? ov.field : fieldIdx };
}
function finishMatch(m, res) {
  m.sa = res ? res.sa : ''; m.sb = res ? res.sb : '';
  m.final = !!(res && res.sa !== '' && res.sb !== '');
  m.tied = m.final && +res.sa === +res.sb;
  m.winner = m.final && !m.tied ? (+res.sa > +res.sb ? m.a : m.b) : null;
  m.loser = m.winner ? (m.winner === m.a ? m.b : m.a) : null;
}
const known = sd => !!(sd && sd.team);
const sideName = sd => sd ? (sd.team || `#${sd.seed} TBD`) : '';
function poolDone() { return state.games.length > 0 && state.games.every(isFinal); }
/* Seeds stay "#1 TBD" until every pool game is final, then fill from the standings.
   They lock once the first bracket score goes in. */
function bracketSeeds(br) {
  if (br.seeds) return br.seeds;
  if (poolDone()) return projectedSeeds().slice(0, br.count);
  return Array(br.count).fill(null);
}
function resolveSingle(br) {
  const F = state.settings.fields.length, len = state.settings.slotMinutes;
  const seeds = bracketSeeds(br), size = nextPow2(seeds.length), pos = seedPositions(size);
  const ent = s => s <= seeds.length ? { team: seeds[s - 1] || null, seed: s } : null;
  const rounds = [];
  const total = Math.log2(size);
  let num = state.games.length + 1;
  for (let r = 0; r < total; r++) {
    const count = size / 2 ** (r + 1), round = [];
    for (let i = 0; i < count; i++) {
      const key = `S${r}-${i}`;
      let a, b, aLabel = '', bLabel = '';
      if (r === 0) { a = ent(pos[2 * i]); b = ent(pos[2 * i + 1]); }
      else {
        const pa = rounds[r - 1][2 * i], pb = rounds[r - 1][2 * i + 1];
        a = pa.winner; b = pb.winner;
        aLabel = pa.bye ? '' : `Winner of G${pa.num}`; bLabel = pb.bye ? '' : `Winner of G${pb.num}`;
      }
      const m = { key, r, i, a, b, aLabel, bLabel, label: roundName(r, total), bye: r === 0 && (!a || !b) };
      if (m.bye) { m.winner = a || b; m.final = true; m.sa = m.sb = ''; }
      else { m.num = num++; finishMatch(m, resultFor(br, key, a, b)); }
      round.push(m);
    }
    rounds.push(round);
  }
  // times: round by round after pool play
  let cursor = bracketStart();
  rounds.forEach(round => {
    const real = round.filter(m => !m.bye);
    real.forEach((m, j) => {
      const tf = timeFor(br, m.key, cursor + Math.floor(j / F) * len, resultFor(br, m.key, m.a, m.b), j % F);
      m.time = tf.time; m.field = tf.field;
    });
    cursor += Math.max(1, Math.ceil(real.length / F)) * len;
  });
  const fin = rounds[rounds.length - 1][0];
  return { format: 'single', rounds, games: rounds.flat().filter(m => !m.bye), champion: fin && fin.winner ? fin.winner : null };
}
function resolveDouble(br) {
  const F = state.settings.fields.length, len = state.settings.slotMinutes;
  const PH = '\u0001seed';
  const seeds = bracketSeeds(br).map((t, i) => t || PH + (i + 1)), seedOf = t => seeds.indexOf(t) + 1;
  const ent = t => ({ team: t.startsWith(PH) ? null : t, seed: seedOf(t) });
  const losses = Object.fromEntries(seeds.map(t => [t, 0])), byeCount = {}, played = new Set();
  const rounds = []; let cursor = bracketStart(), num = state.games.length + 1, champion = null, finalStarted = false;
  for (let r = 0; r < 80; r++) {
    const alive = seeds.filter(t => losses[t] < 2);
    if (alive.length <= 1) { champion = alive[0] && !alive[0].startsWith(PH) ? ent(alive[0]) : null; break; }
    const zero = alive.filter(t => losses[t] === 0), one = alive.filter(t => losses[t] === 1);
    const games = [], byes = [];
    const mk = (a, b, label, group) => {
      const key = `D${r}:${a}|${b}`;
      games.push({ key, r, a: ent(a), b: ent(b), label, group, num: num++ });
    };
    const pairUp = (arr, label, group) => {
      const list = [...arr];
      if (list.length % 2) {
        let bi = 0; list.forEach((t, i) => { if ((byeCount[t] || 0) < (byeCount[list[bi]] || 0)) bi = i; });
        const t = list.splice(bi, 1)[0]; byeCount[t] = (byeCount[t] || 0) + 1; byes.push({ ...ent(t), group });
      }
      const pairs = [];
      while (list.length) pairs.push([list.shift(), list.pop()]);
      for (let i = 0; i < pairs.length; i++) {
        if (!played.has(pairKey(...pairs[i]))) continue;
        for (let j = i + 1; j < pairs.length; j++) {
          const [a, b] = pairs[i], [c, d] = pairs[j];
          if (!played.has(pairKey(a, d)) && !played.has(pairKey(c, b))) { pairs[i] = [a, d]; pairs[j] = [c, b]; break; }
        }
      }
      pairs.forEach(([a, b]) => mk(a, b, label, group));
    };
    if (zero.length === 1 && one.length === 1) { mk(zero[0], one[0], 'Championship', 'c'); finalStarted = true; }
    else if (finalStarted) mk(alive[0], alive[1], 'Championship · if necessary', 'c');
    else { pairUp(zero, 'Winners side', 'w'); pairUp(one, 'Elimination side', 'e'); }
    games.forEach((g, j) => {
      const res = resultFor(br, g.key, g.a, g.b);
      finishMatch(g, res);
      const tf = timeFor(br, g.key, cursor + Math.floor(j / F) * len, res, j % F);
      g.time = tf.time; g.field = tf.field;
      if (g.winner) { losses[g.loser.team]++; played.add(pairKey(g.a.team, g.b.team)); }
    });
    cursor += Math.max(1, Math.ceil(games.length / F)) * len;
    rounds.push({ games, byes, nextTime: cursor + (br.delay || 0) });
    if (games.some(g => !g.winner)) break;
  }
  return { format: 'double', rounds, games: rounds.flatMap(x => x.games), champion, losses, seeds: seeds.map(ent) };
}
function resolveBracket() { const br = state.bracket; if (!br) return null; return br.format === 'double' ? resolveDouble(br) : resolveSingle(br); }
function buildBracket() {
  state.bracket = { format: state.settings.bracketFormat, seeds: null, count: advancingCount(), results: {}, overrides: {}, delay: 0 };
}
function bracketHasScores() { const br = state.bracket; return !!br && Object.values(br.results).some(r => r.sa !== '' || r.sb !== ''); }
function seedsChanged() { const br = state.bracket; if (!br || !br.seeds) return false; const p = projectedSeeds().slice(0, br.count); return p.length !== br.seeds.length || p.some((t, i) => t !== br.seeds[i]); }

/* ============================ Scores ============================ */
function cleanScore(v) { v = String(v).replace(/\D/g, '').slice(0, 3); return v; }
function setScore(kind, id, side, v) {
  if (kind === 'pool') {
    const g = state.games.find(x => x.id === id); if (!g) return;
    g['s' + side] = v;
  } else {
    const B = resolveBracket(); const m = B && B.games.find(x => x.key === id);
    if (!m || !known(m.a) || !known(m.b)) return;
    const br = state.bracket;
    if (!br.seeds && poolDone()) br.seeds = projectedSeeds().slice(0, br.count);
    let r = br.results[id];
    if (!r || r.a !== m.a.team || r.b !== m.b.team) r = br.results[id] = { a: m.a.team, b: m.b.team, sa: '', sb: '' };
    r['s' + side] = v;
    if (r.sa !== '' && r.sb !== '') { if (r.time == null) { r.time = m.time; r.field = m.field; } }
    else { delete r.time; delete r.field; }
  }
  if (state.demo) state.demo = false;
  save();
}
function setTimeField(kind, id, what, v) {
  if (kind === 'pool') {
    const g = state.games.find(x => x.id === id); if (!g) return;
    if (what === 'time') g.time = v || g.time; else g.field = +v;
  } else {
    const br = state.bracket, ov = br.overrides[id] = br.overrides[id] || {};
    const r = br.results[id];
    if (what === 'time') { if (!v) return; const B = resolveBracket(); const m = B.games.find(x => x.key === id); const base = m ? m.time : 0; const day = Math.floor(base / 1440) * 1440; ov.time = day + toMin(v); if (r && r.time != null) r.time = ov.time; }
    else { ov.field = +v; if (r && r.field != null) r.field = +v; }
  }
  save();
}
function rainDelay(mins) {
  const unplayed = state.games.filter(g => !isFinal(g));
  if (unplayed.length) unplayed.forEach(g => { g.time = toHHMM(toMin(g.time) + mins); });
  else if (state.bracket) state.bracket.delay = (state.bracket.delay || 0) + mins;
  if (state.bracket) Object.entries(state.bracket.overrides).forEach(([k, o]) => {
    const r = state.bracket.results[k];
    if (o.time != null && !(r && r.sa !== '' && r.sb !== '')) o.time += mins;
  });
  save();
}

/* ============================ All games ============================ */
function allItems() {
  const items = poolSorted().map((g, i) => ({ kind: 'pool', id: g.id, num: i + 1, label: 'Pool A', t: gMin(g), field: g.field, a: { team: g.a }, b: { team: g.b }, sa: g.sa, sb: g.sb, final: isFinal(g) }));
  const B = resolveBracket();
  if (B) B.games.forEach(m => items.push({ kind: 'bracket', id: m.key, num: m.num, label: m.label, group: m.group, t: m.time, field: m.field, a: m.a, b: m.b, aLabel: m.aLabel, bLabel: m.bLabel, sa: m.sa, sb: m.sb, final: m.final, tied: m.tied, winner: m.winner }));
  items.sort((x, y) => x.t - y.t || x.field - y.field || x.num - y.num);
  return { items, B };
}
function winnerOf(it) {
  if (!it.final) return null;
  if (+it.sa > +it.sb) return it.a && it.a.team; if (+it.sb > +it.sa) return it.b && it.b.team; return null;
}

/* ============================ Demo ============================ */
function makeDemo() {
  const s = defaults();
  s.name = 'Fall Classic'; s.demo = true; s.tab = 'schedule';
  const d = new Date(); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  s.date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  s.teams = [...SAMPLE];
  s.order = ['Bandits', 'GS Baseball', 'Raptors', 'Titans', 'Braves', 'Dirtdogs', 'Warriors', 'Bulldogs'];
  const prev = state; state = s; buildSchedule();
  const scores = [[7, 3], [4, 5], [9, 2], [6, 6], [3, 1], [8, 4], [2, 5], [10, 7]];
  poolSorted().slice(0, 8).forEach((g, i) => { g.sa = String(scores[i][0]); g.sb = String(scores[i][1]); });
  const out = state; state = prev; return out;
}

/* ============================ Rendering ============================ */
function render() {
  renderMast();
  renderTabs();
  renderBanner();
  const t = state.tab;
  $$('.panel').forEach(p => { p.hidden = p.id !== 'tab-' + t; });
  if (t !== 'schedule') $('#scheduleList').innerHTML = '';   // keep score-box ids unique on the page
  if (t !== 'bracket') $('#bracketArea').innerHTML = '';
  if (t === 'setup') renderSetup();
  if (t === 'schedule') renderSchedule();
  if (t === 'standings') renderStandings();
  if (t === 'bracket') renderBracket();
  renderPrint();
}
function applyProfile() {
  const P = profileOf(), root = document.documentElement;
  if (state.profile && state.profile !== 'standard') root.dataset.profile = state.profile; else delete root.dataset.profile;
  const logo = $('#mastLogo');
  if (P.logo) { if (logo.getAttribute('src') !== P.logo) logo.src = P.logo; logo.alt = P.logoAlt || ''; logo.hidden = false; } else logo.hidden = true;
  const tag = $('#mastTag');
  tag.hidden = !P.tagline; if (P.tagline) tag.innerHTML = `${RIBBON}<span>${esc(P.tagline)}</span>`;
  const strip = $('#eventStrip');
  const bits = [];
  if (P.cause) bits.push(`<span class="ev-cause">${RIBBON}${esc(P.cause)}</span>`);
  if (state.location) bits.push(`<span class="ev-item">${esc(state.location)}</span>`);
  (P.details || []).forEach(d => bits.push(`<span class="ev-item ev-extra">${esc(d)}</span>`));
  strip.innerHTML = `<div class="ev-inner">${bits.join('')}</div>`;
  strip.hidden = !P.cause && !state.location;
  const fc = $('#footCause'); fc.hidden = !P.thanks; fc.textContent = P.thanks || '';
  const tc = document.querySelector('meta[name="theme-color"]'); if (tc) tc.setAttribute('content', P.themeColor || '#0a2342');
}
function renderMast() {
  applyProfile();
  $('#mastName').textContent = state.name || 'Tournament Manager';
  $('#mastName').classList.toggle('long', (state.name || '').length > 22);
  document.title = state.name ? `${state.name} · Tournament Manager` : 'Tournament Manager';
  const bits = [];
  if (profileOf().presenter) bits.push(profileOf().presenter);
  if (state.date) bits.push(fmtDate(state.date));
  if (state.order.length) bits.push(`${state.order.length} teams`);
  bits.push(`${state.settings.fields.length} field${state.settings.fields.length > 1 ? 's' : ''}`);
  $('#mastMeta').textContent = bits.join(' · ');
  const { items, B } = allItems();
  if (items.length) {
    const done = items.filter(i => i.final).length;
    $('#prog').hidden = false;
    $('#progLabel').textContent = B && B.champion ? `Champion: ${B.champion.team}` : `${done} of ${items.length}${B && B.format === 'double' && !B.champion ? '+' : ''} games final`;
    $('#progBar').style.width = (B && B.champion ? 100 : Math.round(done / items.length * 100)) + '%';
  } else $('#prog').hidden = true;
  renderLiveChip();
  const who = $('#whoami');
  if (who) { who.hidden = !user || viewOnly; who.textContent = account() ? `Signed in as ${account().name}${isAdmin() ? ' (admin)' : ''}` : ''; }
  $$('.needs-user').forEach(b => { b.hidden = !user || viewOnly; });
  $$('.needs-top').forEach(b => { b.hidden = EMBEDDED; });
  $$('.needs-browser').forEach(b => { b.hidden = EMBEDDED || STANDALONE; });
}
function renderTabs() {
  const has = state.games.length > 0;
  $$('.tabs [data-tab]').forEach(b => {
    const t = b.dataset.tab;
    b.setAttribute('aria-selected', String(state.tab === t));
    b.tabIndex = state.tab === t ? 0 : -1;
    b.disabled = t !== 'setup' && !has;
    if (t === 'setup') b.hidden = viewOnly;
  });
  const fin = state.games.filter(isFinal).length;
  $('#cnt-schedule').textContent = has ? `${fin}/${state.games.length}` : '';
  const B = resolveBracket();
  $('#cnt-bracket').textContent = B ? (B.champion ? '🏆' : 'Live') : '';
}
function renderBanner() {
  const el = $('#banner');
  if (liveView) {
    el.className = 'banner live';
    el.innerHTML = liveView.error
      ? `<p>${esc(liveView.error)}</p>`
      : `<p><span class="live-dot"></span><b>Live scoreboard.</b> Updates by itself${liveView.updated ? ` · last change ${esc(new Date(liveView.updated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}` : ''}.</p>`;
    el.hidden = false;
  } else if (viewOnly) {
    el.className = 'banner';
    el.innerHTML = `<p>You're viewing a shared snapshot. Changes here won't be saved.</p><div class="actions">${user ? '<button class="btn btn-sm" data-b="keep">Save as my tournament</button><button class="btn btn-sm" data-b="leave">Back to mine</button>' : ''}</div>`;
    el.hidden = false;
  } else if (state.demo) {
    el.className = 'banner';
    el.innerHTML = `<p>This is an example tournament with a few scores filled in. Look around, then start your own.</p><div class="actions"><button class="btn btn-sm btn-primary" data-b="fresh">Start my tournament</button><button class="btn btn-sm" data-b="dismiss">Keep the example</button></div>`;
    el.hidden = false;
  } else if (IS_IOS && !STANDALONE && !EMBEDDED && !store.get('tm-install-hint')) {
    el.className = 'banner';
    el.innerHTML = `<p>Put Tournament Manager on your Home Screen. It opens full screen and works with no signal.</p><div class="actions"><button class="btn btn-sm btn-primary" data-b="install">Show me how</button><button class="btn btn-sm" data-b="nohint">Not now</button></div>`;
    el.hidden = false;
  } else el.hidden = true;
}
let shareLink = '';
function liveUrl() { return state.live ? location.origin + location.pathname + '#live=' + state.live.id : ''; }
function showLink(url, label) {
  shareLink = url;
  $('#linkBox').hidden = !url; $('#shareUrl').value = url; $('#linkLabel').textContent = label;
  $('#shareCopy').hidden = !url; $('#shareNative').hidden = !url || !navigator.share;
}
function renderShare() {
  const on = !!state.live;
  $('#liveOff').hidden = on; $('#liveOn').hidden = !on; $('#stopLive').hidden = !on;
  $('#shareErr').textContent = '';
  if (on) {
    $('#liveStatus').textContent = sync.status === 'error' ? 'No connection right now. Scores will send when you are back online.' : sync.status === 'pending' ? 'Sending your latest scores…' : 'Anyone with the link sees your scores within a few seconds.';
    showLink(liveUrl(), 'Live link');
  } else showLink('', '');
}
function openShare() {
  $('#shareSheet').hidden = false; renderShare();
  (state.live && navigator.share ? $('#shareNative') : state.live ? $('#shareCopy') : $('#goLive')).focus();
}
function openInstall() {
  $('#installIOS').hidden = !IS_IOS && !!installEvt;
  $('#installOther').hidden = IS_IOS;
  $('#installNative').hidden = !installEvt;
  $('#installSheet').hidden = false;
  $('#installClose').focus();
}

/* ---------- Setup ---------- */
function teamList() { return [...new Set($('#teamsInput').value.split('\n').map(x => x.trim()).filter(Boolean))]; }
function renderSetup() {
  const S = state.settings;
  if (document.activeElement !== $('#tName')) $('#tName').value = state.name;
  $('#tDate').value = state.date || '';
  $('#tProfile').value = PROFILES[state.profile] ? state.profile : 'standard';
  $('#tProfile').closest('label').hidden = !!lockedProfile();
  if (document.activeElement !== $('#tLocation')) $('#tLocation').value = state.location || '';
  $('#profileNote').textContent = lockedProfile() ? `Tournament profile: ${profileOf().label}.` : profileOf().presenter ? `${profileOf().label} colors, badge and event details are applied everywhere, including live links.` : '';
  if (document.activeElement !== $('#teamsInput')) $('#teamsInput').value = state.teams.join('\n');
  $('#gamesPerTeam').value = String(S.gamesPerTeam);
  $('#startTime').value = S.startTime;
  if (document.activeElement !== $('#slotMinutes')) $('#slotMinutes').value = S.slotMinutes;
  $('#runCap').value = String(S.runCap || 0);
  $('#bracketFormat').value = S.bracketFormat;
  $('#fieldNum').textContent = S.fields.length;
  $('#fieldMinus').disabled = S.fields.length <= 1;
  $('#fieldPlus').disabled = S.fields.length >= 16;
  const fn = $('#fieldNames');
  if (!fn.contains(document.activeElement)) {
    fn.innerHTML = S.fields.map((f, i) => `<input id="field-${i}" data-fi="${i}" value="${esc(f)}" aria-label="Field ${i + 1} name">`).join('');
  }
  renderSetupDerived();
  const hasOrder = state.order.length > 0;
  $('#drawCard').hidden = !hasOrder;
  $('#drawList').innerHTML = state.order.map(t => `<li>${esc(t)}</li>`).join('');
}
function renderSetupDerived() {
  const S = state.settings, teams = teamList(), n = teams.length;
  $('#teamCount').textContent = n;
  const raw = $('#teamsInput').value.split('\n').map(x => x.trim()).filter(Boolean);
  const dupes = raw.length - n;
  const changed = state.order.length && (n !== state.order.length || teams.some(t => !state.order.includes(t)));
  const tn = $('#teamNote');
  tn.className = 'note' + (changed ? ' warn' : '');
  tn.textContent = [dupes ? `${dupes} duplicate name${dupes > 1 ? 's' : ''} ignored.` : '', changed ? 'The team list changed. Draw again to rebuild the schedule.' : ''].filter(Boolean).join(' ');
  // teams advancing options
  const adv = $('#advance'), cur = +S.advance || 0, opts = [[0, `All ${n || ''} teams`.replace('  ', ' ')]];
  [2, 4, 6, 8, 12, 16].forEach(k => { if (k < n) opts.push([k, `Top ${k}`]); });
  adv.innerHTML = opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  adv.value = opts.some(o => o[0] === cur) ? String(cur) : '0';
  // plan note
  const N = +S.gamesPerTeam, per = !N || N >= n - 1 ? Math.max(0, n - 1) : N;
  const poolGames = n < 2 ? 0 : (!N || N >= n - 1 ? n * (n - 1) / 2 : Math.floor(n * per / 2));
  const slots = Math.ceil(poolGames / S.fields.length);
  const end = toMin(S.startTime) + slots * S.slotMinutes;
  $('#planNote').textContent = n < 2 ? 'Add at least 2 teams to build a schedule.' :
    `${n} teams play ${per} pool game${per === 1 ? '' : 's'} each: ${poolGames} games across ${S.fields.length} field${S.fields.length > 1 ? 's' : ''}, about ${fmt(S.startTime)} to ${fmt(end)} before the bracket.` +
    (n % 2 && per % 2 && N && N < n - 1 ? ' With an odd number of teams, one team plays one fewer game.' : '');
  $('#drawBtn').textContent = state.games.length ? 'Re-draw pool & rebuild schedule' : 'Draw pool & build schedule';
  $('#retimeBtn').hidden = !state.games.length || changed;
}

/* ---------- Schedule ---------- */
function teamCell(side, label, it, hl) {
  if (!side) return `<span class="tm tbd">${esc(label || 'TBD')}</span>`;
  if (!side.team) return `<span class="tm tbd"><span class="seed">#${side.seed}</span><span>TBD</span></span>`;
  const won = winnerOf(it) === side.team;
  return `<span class="tm${won ? ' won' : ''}${hl === side.team ? ' mine' : ''}">${side.seed ? `<span class="seed">#${side.seed}</span>` : ''}<span>${esc(side.team)}</span></span>`;
}
function scoreInput(it, side) {
  const can = known(it.a) && known(it.b) && !viewOnly;
  const v = side === 'a' ? it.sa : it.sb;
  const name = side === 'a' ? sideName(it.a) : sideName(it.b);
  return `<input class="score" id="sc-${domId(it.id)}-${side}" inputmode="numeric" pattern="[0-9]*" maxlength="3" autocomplete="off" aria-label="${esc(name || 'TBD')} runs" data-kind="${it.kind}" data-id="${esc(it.id)}" data-side="${side}" value="${esc(v)}" ${can ? '' : 'disabled'}>`;
}
function editRow(it) {
  if (!ui.edit || viewOnly || (it.kind === 'bracket' && it.final)) return '';
  return `<div class="edit-row"><input type="time" id="tm-${domId(it.id)}" data-kind="${it.kind}" data-id="${esc(it.id)}" data-what="time" value="${toHHMM(it.t)}" aria-label="Start time"><select id="fd-${domId(it.id)}" data-kind="${it.kind}" data-id="${esc(it.id)}" data-what="field" aria-label="Field">${state.settings.fields.map((f, i) => `<option value="${i}" ${i === it.field ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select></div>`;
}
function statusTag(it, nextT) {
  if (it.final && it.tied && it.kind === 'bracket') return '<span class="tag bad">Tie: needs a winner</span>';
  if (it.final) return '<span class="tag final">Final</span>';
  if ((it.sa !== '' && it.sa != null) || (it.sb !== '' && it.sb != null)) return '<span class="tag live">In progress</span>';
  if (it.t === nextT && known(it.a) && known(it.b)) return '<span class="tag next">Up next</span>';
  return '';
}
function gameCard(it, nextT, hl) {
  const cls = ['game', it.final ? 'is-final' : '', !it.final && it.t === nextT ? 'is-next' : '', it.kind === 'bracket' ? 'is-bracket' : ''].join(' ');
  return `<article class="${cls}" data-card="${esc(it.id)}">
    <div class="game-meta"><span class="gno">G${it.num}</span><span>${esc(fieldName(it.field))}</span>${it.kind === 'bracket' ? `<span class="tag bracket">${esc(it.label)}</span>` : ''}<span class="spacer"></span><span data-status>${statusTag(it, nextT)}</span></div>
    ${editRow(it)}
    <div class="line">${teamCell(it.a, it.aLabel, it, hl)}${scoreInput(it, 'a')}</div>
    <div class="line">${teamCell(it.b, it.bLabel, it, hl)}${scoreInput(it, 'b')}</div>
  </article>`;
}
function renderSchedule() {
  const sel = $('#teamFilter');
  sel.innerHTML = `<option value="">All teams</option>` + state.order.map(t => `<option ${ui.team === t ? 'selected' : ''}>${esc(t)}</option>`).join('');
  if (ui.team && !state.order.includes(ui.team)) ui.team = '';
  sel.value = ui.team;
  $('#editToggle').checked = ui.edit;
  $('#editToggle').closest('label').hidden = viewOnly; $('#delaySel').closest('label').hidden = viewOnly;
  const { items } = allItems();
  const pending = items.filter(i => !i.final && known(i.a) && known(i.b));
  const nextT = pending.length ? Math.min(...pending.map(i => i.t)) : null;
  const shown = ui.team ? items.filter(i => (i.a && i.a.team === ui.team) || (i.b && i.b.team === ui.team)) : items;

  // team card
  const tc = $('#teamCard');
  if (ui.team) {
    const r = rankTeams(), idx = r.findIndex(x => x.team === ui.team), s = r[idx];
    tc.innerHTML = `<div class="team-card"><h3>${esc(ui.team)}</h3>
      <div class="stat"><b>${s.w}-${s.l}${s.t ? '-' + s.t : ''}</b><span>Record</span></div>
      <div class="stat"><b>${idx + 1}</b><span>Pool rank</span></div>
      <div class="stat"><b>${s.rd > 0 ? '+' : ''}${s.rd}</b><span>RD</span></div></div>`;
  } else tc.innerHTML = '';

  // conflicts
  const issues = [];
  const byTime = {};
  items.forEach(i => { (byTime[i.t] = byTime[i.t] || []).push(i); });
  Object.entries(byTime).forEach(([t, list]) => {
    const fields = {}, teams = {};
    list.forEach(i => {
      if (fields[i.field]) issues.push(`${fmt(+t)}: G${fields[i.field]} and G${i.num} are both on ${fieldName(i.field)}.`); else fields[i.field] = i.num;
      [i.a, i.b].forEach(s => { if (!s) return; if (teams[s.team]) issues.push(`${fmt(+t)}: ${s.team} is in G${teams[s.team]} and G${i.num} at the same time.`); else teams[s.team] = i.num; });
    });
  });
  $('#conflicts').innerHTML = issues.length ? `<div class="banner warn"><p><strong>Schedule conflicts.</strong> ${issues.map(esc).join(' ')}</p></div>` : '';

  const notes = state.short.length && !ui.team ? `<p class="note">${state.short.map(esc).join(', ')} ${state.short.length > 1 ? 'play' : 'plays'} one fewer pool game. Standings rank by win %, so it stays fair.</p>` : '';
  if (!shown.length) { $('#scheduleList').innerHTML = `<div class="empty"><h3>No games yet</h3><p>Build the schedule from the Setup tab.</p></div>`; return; }
  const groups = [];
  shown.forEach(i => { const g = groups[groups.length - 1]; if (g && g.t === i.t) g.list.push(i); else groups.push({ t: i.t, list: [i] }); });
  let lastPhase = '';
  $('#scheduleList').innerHTML = notes + groups.map(g => {
    const phase = g.list.every(i => i.kind === 'bracket') ? 'Bracket' : 'Pool play';
    const sub = phase !== lastPhase ? phase : ''; lastPhase = phase;
    const fin = g.list.every(i => i.final);
    return `<section><div class="slot-head"><span class="slot-time">${fmt(g.t)}</span><span class="slot-sub">${[sub, fin ? 'All final' : ''].filter(Boolean).join(' · ')}</span></div>
      <div class="slot-games">${g.list.map(i => gameCard(i, nextT, ui.team)).join('')}</div></section>`;
  }).join('');
}

/* ---------- Standings ---------- */
function renderStandings() {
  const rows = rankTeams(), adv = advancingCount(), S = state.settings;
  const fin = state.games.filter(isFinal).length;
  $('#standNote').textContent = fin < state.games.length ? `${fin} of ${state.games.length} pool games final` : 'Pool play complete';
  $('#capLegend').textContent = S.runCap ? `, capped at ${S.runCap} per game` : '';
  $('#standTable').innerHTML = `<thead><tr><th>#</th><th>Team</th><th>GP</th><th>W</th><th>L</th><th>T</th><th>PCT</th><th>RF</th><th>RA</th><th>RD</th></tr></thead><tbody>` +
    rows.map((r, i) => `<tr class="${adv < rows.length && i === adv - 1 ? 'cut' : ''}"><td class="rk">${i + 1}</td><td class="tn">${esc(r.team)}${r.note ? `<span class="tb" title="Separated by ${esc(r.note === 'Draw' ? 'the random draw' : TIE[Object.keys(TIE).find(k => TIE[k][1] === r.note)]?.[0] || r.note)}">${esc(r.note)}</span>` : ''}</td><td>${r.gp}</td><td>${r.w}</td><td>${r.l}</td><td>${r.t}</td><td class="pct">${pctStr(r.pct)}</td><td>${r.rf}</td><td>${r.ra}</td><td class="${r.rd > 0 ? 'pos' : r.rd < 0 ? 'neg' : ''}">${r.rd > 0 ? '+' : ''}${r.rd}</td></tr>`).join('') + `</tbody>`;
  const t = S.ties;
  $('#ties').innerHTML = t.map((k, i) => `<li><span class="n">${i + 1}</span><span class="lbl">${TIE[k][0]}</span>
    <button class="btn btn-sm btn-icon" data-tie="${i}" data-d="-1" ${i === 0 || viewOnly ? 'disabled' : ''} aria-label="Move ${TIE[k][0]} up">↑</button>
    <button class="btn btn-sm btn-icon" data-tie="${i}" data-d="1" ${i === t.length - 1 || viewOnly ? 'disabled' : ''} aria-label="Move ${TIE[k][0]} down">↓</button></li>`).join('') +
    `<li class="fixed"><span class="n">${t.length + 1}</span><span class="lbl">Random draw order</span></li>`;
}

/* ---------- Bracket ---------- */
function bracketMatch(m, extraCls = '') {
  const it = { kind: 'bracket', id: m.key, a: m.a, b: m.b, sa: m.sa, sb: m.sb, final: m.final, tied: m.tied, t: m.time, field: m.field };
  const w = m.winner && m.winner.team;
  const row = (s, label, side) => `<div class="m-row">${s && !s.team ? `<span class="tm tbd"><span class="seed">#${s.seed}</span><span>TBD</span></span>` : s ? `<span class="tm${w === s.team ? ' won' : ''}"><span class="seed">#${s.seed}</span><span>${esc(s.team)}</span></span>` : `<span class="tm tbd">${esc(label || 'TBD')}</span>`}${scoreInput(it, side)}</div>`;
  const tag = m.final && m.tied ? '<span class="tag bad">Tie</span>' : m.final ? '<span class="tag final">Final</span>' : '';
  return `<div class="match ${m.final ? 'is-final' : ''} ${extraCls}">
    <div class="m-meta"><span>G${m.num} · ${fmt(m.time)} · ${esc(fieldName(m.field))}</span>${tag}</div>
    ${editRow(it)}${row(m.a, m.aLabel, 'a')}${row(m.b, m.bLabel, 'b')}</div>`;
}
function trophy() { return `<svg width="34" height="34" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 14.9V17h3v2H8v-2h3v-2.1A5 5 0 0 1 8.3 12H8a4 4 0 0 1-4-4V5h3V3Zm0 4H6v1a2 2 0 0 0 1 1.7V7Zm10 0v2.7A2 2 0 0 0 18 8V7h-1Z"/></svg>`; }
function renderBracket() {
  const area = $('#bracketArea'), br = state.bracket, S = state.settings;
  const fin = state.games.filter(isFinal).length, total = state.games.length;
  if (!br) {
    const seeds = projectedSeeds(), r = Object.fromEntries(rankTeams().map(x => [x.team, x]));
    area.innerHTML = `<div class="card">
      <div class="card-head"><h2 class="h-card">${fin < total ? 'Projected seeds' : 'Seeds are set'}</h2><span class="pill">${S.bracketFormat === 'double' ? 'Double' : 'Single'} elimination</span></div>
      <p class="note" style="margin:0 0 14px">${fin < total ? `${total - fin} pool game${total - fin > 1 ? 's' : ''} still need a score. You can build the bracket now: it shows #1 TBD, #2 TBD and so on, and fills in the teams when pool play is final.` : `Pool play is done. ${seeds.length} teams advance, seeded by the standings.`}${nextPow2(seeds.length) !== seeds.length && S.bracketFormat === 'single' ? ` Top seeds get ${nextPow2(seeds.length) - seeds.length} first-round bye${nextPow2(seeds.length) - seeds.length > 1 ? 's' : ''}.` : ''}</p>
      <ol class="seed-list">${seeds.map((t, i) => `<li><b>${i + 1}</b><span>${esc(t)}</span><span class="rec">${r[t].w}-${r[t].l}${r[t].t ? '-' + r[t].t : ''}</span></li>`).join('')}</ol>
      <div class="actions" style="margin-top:16px"><button class="btn btn-primary" id="buildBracketBtn" ${viewOnly || seeds.length < 2 ? 'disabled' : ''}>Build the bracket</button>
      <span class="note" style="margin:0;align-self:center">Bracket games start at ${fmt(bracketStart())} and keep rotating through your fields.</span></div></div>`;
    return;
  }
  const B = resolveBracket();
  let html = '';
  if (seedsChanged() && !viewOnly) html += `<div class="banner warn"><p>Pool results changed after the bracket was built, so the seeds no longer match the standings.</p><div class="actions"><button class="btn btn-sm" id="reseedBtn">Rebuild with new seeds</button></div></div>`;
  html += `<div class="card"><div class="card-head"><h2 class="h-card">Championship bracket</h2><div class="actions"><span class="pill">${B.format === 'double' ? 'Double' : 'Single'} elimination · ${br.count} teams</span>${viewOnly ? '' : `<label class="switch"><input type="checkbox" id="editToggle2" ${ui.edit ? 'checked' : ''}><span>Edit times</span></label><button class="btn btn-sm" id="rebuildBtn">Rebuild</button>`}</div></div>
    <p class="note" style="margin:0 0 6px">${poolDone() || br.seeds ? 'Enter the final score in each game. The winner moves on automatically.' : `Seeds show as TBD until pool play is final (${state.games.filter(g => !isFinal(g)).length} pool game${state.games.filter(g => !isFinal(g)).length === 1 ? '' : 's'} left). Teams fill in by themselves.`}${B.format === 'double' ? ' A team is out after its second loss.' : ''}</p>`;
  if (B.champion) html += `<div class="champ" style="margin:12px 0">${profileOf().cause ? RIBBON : trophy()}<p class="eyebrow">${esc(state.name || 'Tournament')} champion</p><strong>${esc(B.champion.team)}</strong><span class="note" style="margin:0">#${B.champion.seed} seed</span></div>`;

  if (B.format === 'single') {
    html += `<div class="bracket-scroll"><div class="bk">` + B.rounds.map((round) => `<div class="bk-col"><h3>${esc(round[0].label)}</h3><div class="bk-slots">${round.map(m => `<div class="bk-slot">${m.bye ? `<div class="match is-bye"><div class="m-meta"><span>Bye</span></div><div class="m-row"><span class="tm"><span class="seed">#${m.winner.seed}</span><span>${esc(m.winner.team || 'TBD')}</span></span></div></div>` : bracketMatch(m)}</div>`).join('')}</div></div>`).join('') + `</div></div>`;
  } else {
    const L = B.losses;
    if (B.seeds.every(known)) html += `<div class="status-strip" style="margin:12px 0">${B.seeds.map(sd => sd.team).map((t, i) => { const l = L[t] || 0; return `<span class="st ${l >= 2 ? 'out' : 'l' + l}"><span>#${i + 1} ${esc(t)}</span><i>${l >= 2 ? 'Out' : l === 1 ? '1 loss' : 'Unbeaten'}</i></span>`; }).join('')}</div>`;
    html += `<div class="bracket-scroll"><div class="de-cols">` + B.rounds.map((rd, ri) => {
      const groups = { w: [], e: [], c: [] }; rd.games.forEach(g => groups[g.group].push(g));
      const name = { w: 'Winners side', e: 'Elimination side', c: 'Championship' };
      const body = ['c', 'w', 'e'].filter(k => groups[k].length).map(k => `<p class="de-group ${k}">${name[k]}</p>${groups[k].map(g => bracketMatch(g)).join('')}`).join('');
      const byes = rd.byes.length ? `<div class="byes">Bye this round: ${rd.byes.map(b => esc(sideName(b))).join(', ')}</div>` : '';
      return `<div class="de-col"><h3>Round ${ri + 1}</h3>${body}${byes}</div>`;
    }).join('') + (!B.champion ? `<div class="de-col"><h3>Round ${B.rounds.length + 1}</h3><div class="waiting">Pairings appear when every game in round ${B.rounds.length} is final. Next start: about ${fmt(B.rounds[B.rounds.length - 1].nextTime)}.</div></div>` : '') + `</div></div>`;
  }
  html += `</div>`;
  area.innerHTML = html;
}

/* ============================ Printout ============================ */
function renderPrint(sel = ui.printSel || 'both') {
  const pv = $('#printView'); if (!pv) return;
  const P = profileOf(), all = allItems(), B = all.B;
  const items = sel === 'pool' ? all.items.filter(i => i.kind === 'pool') : all.items;
  const meta = [state.date ? fmtDate(state.date) : '', state.location || '', `${state.order.length} teams · ${state.settings.fields.length} field${state.settings.fields.length > 1 ? 's' : ''}`].filter(Boolean).join(' · ');
  let h = `<header class="pv-head">${P.logo ? `<img src="${esc(P.logo)}" alt="">` : ''}<div>
    ${P.presenter ? `<p class="pv-eyebrow">${esc(P.presenter)}</p>` : ''}
    <h1 class="pv-name">${esc(state.name || 'Tournament')}</h1>
    <p class="pv-meta">${esc(meta)}</p>
    ${P.cause ? `<p class="pv-cause">${RIBBON}${esc(P.cause)}</p>` : ''}</div></header>`;
  if (B && B.champion && sel !== 'pool') h += `<div class="pv-champ">Champion: ${esc(B.champion.team)}</div>`;

  // Schedule: one row per game, blank boxes to write scores in
  const name = (side, label) => side && !side.team ? `<span class="pv-team tbd">#${side.seed} TBD</span>` : side ? `<span class="pv-team">${side.seed ? `<span class="pv-small">#${side.seed}</span> ` : ''}${esc(side.team)}</span>` : `<span class="pv-team tbd">${esc(label || 'TBD')}</span>`;
  const box = v => `<span class="pv-box">${v !== '' && v != null ? esc(v) : ''}</span>`;
  let lastT = null;
  if (sel !== 'bracket') h += `<section class="pv-section"><h2 class="pv-h">${sel === 'pool' ? 'Pool schedule' : 'Schedule'}</h2><table class="pv-table"><thead><tr><th>Time</th><th>Field</th><th>Game</th><th>Team</th><th>R</th><th></th><th>Team</th><th>R</th></tr></thead><tbody>` +
    items.map(i => {
      const first = i.t !== lastT; lastT = i.t;
      return `<tr class="${first ? 'pv-slot' : ''}"><td class="pv-time">${first ? fmt(i.t) : ''}</td><td class="pv-small">${esc(fieldName(i.field))}</td>
        <td class="pv-small">G${i.num}${i.kind === 'bracket' ? `<br>${esc(i.label)}` : ''}</td>
        <td>${name(i.a, i.aLabel)}</td><td>${box(i.sa)}</td><td class="pv-vs">vs</td><td>${name(i.b, i.bLabel)}</td><td>${box(i.sb)}</td></tr>`;
    }).join('') + `</tbody></table></section>`;

  // Standings
  const rows = rankTeams();
  if (sel !== 'bracket' && state.games.some(isFinal)) {
    h += `<section class="pv-section pv-keep"><h2 class="pv-h">Pool standings</h2><table class="pv-table pv-num"><thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>T</th><th>PCT</th><th>RF</th><th>RA</th><th>RD</th></tr></thead><tbody>` +
      rows.map((r, i) => `<tr><td>${i + 1}</td><td class="pv-team">${esc(r.team)}</td><td>${r.w}</td><td>${r.l}</td><td>${r.t}</td><td>${pctStr(r.pct)}</td><td>${r.rf}</td><td>${r.ra}</td><td>${r.rd > 0 ? '+' : ''}${r.rd}</td></tr>`).join('') + `</tbody></table></section>`;
  }

  // Bracket
  if (B && sel !== 'pool') {
    const match = m => `<div class="pv-match"><div class="pv-mmeta">G${m.num} · ${fmt(m.time)} · ${esc(fieldName(m.field))}</div>
      <div class="pv-mrow">${name(m.a, m.aLabel)}${box(m.sa)}</div><div class="pv-mrow">${name(m.b, m.bLabel)}${box(m.sb)}</div></div>`;
    const rounds = B.format === 'single'
      ? B.rounds.map(r => ({ title: r[0].label, games: r.filter(m => !m.bye), byes: r.filter(m => m.bye).map(m => sideName(m.winner)) }))
      : B.rounds.map((r, i) => ({ title: `Round ${i + 1}`, games: r.games, byes: r.byes.map(sideName) }));
    h += `<section class="pv-section pv-keep"><h2 class="pv-h">${B.format === 'double' ? 'Double' : 'Single'} elimination bracket</h2><div class="pv-bracket">` +
      rounds.map(r => `<div class="pv-round"><h4>${esc(r.title)}</h4>${r.games.map(match).join('')}${r.byes.length ? `<p class="pv-small">Bye: ${r.byes.map(esc).join(', ')}</p>` : ''}</div>`).join('') + `</div></section>`;
  }
  h += `<footer class="pv-foot"><span class="pv-thanks">${esc(P.thanks || '')}</span><span></span></footer>`;
  // Spacer rows repeat on every printed page, giving top and bottom margins while the page itself has none
  pv.innerHTML = `<table class="pv-frame"><thead><tr><td class="pv-gap"></td></tr></thead><tfoot><tr><td class="pv-gap"></td></tr></tfoot><tbody><tr><td>${h}</td></tr></tbody></table>`;
}

/* ============================ PDF & image export ============================ */
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
const RIBBON_PATH = 'M12 1.5c-3.3 0-5.6 2.4-5.6 5.6 0 2.2 1.1 4.6 2.9 7.5L2.6 26.2l3.6 2.6 5.8-9.6 5.8 9.6 3.6-2.6-6.7-11.6c1.8-2.9 2.9-5.3 2.9-7.5 0-3.2-2.3-5.6-5.6-5.6Zm0 3.4c1.3 0 2.2 1 2.2 2.3 0 1.3-.8 3-2.2 5.3-1.4-2.3-2.2-4-2.2-5.3 0-1.3.9-2.3 2.2-2.3Z';
async function buildExport(sel, mode) {
  const W = 816, H = 1056, M = 40, CW = W - 2 * M, FOOT = 26, PAGE_H = H - 2 * M - FOOT;
  const P = profileOf(), accent = P.cause ? '#d81b7a' : '#0a2342';
  const FD = '"Big Shoulders Display", Impact, "Arial Narrow", sans-serif', FB = 'Barlow, "Segoe UI", Roboto, Arial, sans-serif', FL = '"Barlow Condensed", "Arial Narrow", Arial, sans-serif';
  try { await Promise.all([`900 30px ${FD}`, `800 16px ${FD}`, `600 12px ${FB}`, `700 12px ${FB}`, `600 11px ${FL}`, `700 11px ${FL}`].map(f => document.fonts.load(f))); } catch (e) { /* use fallbacks */ }
  const logo = P.logo ? await loadImg(P.logo).catch(() => null) : null;
  const mctx = document.createElement('canvas').getContext('2d');
  const setF = (c, f, ls = 0) => { c.font = f; if ('letterSpacing' in c) c.letterSpacing = ls + 'px'; };
  const fit = (c, t, w) => { t = String(t); if (c.measureText(t).width <= w) return t; while (t.length > 1 && c.measureText(t + '…').width > w) t = t.slice(0, -1); return t + '…'; };
  const wrap = (c, t, w) => { const out = []; let line = ''; String(t).split(' ').forEach(word => { const test = line ? line + ' ' + word : word; if (c.measureText(test).width > w && line) { out.push(line); line = word; } else line = test; }); if (line) out.push(line); return out; };
  const ribbon = (c, x, y, h, color) => { c.save(); c.translate(x, y); c.scale(h / 32, h / 32); c.fillStyle = color; c.fill(new Path2D(RIBBON_PATH)); c.restore(); };
  const rr = (c, x, y, w, h, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
  const box = (c, x, y, v) => { rr(c, x, y, 34, 22, 3); c.strokeStyle = '#777'; c.lineWidth = 1; c.stroke(); if (v !== '' && v != null) { setF(c, `800 16px ${FD}`); c.fillStyle = '#111'; c.textAlign = 'center'; c.fillText(String(v), x + 17, y + 17); c.textAlign = 'left'; } };
  const blocks = [];
  const { items: allIt, B } = allItems();

  // Header
  {
    const tx = logo ? 92 : 0, tw = CW - tx;
    setF(mctx, `900 30px ${FD}`); const nameLines = wrap(mctx, (state.name || 'Tournament').toUpperCase(), tw);
    const meta = [state.date ? fmtDate(state.date) : '', state.location || '', `${state.order.length} teams · ${state.settings.fields.length} field${state.settings.fields.length > 1 ? 's' : ''}`].filter(Boolean).join(' · ').toUpperCase();
    setF(mctx, `600 11.5px ${FL}`, 0.6); const metaLines = wrap(mctx, meta, tw);
    const textH = (P.presenter ? 16 : 0) + nameLines.length * 30 + 6 + metaLines.length * 15 + (P.cause ? 18 : 0);
    const h = Math.max(logo ? 80 : 0, textH) + 16;
    blocks.push({ h, draw(c, x, y) {
      if (logo) { const s = 80 / Math.max(logo.width, logo.height); c.drawImage(logo, x, y + (h - 16 - logo.height * s) / 2, logo.width * s, logo.height * s); }
      let ty = y;
      if (P.presenter) { setF(c, `700 11px ${FL}`, 1.6); c.fillStyle = accent; c.fillText(P.presenter.toUpperCase(), x + tx, ty + 11); ty += 16; }
      setF(c, `900 30px ${FD}`); c.fillStyle = '#111'; nameLines.forEach(l => { ty += 30; c.fillText(l, x + tx, ty - 3); }); ty += 6;
      setF(c, `600 11.5px ${FL}`, 0.6); c.fillStyle = '#444'; metaLines.forEach(l => { ty += 15; c.fillText(l, x + tx, ty - 3); });
      if (P.cause) { ribbon(c, x + tx, ty + 3, 13, accent); setF(c, `700 11.5px ${FL}`, 0.6); c.fillStyle = accent; c.fillText(P.cause.toUpperCase(), x + tx + 13, ty + 14); }
      c.fillStyle = accent; c.fillRect(x, y + h - 6, CW, 3);
    } });
  }
  if (B && B.champion && sel !== 'pool') blocks.push({ h: 48, draw(c, x, y) { rr(c, x, y + 6, CW, 34, 6); c.strokeStyle = accent; c.lineWidth = 2; c.stroke(); setF(c, `800 17px ${FD}`); c.fillStyle = '#111'; c.fillText(fit(c, `CHAMPION: ${B.champion.team.toUpperCase()}`, CW - 24), x + 12, y + 29); } });
  const title = t => blocks.push({ h: 34, keepNext: true, draw(c, x, y) { setF(c, `800 18px ${FD}`); c.fillStyle = '#111'; c.fillText(t.toUpperCase(), x, y + 26); } });

  // Schedule table
  if (sel !== 'bracket') {
    const items = sel === 'pool' ? allIt.filter(i => i.kind === 'pool') : allIt;
    const cols = { time: 0, field: 78, game: 150, ta: 238 }; const teamW = (CW - 238 - 34 - 26 - 34 - 12) / 2;
    cols.ba = cols.ta + teamW; cols.vs = cols.ba + 40; cols.tb = cols.vs + 22; cols.bb = cols.tb + teamW;
    const head = { h: 22, head: true, draw(c, x, y) { setF(c, `700 9.5px ${FL}`, 1.4); c.fillStyle = '#555'; [['TIME', 'time'], ['FIELD', 'field'], ['GAME', 'game'], ['TEAM', 'ta'], ['R', 'ba'], ['TEAM', 'tb'], ['R', 'bb']].forEach(([t, k]) => c.fillText(t, x + cols[k], y + 14)); c.fillStyle = '#111'; c.fillRect(x, y + 20, CW, 1.5); } };
    title(sel === 'pool' ? 'Pool schedule' : 'Schedule'); blocks.push(head);
    let lastT = null;
    items.forEach(i => {
      const first = i.t !== lastT; lastT = i.t;
      blocks.push({ h: 34, row: true, tableHead: head, draw(c, x, y) {
        c.fillStyle = first ? '#888' : '#ccc'; c.fillRect(x, y, CW, first ? 1.5 : 0.75);
        if (first) { setF(c, `800 14px ${FD}`); c.fillStyle = '#111'; c.fillText(fmt(i.t), x + cols.time, y + 22); }
        setF(c, `600 10px ${FL}`, 0.6); c.fillStyle = '#555';
        c.fillText(fit(c, fieldName(i.field).toUpperCase(), 68), x + cols.field, y + 21);
        if (i.kind === 'bracket') { c.fillText(`G${i.num}`, x + cols.game, y + 15); c.fillText(fit(c, i.label.toUpperCase(), 84), x + cols.game, y + 27); } else c.fillText(`G${i.num}`, x + cols.game, y + 21);
        const team = (side, label, tx) => {
          if (side && !side.team) { setF(c, `italic 500 12px ${FB}`); c.fillStyle = '#666'; c.fillText(`#${side.seed} TBD`, x + tx, y + 21); }
          else if (side) { let ox = 0; if (side.seed) { setF(c, `600 10px ${FL}`); c.fillStyle = '#555'; c.fillText(`#${side.seed}`, x + tx, y + 21); ox = 20; } setF(c, `${winnerOf(i) === side.team ? 800 : 600} 13px ${FB}`); c.fillStyle = '#111'; c.fillText(fit(c, side.team, teamW - 46 - ox), x + tx + ox, y + 21); }
          else { setF(c, `italic 500 12px ${FB}`); c.fillStyle = '#666'; c.fillText(fit(c, label || 'TBD', teamW - 46), x + tx, y + 21); }
        };
        team(i.a, i.aLabel, cols.ta); box(c, x + cols.ba, y + 6, i.sa);
        setF(c, `500 9px ${FB}`); c.fillStyle = '#888'; c.fillText('vs', x + cols.vs, y + 21);
        team(i.b, i.bLabel, cols.tb); box(c, x + cols.bb, y + 6, i.sb);
      } });
    });
  }
  // Standings
  if (sel !== 'bracket' && state.games.some(isFinal)) {
    const rows = rankTeams(); const nums = [['W', 'w'], ['L', 'l'], ['T', 't'], ['PCT', 'pct'], ['RF', 'rf'], ['RA', 'ra'], ['RD', 'rd']];
    const colX = k => CW - (nums.length - k) * 58 + 50;
    const head = { h: 22, head: true, draw(c, x, y) { setF(c, `700 9.5px ${FL}`, 1.4); c.fillStyle = '#555'; c.fillText('#', x, y + 14); c.fillText('TEAM', x + 30, y + 14); c.textAlign = 'right'; nums.forEach(([t], k) => c.fillText(t, x + colX(k), y + 14)); c.textAlign = 'left'; c.fillStyle = '#111'; c.fillRect(x, y + 20, CW, 1.5); } };
    const tb = { h: 34, keepNext: true, draw(c, x, y) { setF(c, `800 18px ${FD}`); c.fillStyle = '#111'; c.fillText('POOL STANDINGS', x, y + 26); } };
    blocks.push({ ...tb, keepNext: true, keepAll: rows.length }); blocks.push(head);
    rows.forEach((r, i) => blocks.push({ h: 26, row: true, tableHead: head, draw(c, x, y) {
      setF(c, `600 12.5px ${FB}`); c.fillStyle = '#111'; c.fillText(String(i + 1), x, y + 17); setF(c, `700 12.5px ${FB}`); c.fillText(fit(c, r.team, CW - 30 - nums.length * 58), x + 30, y + 17);
      setF(c, `600 12.5px ${FB}`); c.textAlign = 'right';
      nums.forEach(([, k], j) => c.fillText(k === 'pct' ? pctStr(r.pct) : k === 'rd' ? (r.rd > 0 ? '+' : '') + r.rd : String(r[k]), x + colX(j), y + 17));
      c.textAlign = 'left'; c.fillStyle = '#ddd'; c.fillRect(x, y + 25, CW, 0.75);
    } }));
  }
  // Bracket
  if (B && sel !== 'pool') {
    title(`${B.format === 'double' ? 'Double' : 'Single'} elimination bracket`);
    const MW = 186, MH = 62, GAP = 12, CG = 30;
    const drawMatch = (c, m, x, y) => {
      rr(c, x, y, MW, MH, 4); c.fillStyle = '#fff'; c.fill(); c.strokeStyle = '#999'; c.lineWidth = 1; c.stroke();
      setF(c, `600 9px ${FL}`, 0.5); c.fillStyle = '#555'; c.fillText(fit(c, `G${m.num} · ${fmt(m.time)} · ${fieldName(m.field)}`.toUpperCase(), MW - 12), x + 6, y + 12);
      c.fillStyle = '#ddd'; c.fillRect(x, y + 17, MW, 0.75); c.fillRect(x + 4, y + 39, MW - 8, 0.75);
      [[m.a, m.aLabel, m.sa, 0], [m.b, m.bLabel, m.sb, 1]].forEach(([sd, lb, sc, k]) => {
        const ry = y + 18 + k * 22;
        if (sd && !sd.team) { setF(c, `600 9.5px ${FL}`); c.fillStyle = '#555'; c.fillText(`#${sd.seed}`, x + 6, ry + 15); setF(c, `italic 500 11px ${FB}`); c.fillStyle = '#666'; c.fillText('TBD', x + 26, ry + 15); }
        else if (sd) { setF(c, `600 9.5px ${FL}`); c.fillStyle = '#555'; c.fillText(`#${sd.seed}`, x + 6, ry + 15); setF(c, `${m.winner && m.winner.team === sd.team ? 800 : 600} 12px ${FB}`); c.fillStyle = '#111'; c.fillText(fit(c, sd.team, MW - 70), x + 26, ry + 15); }
        else { setF(c, `italic 500 11px ${FB}`); c.fillStyle = '#666'; c.fillText(fit(c, lb || 'TBD', MW - 50), x + 6, ry + 15); }
        rr(c, x + MW - 36, ry + 2, 30, 18, 3); c.strokeStyle = '#888'; c.stroke();
        if (sc !== '' && sc != null) { setF(c, `800 13px ${FD}`); c.fillStyle = '#111'; c.textAlign = 'center'; c.fillText(String(sc), x + MW - 21, ry + 16); c.textAlign = 'left'; }
      });
    };
    let bw, bh, drawB;
    if (B.format === 'single') {
      const R = B.rounds.length, slot = MH + GAP, n0 = B.rounds[0].length;
      bw = R * MW + (R - 1) * CG; bh = 22 + n0 * slot;
      const cy = (r, i) => 22 + (i + 0.5) * slot * 2 ** r;
      drawB = (c, x, y) => {
        B.rounds.forEach((round, r) => {
          const cx = x + r * (MW + CG);
          setF(c, `700 10px ${FL}`, 1.4); c.fillStyle = '#555'; c.textAlign = 'center'; c.fillText(round[0].label.toUpperCase(), cx + MW / 2, y + 12); c.textAlign = 'left';
          round.forEach((m, i) => {
            const my = y + cy(r, i) - MH / 2;
            if (m.bye) { setF(c, `italic 500 11px ${FB}`); c.fillStyle = '#777'; c.fillText(fit(c, `Bye: #${m.winner.seed} ${m.winner.team || 'TBD'}`, MW), cx + 6, y + cy(r, i) + 4); }
            else drawMatch(c, m, cx, my);
            if (r < R - 1) {
              const ny = y + cy(r + 1, Math.floor(i / 2)); c.strokeStyle = '#999'; c.lineWidth = 1.2; c.beginPath();
              c.moveTo(cx + MW, y + cy(r, i)); c.lineTo(cx + MW + CG / 2, y + cy(r, i)); c.lineTo(cx + MW + CG / 2, ny); c.lineTo(cx + MW + CG, ny); c.stroke();
            }
          });
        });
      };
    } else {
      const cols = B.rounds.map((rd, i) => ({ title: `Round ${i + 1}`, games: rd.games, byes: rd.byes.map(sideName) }));
      const colH = col => 22 + col.games.length * (MH + GAP + 14) + (col.byes.length ? 18 : 0);
      bw = cols.length * MW + (cols.length - 1) * 16; bh = Math.max(...cols.map(colH));
      const gname = { w: 'WINNERS SIDE', e: 'ELIMINATION SIDE', c: 'CHAMPIONSHIP' };
      drawB = (c, x, y) => cols.forEach((col, k) => {
        const cx = x + k * (MW + 16); let yy = y;
        setF(c, `700 10px ${FL}`, 1.4); c.fillStyle = '#555'; c.fillText(col.title.toUpperCase(), cx, yy + 12); yy += 22;
        col.games.forEach(g => { setF(c, `700 9px ${FL}`, 1.2); c.fillStyle = g.group === 'e' ? '#9a5b00' : g.group === 'c' ? accent : '#16804c'; c.fillText(gname[g.group], cx, yy + 10); yy += 14; drawMatch(c, g, cx, yy); yy += MH + GAP; });
        if (col.byes.length) { setF(c, `italic 500 10.5px ${FB}`); c.fillStyle = '#666'; c.fillText(fit(c, 'Bye: ' + col.byes.join(', '), MW), cx, yy + 12); }
      });
    }
    const maxH = mode === 'pdf' ? PAGE_H - 34 : Infinity;
    const sc = Math.min(1, CW / bw, maxH / bh);
    blocks.push({ h: bh * sc + 8, draw(c, x, y) { c.save(); c.translate(x + (CW - bw * sc) / 2, y); c.scale(sc, sc); drawB(c, 0, 0); c.restore(); } });
  }

  const footer = (c, y, page, pages) => {
    c.fillStyle = '#bbb'; c.fillRect(M, y, CW, 1);
    setF(c, `600 9.5px ${FL}`, 1); c.fillStyle = accent; if (P.thanks) c.fillText(fit(c, P.thanks.toUpperCase(), CW - 120), M, y + 16);
    c.fillStyle = '#555'; c.textAlign = 'right'; if (pages > 1) c.fillText(`PAGE ${page} OF ${pages}`, M + CW, y + 16); c.textAlign = 'left';
  };
  const paint = (w, h, scale, list, footY, page, pages) => {
    const cv = document.createElement('canvas'); cv.width = Math.round(w * scale); cv.height = Math.round(h * scale);
    const c = cv.getContext('2d'); c.scale(scale, scale); c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); c.textBaseline = 'alphabetic';
    list.forEach(({ b, y }) => b.draw(c, M, M + y)); footer(c, footY, page, pages); return cv;
  };

  if (mode === 'image') {
    const total = blocks.reduce((a, b) => a + b.h, 0) + 2 * M + FOOT;
    const scale = Math.min(2, Math.sqrt(16e6 / (W * total)));
    let y = 0; const list = blocks.map(b => { const o = { b, y }; y += b.h; return o; });
    return [paint(W, total, scale, list, total - M - FOOT + 6, 1, 1)];
  }
  // paginate for PDF: rows never split; titles stay with what follows; table headers repeat
  const pages = [[]]; let y = 0;
  blocks.forEach((b, i) => {
    let need = b.h; if (b.keepNext && blocks[i + 1]) need += blocks[i + 1].h + (blocks[i + 2] && blocks[i + 1].head ? blocks[i + 2].h : 0);
    if (b.keepAll) need = b.h + 22 + b.keepAll * 26;
    if (y > 0 && y + Math.min(need, PAGE_H) > PAGE_H) { pages.push([]); y = 0; if (b.row && b.tableHead) { pages[pages.length - 1].push({ b: b.tableHead, y }); y += b.tableHead.h; } }
    pages[pages.length - 1].push({ b, y }); y += b.h;
  });
  return pages.map((list, k) => paint(W, H, 2, list, H - M - FOOT + 6, k + 1, pages.length));
}
async function canvasesToPdf(canvases) {
  const enc = new TextEncoder(), parts = [], offs = []; let len = 0;
  const push = d => { const b = typeof d === 'string' ? enc.encode(d) : d; parts.push(b); len += b.length; };
  const imgs = await Promise.all(canvases.map(cv => new Promise(res => cv.toBlob(async b => res({ bytes: new Uint8Array(await b.arrayBuffer()), w: cv.width, h: cv.height }), 'image/jpeg', 0.92))));
  const N = imgs.length, objCount = 2 + N * 3;
  push('%PDF-1.4\n%âãÏÓ\n');
  const obj = (n, f) => { offs[n] = len; push(`${n} 0 obj\n`); f(); push('\nendobj\n'); };
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Kids [${imgs.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] /Count ${N} >>`));
  imgs.forEach((im, i) => {
    const pg = 3 + i * 3, ct = pg + 1, ix = pg + 2, cmd = `q 612 0 0 792 0 0 cm /Im${i} Do Q`;
    obj(pg, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im${i} ${ix} 0 R >> >> /Contents ${ct} 0 R >>`));
    obj(ct, () => push(`<< /Length ${cmd.length} >>\nstream\n${cmd}\nendstream`));
    obj(ix, () => { push(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`); push(im.bytes); push('\nendstream'); });
  });
  const xref = len;
  push(`xref\n0 ${objCount + 1}\n0000000000 65535 f \n` + Array.from({ length: objCount }, (_, k) => String(offs[k + 1]).padStart(10, '0') + ' 00000 n \n').join(''));
  push(`trailer\n<< /Size ${objCount + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}
let exportFile = null, exportUrl = '';
function openExport() {
  const B = resolveBracket();
  $('#exSelBracket').disabled = !B;
  const both = $('input[name="exSel"][value="both"]');
  const cur = $(`input[name="exSel"][value="${ui.printSel}"]`);
  if (cur && !cur.disabled) cur.checked = true; else $('input[name="exSel"][value="pool"]').checked = true;
  both.disabled = false;
  $('#exNote').textContent = B ? '' : 'The bracket is not built yet, so only the pool schedule is available.';
  $('#exResult').hidden = true;
  $('#exportSheet').hidden = false;
  $('#exPrint').focus();
}
function exportSel() { const r = $('input[name="exSel"]:checked'); return r ? r.value : 'both'; }
async function runExport(mode) {
  const sel = exportSel(); ui.printSel = sel;
  const res = $('#exResult'), st = $('#exStatus'), saveB = $('#exSave'), open = $('#exOpen');
  res.hidden = false; st.textContent = mode === 'pdf' ? 'Creating PDF…' : 'Creating image…'; saveB.disabled = true; open.hidden = true; $('#exPreview').removeAttribute('src');
  try {
    const canvases = await buildExport(sel, mode);
    const base = `${(state.name || 'tournament').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase()}-${sel === 'both' ? 'schedule-and-bracket' : sel === 'pool' ? 'pool-schedule' : 'bracket'}`;
    let blob;
    if (mode === 'pdf') blob = await canvasesToPdf(canvases);
    else blob = await new Promise(r => canvases[0].toBlob(r, 'image/png'));
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    exportUrl = URL.createObjectURL(blob);
    exportFile = new File([blob], `${base}.${mode === 'pdf' ? 'pdf' : 'png'}`, { type: blob.type });
    $('#exPreview').src = canvases[0].toDataURL('image/jpeg', 0.6);
    st.textContent = mode === 'pdf' ? `PDF ready · ${canvases.length} page${canvases.length > 1 ? 's' : ''}` : 'Image ready';
    saveB.textContent = mode === 'pdf' ? 'Save PDF' : 'Save image';
    saveB.disabled = false; open.href = exportUrl; open.hidden = false; open.setAttribute('download', exportFile.name);
    saveB.focus();
  } catch (e) { st.textContent = 'Could not create the file on this device. Try Print instead.'; }
}
function saveExport() {
  if (!exportFile) return;
  // Called straight from the tap so iPhone allows the share sheet (Save Image / Save to Files).
  if (navigator.canShare && navigator.canShare({ files: [exportFile] })) {
    navigator.share({ files: [exportFile], title: state.name || 'Tournament' }).catch(er => { if (er && er.name !== 'AbortError') $('#exOpen').click(); });
  } else {
    const a = document.createElement('a'); a.href = exportUrl; a.download = exportFile.name; document.body.appendChild(a); a.click(); a.remove();
  }
}

/* ============================ Overlays ============================ */
function ask(title, body, ok = 'Continue', danger = false) {
  return new Promise(res => {
    const m = $('#modal'), okB = $('#modalOk'), cB = $('#modalCancel');
    $('#modalTitle').textContent = title; $('#modalBody').textContent = body;
    okB.textContent = ok; okB.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
    const prev = document.activeElement;
    m.hidden = false; okB.focus();
    const done = v => { m.hidden = true; okB.onclick = cB.onclick = m.onclick = null; document.removeEventListener('keydown', key); if (prev && prev.focus) prev.focus(); res(v); };
    const key = e => { if (e.key === 'Escape') done(false); };
    okB.onclick = () => done(true); cB.onclick = () => done(false);
    m.onclick = e => { if (e.target === m) done(false); };
    document.addEventListener('keydown', key);
  });
}
let toastT = null;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600); }

function animateDraw(order) {
  return new Promise(res => {
    const ov = $('#drawOverlay'), now = $('#drawNow'), list = $('#drawLive'), done = $('#drawDone'), skip = $('#drawSkip');
    ov.hidden = false; list.innerHTML = ''; done.hidden = true; skip.hidden = false;
    let i = 0, timer = null, spin = null;
    const finish = () => {
      clearTimeout(timer); clearInterval(spin);
      list.innerHTML = order.map(t => `<li>${esc(t)}</li>`).join('');
      now.textContent = 'Pool A is set'; skip.hidden = true; done.hidden = false; done.focus();
    };
    const reveal = () => {
      if (i >= order.length) { finish(); return; }
      let k = 0; const pool = order.slice(i);
      clearInterval(spin);
      spin = setInterval(() => { now.textContent = pool[k++ % pool.length]; }, 55);
      timer = setTimeout(() => {
        clearInterval(spin);
        const t = order[i++];
        now.textContent = t; $('.draw-now').classList.remove('pop'); void now.offsetWidth; $('.draw-now').classList.add('pop');
        list.insertAdjacentHTML('beforeend', `<li>${esc(t)}</li>`);
        timer = setTimeout(reveal, 380);
      }, 420);
    };
    skip.onclick = finish;
    done.onclick = () => { ov.hidden = true; res(); };
    if (REDUCED) finish(); else reveal();
  });
}

/* ============================ Live sync ============================ */
const sync = { timer: null, inflight: false, status: 'ok', lastBody: '' };
function livePayload() { const { live, tab, ...pub } = state; return JSON.stringify({ ...pub, tab: 'schedule', demo: false }); }
function queueSync() {
  if (!state.live || viewOnly) return;
  clearTimeout(sync.timer);
  sync.timer = setTimeout(pushLive, 1000);
}
async function pushLive() {
  if (!state.live || viewOnly) return;
  if (sync.inflight) { clearTimeout(sync.timer); sync.timer = setTimeout(pushLive, 700); return; }
  const body = livePayload();
  if (body === sync.lastBody && sync.status === 'ok') return;
  sync.inflight = true; setSync('pending');
  try {
    const r = await fetch(`${LIVE_API}/t/${state.live.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Edit-Key': state.live.key }, body });
    if (r.status === 403 || r.status === 404) { state.live = null; persist(); toast('The live link was turned off.'); setSync('ok'); return; }
    if (!r.ok) throw new Error('http ' + r.status);
    sync.lastBody = body; setSync('ok');
  } catch (e) {
    setSync('error');
    clearTimeout(sync.timer); sync.timer = setTimeout(pushLive, 15000);
  } finally { sync.inflight = false; }
}
function setSync(st) { sync.status = st; renderLiveChip(); if (!$('#shareSheet').hidden) renderShare(); }
function renderLiveChip() {
  const c = $('#liveChip'); if (!c) return;
  c.hidden = !state.live || viewOnly;
  c.className = 'live-chip ' + (sync.status === 'ok' ? '' : sync.status);
  c.querySelector('span').textContent = sync.status === 'error' ? 'Offline' : sync.status === 'pending' ? 'Syncing' : 'Live';
  c.title = sync.status === 'error' ? 'Scores will send when you are back online' : 'Anyone with your live link can follow along';
}
async function goLive() {
  const btn = $('#goLive'); btn.disabled = true; btn.textContent = 'Turning on…'; $('#shareErr').textContent = '';
  try {
    const body = livePayload();
    const r = await fetch(`${LIVE_API}/t`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    if (!r.ok) throw new Error('http ' + r.status);
    const j = await r.json();
    state.live = { id: j.id, key: j.key }; sync.lastBody = body; sync.status = 'ok';
    persist(); render(); renderShare();
    (navigator.share ? $('#shareNative') : $('#shareCopy')).focus();
  } catch (e) {
    $('#shareErr').textContent = navigator.onLine === false ? 'You are offline. Connect to the internet to turn on the live link.' : 'The live service did not answer. Try again in a minute.';
  } finally { btn.disabled = false; btn.textContent = 'Turn on live link'; }
}
/* Following someone's live link */
async function pollLive(first) {
  if (!liveView) return;
  try {
    const r = await fetch(`${LIVE_API}/t/${liveView.id}${liveView.updated ? '?since=' + liveView.updated : ''}`, { cache: 'no-store' });
    if (r.status === 404) { liveView.error = 'This live link has ended.'; renderBanner(); return; }
    if (r.status === 200) {
      const j = await r.json();
      const tab = first ? 'schedule' : state.tab;
      state = normalize(j.data); state.tab = tab; state.demo = false;
      liveView.updated = j.updated;
      const y = window.scrollY; render(); if (!first) window.scrollTo(0, y);
    }
    if (liveView.error) { liveView.error = ''; renderBanner(); }
    else if (r.status === 204) renderBanner();
  } catch (e) {
    liveView.error = 'Trying to reconnect to the live scoreboard…'; renderBanner();
  }
}

/* ============================ Share / export ============================ */
function b64url(bytes) { let s = ''; bytes.forEach(b => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function fromB64url(str) { const s = atob(str.replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, c => c.charCodeAt(0)); }
async function packState() {
  const { live, ...pub } = state;
  const json = new TextEncoder().encode(JSON.stringify({ ...pub, tab: 'schedule', demo: false }));
  if (window.CompressionStream) {
    const cs = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return 'z' + b64url(new Uint8Array(await new Response(cs).arrayBuffer()));
  }
  return 'j' + b64url(json);
}
async function unpackState(s) {
  const bytes = fromB64url(s.slice(1));
  if (s[0] === 'z') {
    const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return JSON.parse(await new Response(ds).text());
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
function scheduleText() {
  const { items, B } = allItems();
  const P = profileOf();
  const lines = [`${state.name || 'Tournament'}${state.date ? ' — ' + fmtDate(state.date) : ''}`];
  if (P.presenter) lines.push(P.presenter);
  if (state.location) lines.push(state.location);
  lines.push('');
  let lastT = null;
  items.forEach(i => {
    if (i.t !== lastT) { lines.push(fmt(i.t)); lastT = i.t; }
    const a = i.a ? sideName(i.a) : (i.aLabel || 'TBD'), b = i.b ? sideName(i.b) : (i.bLabel || 'TBD');
    const sc = i.final ? `  ${i.sa}-${i.sb} Final` : '';
    lines.push(`  G${i.num} ${fieldName(i.field)}${i.kind === 'bracket' ? ' (' + i.label + ')' : ''}: ${a} vs ${b}${sc}`);
  });
  lines.push('', 'Standings');
  rankTeams().forEach((r, i) => lines.push(`  ${i + 1}. ${r.team} ${r.w}-${r.l}${r.t ? '-' + r.t : ''} (RD ${r.rd > 0 ? '+' : ''}${r.rd})`));
  if (B && B.champion) lines.push('', `Champion: ${B.champion.team}`);
  if (P.cause) lines.push('', P.cause);
  return lines.join('\n');
}
function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.contentEditable = 'true';
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px';
  document.body.appendChild(ta);
  const r = document.createRange(); r.selectNodeContents(ta);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  ta.setSelectionRange(0, text.length);
  let ok = false; try { ok = document.execCommand('copy'); } catch (er) { /* ignore */ }
  ta.remove(); sel.removeAllRanges();
  return ok;
}
function copyText(text, okMsg) {
  // Called directly from a tap, so iPhone Safari allows it.
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => toast(okMsg), () => toast(legacyCopy(text) ? okMsg : 'Press and hold the link to copy it.'));
  } else toast(legacyCopy(text) ? okMsg : 'Press and hold the link to copy it.');
}
function download(name, text) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/* ============================ Events ============================ */
function readSettingsFromForm() {
  const S = state.settings;
  state.name = $('#tName').value.trim();
  state.date = $('#tDate').value;
  state.location = $('#tLocation').value.trim();
  S.gamesPerTeam = +$('#gamesPerTeam').value;
  S.startTime = $('#startTime').value || '08:00';
  S.slotMinutes = Math.min(300, Math.max(15, +$('#slotMinutes').value || 90));
  S.runCap = +$('#runCap').value || 0;
  S.bracketFormat = $('#bracketFormat').value;
  S.advance = +$('#advance').value || 0;
  state.teams = teamList();
}
function setTab(t) { state.tab = t; save(); render(); window.scrollTo({ top: 0, behavior: REDUCED ? 'auto' : 'smooth' }); }
function anyScores() { return state.games.some(g => g.sa !== '' || g.sb !== '') || bracketHasScores(); }

function bind() {
  // tabs (with arrow-key support)
  $('.tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b && !b.disabled) setTab(b.dataset.tab); });
  $('.tabs').addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const tabs = $$('.tabs [data-tab]:not(:disabled)'), i = tabs.findIndex(b => b.dataset.tab === state.tab);
    const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    if (n) { setTab(n.dataset.tab); $(`#tabbtn-${n.dataset.tab}`).focus(); }
  });

  // menu
  const menu = $('#menu'), mb = $('#menuBtn');
  const closeMenu = () => { menu.hidden = true; mb.setAttribute('aria-expanded', 'false'); };
  mb.addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; mb.setAttribute('aria-expanded', String(!menu.hidden)); });
  document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
  menu.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b) return; closeMenu();
    const act = b.dataset.act;
    if (act === 'signout') signOut();
    if (act === 'install') openInstall();
    if (act === 'copy') copyText(scheduleText(), 'Schedule copied. Paste it into your team chat.');
    if (act === 'print') openExport();
    if (act === 'export') download(`${(state.name || 'tournament').replace(/[^\w-]+/g, '-').toLowerCase()}-backup.json`, JSON.stringify(state, null, 2));
    if (act === 'import') $('#importFile').click();
    if (act === 'share') openShare();
    if (act === 'new') {
      if (await ask('Start a new tournament?', 'This clears every team, game and score saved in this browser. Download a backup first if you want to keep it.', 'Clear everything', true)) {
        const keep = state.settings, keepProfile = state.profile; state = lockedProfile() ? freshFor(lockedProfile()) : defaults(); state.profile = keepProfile; state.settings = { ...state.settings, fields: keep.fields, startTime: keep.startTime, slotMinutes: keep.slotMinutes };
        viewOnly = false; save(); render(); $('#tName').focus();
      }
    }
  });
  $('#importFile').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data || !Array.isArray(data.teams)) throw new Error('bad');
      if (!(await ask('Restore this backup?', `“${data.name || 'Untitled'}” will replace the tournament saved in this browser.`, 'Restore'))) return;
      state = normalize(data); enforceProfile(); viewOnly = false; save(); render(); toast('Backup restored.');
    } catch (er) { toast('That file is not a Tournament Manager backup.'); }
  });

  // banner
  $('#banner').addEventListener('click', async e => {
    const b = e.target.closest('[data-b]'); if (!b) return;
    const k = b.dataset.b;
    if (k === 'install') openInstall();
    if (k === 'nohint') { store.set('tm-install-hint', '1'); render(); }
    if (k === 'dismiss') { state.demo = false; save(); render(); }
    if (k === 'fresh') { const s = lockedProfile() ? freshFor(lockedProfile()) : defaults(); state = s; save(); render(); $('#tName').focus(); }
    if (k === 'keep') {
      if (store.get(userKey()) && !(await ask('Replace your tournament?', 'Saving this snapshot replaces the tournament stored in this browser.', 'Replace'))) return;
      viewOnly = false; history.replaceState(null, '', location.pathname); save(); render(); toast('Saved to this browser.');
    }
    if (k === 'leave') { viewOnly = false; history.replaceState(null, '', location.pathname); if (user) startSession(); else showLogin(); }
  });

  // share sheet
  const ss = $('#shareSheet');
  const closeShare = () => { ss.hidden = true; };
  $('#shareClose').addEventListener('click', closeShare);
  ss.addEventListener('click', e => { if (e.target === ss) closeShare(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !ss.hidden) closeShare(); });
  $('#liveChip').addEventListener('click', openShare);
  $('#goLive').addEventListener('click', goLive);
  $('#snapBtn').addEventListener('click', async () => {
    showLink('', ''); $('#shareErr').textContent = '';
    try { showLink(location.origin + location.pathname + '#view=' + await packState(), 'Snapshot link'); $('#shareCopy').focus(); }
    catch (er) { $('#shareErr').textContent = 'Could not make a link in this browser.'; }
  });
  $('#stopLive').addEventListener('click', async () => {
    if (!(await ask('Stop live updates?', 'Anyone who has the link will keep seeing the tournament as it is now, but new scores won\'t show up. You can turn on a new live link later.', 'Stop live updates', true))) return;
    state.live = null; persist(); render(); renderShare();
  });
  $('#shareUrl').addEventListener('focus', e => { if (shareLink) e.target.setSelectionRange(0, shareLink.length); });
  $('#shareCopy').addEventListener('click', () => { if (shareLink) copyText(shareLink, 'Link copied. Paste it into your team chat.'); });
  $('#shareNative').addEventListener('click', () => {
    if (!shareLink || !navigator.share) return;
    const name = state.name || 'Tournament';
    navigator.share({ title: name, text: state.live && shareLink.includes('#live=') ? `${name}: live scores, standings and bracket` : `${name}: schedule, standings and bracket`, url: shareLink })
      .catch(er => { if (er && er.name !== 'AbortError') copyText(shareLink, 'Link copied. Paste it into your team chat.'); });
  });
  window.addEventListener('beforeprint', () => renderPrint());
  window.addEventListener('online', () => { if (state.live) pushLive(); if (liveView) pollLive(); });

  // print / save sheet
  const ex = $('#exportSheet');
  const closeEx = () => { ex.hidden = true; };
  $('#exClose').addEventListener('click', closeEx);
  ex.addEventListener('click', e => { if (e.target === ex) closeEx(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !ex.hidden) closeEx(); });
  ex.addEventListener('change', e => { if (e.target.name === 'exSel') { ui.printSel = e.target.value; $('#exResult').hidden = true; } });
  $('#exPrint').addEventListener('click', () => { ui.printSel = exportSel(); renderPrint(ui.printSel); closeEx(); window.print(); });
  $('#exPdf').addEventListener('click', () => runExport('pdf'));
  $('#exImg').addEventListener('click', () => runExport('image'));
  $('#exSave').addEventListener('click', saveExport);

  // install sheet
  const sheet = $('#installSheet');
  const closeSheet = () => { sheet.hidden = true; };
  $('#installClose').addEventListener('click', closeSheet);
  sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });
  $('#installCopy').addEventListener('click', () => copyText(location.origin + location.pathname, 'App link copied.'));
  $('#installNative').addEventListener('click', async () => {
    if (!installEvt) return; installEvt.prompt();
    try { await installEvt.userChoice; } catch (er) { /* ignore */ }
    installEvt = null; closeSheet();
  });
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
  window.addEventListener('appinstalled', () => { installEvt = null; toast('Installed. Find Tournament on your home screen.'); });

  // setup inputs
  ['#tName', '#tDate', '#tLocation', '#gamesPerTeam', '#startTime', '#slotMinutes', '#runCap', '#bracketFormat', '#advance'].forEach(sel => {
    $(sel).addEventListener('input', () => { readSettingsFromForm(); if (state.demo) state.demo = false; save(); renderMast(); renderSetupDerived(); });
  });
  $('#tProfile').addEventListener('change', async e => {
    if (lockedProfile()) { e.target.value = state.profile; return; }
    const key = e.target.value, P = PROFILES[key] || PROFILES.standard;
    state.profile = key; state.demo = false;
    if (P.event) {
      const ev = P.event, differs = (state.name && state.name !== ev.name) || (state.date && state.date !== ev.date);
      if (!differs || await ask(`Use the ${P.label} event details?`, `Sets the name to “${ev.name}”, the date to ${fmtDate(ev.date)} and the location to ${ev.location}.`, 'Use event details')) {
        state.name = ev.name; state.date = ev.date; state.location = ev.location;
      }
    }
    save(); render(); toast(`${P.label} profile applied.`);
  });
  $('#teamsInput').addEventListener('input', () => { readSettingsFromForm(); save(); renderSetupDerived(); renderMast(); });
  $('#sampleBtn').addEventListener('click', () => { $('#teamsInput').value = SAMPLE.join('\n'); readSettingsFromForm(); save(); renderSetupDerived(); });
  $('#fieldNames').addEventListener('input', e => { const i = +e.target.dataset.fi; state.settings.fields[i] = e.target.value || `Field ${i + 1}`; save(); });
  $('#fieldPlus').addEventListener('click', () => { const f = state.settings.fields; if (f.length < 16) { f.push(`Field ${f.length + 1}`); save(); renderSetup(); renderMast(); } });
  $('#fieldMinus').addEventListener('click', () => {
    const f = state.settings.fields; if (f.length <= 1) return; f.pop();
    state.games.forEach(g => { if (g.field >= f.length) g.field = f.length - 1; });
    save(); renderSetup(); renderMast();
  });
  $('#drawBtn').addEventListener('click', async () => {
    readSettingsFromForm();
    if (state.teams.length < 2) { $('#setupMsg').textContent = 'Add at least 2 teams, one per line.'; $('#teamsInput').focus(); return; }
    $('#setupMsg').textContent = '';
    if (anyScores() && !(await ask('Re-draw and rebuild?', 'A new draw makes new matchups. Every score and the bracket will be cleared.', 'Re-draw', true))) return;
    state.demo = false;
    state.order = shuffle(state.teams);
    buildSchedule(); save();
    await animateDraw(state.order);
    setTab('schedule');
  });
  $('#redrawBtn').addEventListener('click', () => $('#drawBtn').click());
  $('#retimeBtn').addEventListener('click', async () => {
    readSettingsFromForm();
    if (!(await ask('Apply new times and fields?', 'Matchups and scores stay the same. Every pool game gets a new time and field from your current settings.', 'Apply'))) return;
    retime(); if (state.bracket) state.bracket.overrides = {}; save(); render(); toast('Schedule updated.');
  });

  // schedule & bracket: scores, times
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.classList.contains('score')) {
      const v = cleanScore(el.value); if (v !== el.value) el.value = v;
      setScore(el.dataset.kind, el.dataset.id, el.dataset.side, v);
      renderMast(); renderTabs();
      if (el.dataset.kind === 'pool') {
        const card = el.closest('[data-card]'); const g = state.games.find(x => x.id === el.dataset.id);
        if (card && g) { card.classList.toggle('is-final', isFinal(g)); }
      }
    }
  });
  document.addEventListener('change', e => {
    const el = e.target;
    if (el.classList.contains('score')) { deferRender(); return; }
    if (el.dataset && el.dataset.what) { setTimeField(el.dataset.kind, el.dataset.id, el.dataset.what, el.value); deferRender(); return; }
    if (el.id === 'teamFilter') { ui.team = el.value; renderSchedule(); }
    if (el.id === 'editToggle' || el.id === 'editToggle2') { ui.edit = el.checked; render(); }
    if (el.id === 'delaySel' && el.value) {
      const m = +el.value; el.value = '';
      rainDelay(m); render(); toast(`Unplayed games pushed back ${m} minutes.`);
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('score')) {
      const all = $$('.score:not(:disabled)'); const i = all.indexOf(e.target);
      if (all[i + 1]) all[i + 1].focus(); else e.target.blur();
    }
  });

  // standings tie order
  $('#ties').addEventListener('click', e => {
    const b = e.target.closest('[data-tie]'); if (!b) return;
    const i = +b.dataset.tie, j = i + +b.dataset.d, t = state.settings.ties;
    [t[i], t[j]] = [t[j], t[i]]; save(); renderStandings();
    const nb = $(`#ties [data-tie="${j}"][data-d="${b.dataset.d}"]`); if (nb && !nb.disabled) nb.focus();
  });

  // bracket buttons
  $('#bracketArea').addEventListener('click', async e => {
    const id = e.target.closest('button') && e.target.closest('button').id;
    if (id === 'buildBracketBtn') {
      buildBracket(); save(); render();
    }
    if (id === 'rebuildBtn' || id === 'reseedBtn') {
      if (bracketHasScores() && !(await ask('Rebuild the bracket?', 'Seeds are taken from the current standings and every bracket score is cleared.', 'Rebuild', true))) return;
      state.bracket.format = state.settings.bracketFormat;
      buildBracket(); save(); render(); toast('Bracket rebuilt.');
    }
  });
}
let renderQueued = false;
function deferRender() {
  if (renderQueued) return; renderQueued = true;
  setTimeout(() => {
    renderQueued = false;
    const id = document.activeElement && document.activeElement.id;
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
    if (id) { const el = document.getElementById(id); if (el) el.focus({ preventScroll: true }); }
  }, 0);
}

/* ============================ Boot ============================ */
async function sha256hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('');
}
function showLogin() {
  const ls = $('#loginScreen'); ls.hidden = false;
  document.body.classList.add('locked');
  setTimeout(() => $('#loginUser').focus(), 50);
}
function startSession() {
  $('#loginScreen').hidden = true; document.body.classList.remove('locked');
  load(); render();
  if (state.live) { sync.status = 'pending'; renderLiveChip(); pushLive(); }
}
function bindLogin() {
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const u = $('#loginUser').value.trim().toLowerCase(), pw = $('#loginPass').value;
    const acct = ACCOUNTS[u];
    let ok = false;
    try { ok = !!acct && (await sha256hex(`${u}:${pw}`)) === acct.hash; } catch (er) { ok = false; }
    if (!ok) { $('#loginErr').textContent = 'That username and password don\'t match. Try again.'; $('#loginPass').select(); return; }
    $('#loginErr').textContent = ''; $('#loginPass').value = '';
    user = u; store.set(SESSION_KEY, u);
    startSession();
    toast(`Signed in as ${acct.name}.`);
  });
}
function signOut() {
  clearTimeout(sync.timer);
  store.del(SESSION_KEY); user = null;
  location.replace(location.pathname);
}
async function boot() {
  const saved = store.get(SESSION_KEY);
  user = saved && ACCOUNTS[saved] ? saved : null;
  bindLogin();
  const lv = location.hash.match(/^#live=([a-z0-9]{8})$/);
  if (lv) {
    viewOnly = true; liveView = { id: lv[1], updated: 0, error: '' };
    state = normalize({ ...defaults(), tab: 'schedule' });
    bind(); render();
    await pollLive(true);
    setInterval(() => { if (!document.hidden) pollLive(); }, 15000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pollLive(); });
    registerSW();
    return;
  }
  const m = location.hash.match(/^#view=(.+)$/);
  if (m) {
    try { state = normalize(await unpackState(m[1])); viewOnly = true; bind(); render(); registerSW(); return; }
    catch (e) { toast('That shared link could not be opened.'); history.replaceState(null, '', location.pathname); }
  }
  bind();
  registerSW();
  if (!user) { showLogin(); return; }
  startSession();
}
function registerSW() {
  if ('serviceWorker' in navigator && !EMBEDDED && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline mode unavailable */ });
  }
}
window.__tm = { get state() { return state; }, resolveBracket, rankTeams, allItems }; // handy for debugging in the console
boot();
})();
