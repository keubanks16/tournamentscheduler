/* Tournament Manager — pool play, scheduling, standings and championship bracket.
   Plain JavaScript, no build step. Everything is stored in this browser (localStorage). */
(() => {
'use strict';

const KEY = 'tournament-manager-v5';
const OLD_KEY = 'tournament-manager-v4-all-teams';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const EMBEDDED = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
const REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const SAMPLE = ['GS Baseball', 'Dirtdogs', 'Bandits', 'Titans', 'Warriors', 'Braves', 'Bulldogs', 'Raptors'];
const TIE = { pct: ['Win %', 'PCT'], h2h: ['Head-to-head', 'H2H'], rd: ['Run differential', 'RD'], ra: ['Fewest runs allowed', 'RA'], rf: ['Most runs scored', 'RF'] };

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
};

/* ============================ State ============================ */
function defaults() {
  return {
    v: 5, name: '', date: '', teams: [], order: [], short: [],
    settings: { gamesPerTeam: 3, fields: ['Field 1', 'Field 2'], startTime: '08:00', slotMinutes: 90, bracketFormat: 'single', advance: 0, runCap: 0, ties: ['pct', 'h2h', 'rd', 'ra', 'rf'] },
    games: [], bracket: null, tab: 'setup', demo: false
  };
}
let state = defaults();
let viewOnly = false;
const ui = { team: '', edit: false };

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
  if (o.bracket) o.bracket = { results: {}, overrides: {}, delay: 0, ...o.bracket };
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
function load() {
  const raw = store.get(KEY);
  if (raw) { try { state = normalize(JSON.parse(raw)); return; } catch (e) { /* fall through */ } }
  const old = store.get(OLD_KEY);
  if (old) { const m = migrateOld(old); if (m && m.teams.length) { state = normalize(m); save(); return; } }
  state = makeDemo();
}
function save() { if (!viewOnly) store.set(KEY, JSON.stringify(state)); }

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
  const ordered = [...state.games].sort((x, y) => toMin(x.time) - toMin(y.time) || x.field - y.field);
  assignSlots(ordered, toMin(state.settings.startTime));
}
const poolSorted = () => [...state.games].sort((x, y) => toMin(x.time) - toMin(y.time) || x.field - y.field);

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
function poolEnd() { return state.games.length ? Math.max(...state.games.map(g => toMin(g.time))) : toMin(state.settings.startTime) - state.settings.slotMinutes; }
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
function resolveSingle(br) {
  const F = state.settings.fields.length, len = state.settings.slotMinutes;
  const seeds = br.seeds, size = nextPow2(seeds.length), pos = seedPositions(size);
  const ent = s => seeds[s - 1] ? { team: seeds[s - 1], seed: s } : null;
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
  const seeds = br.seeds, seedOf = t => seeds.indexOf(t) + 1;
  const losses = Object.fromEntries(seeds.map(t => [t, 0])), byeCount = {}, played = new Set();
  const rounds = []; let cursor = bracketStart(), num = state.games.length + 1, champion = null, finalStarted = false;
  for (let r = 0; r < 80; r++) {
    const alive = seeds.filter(t => losses[t] < 2);
    if (alive.length <= 1) { champion = alive[0] ? { team: alive[0], seed: seedOf(alive[0]) } : null; break; }
    const zero = alive.filter(t => losses[t] === 0), one = alive.filter(t => losses[t] === 1);
    const games = [], byes = [];
    const mk = (a, b, label, group) => {
      const key = `D${r}:${a}|${b}`;
      games.push({ key, r, a: { team: a, seed: seedOf(a) }, b: { team: b, seed: seedOf(b) }, label, group, num: num++ });
    };
    const pairUp = (arr, label, group) => {
      const list = [...arr];
      if (list.length % 2) {
        let bi = 0; list.forEach((t, i) => { if ((byeCount[t] || 0) < (byeCount[list[bi]] || 0)) bi = i; });
        const t = list.splice(bi, 1)[0]; byeCount[t] = (byeCount[t] || 0) + 1; byes.push({ team: t, group });
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
  return { format: 'double', rounds, games: rounds.flatMap(x => x.games), champion, losses };
}
function resolveBracket() { const br = state.bracket; if (!br) return null; return br.format === 'double' ? resolveDouble(br) : resolveSingle(br); }
function buildBracket() {
  state.bracket = { format: state.settings.bracketFormat, seeds: projectedSeeds(), results: {}, overrides: {}, delay: 0 };
}
function bracketHasScores() { const br = state.bracket; return !!br && Object.values(br.results).some(r => r.sa !== '' || r.sb !== ''); }
function seedsChanged() { const br = state.bracket; if (!br) return false; const p = projectedSeeds(); return p.length !== br.seeds.length || p.some((t, i) => t !== br.seeds[i]); }

/* ============================ Scores ============================ */
function cleanScore(v) { v = String(v).replace(/\D/g, '').slice(0, 3); return v; }
function setScore(kind, id, side, v) {
  if (kind === 'pool') {
    const g = state.games.find(x => x.id === id); if (!g) return;
    g['s' + side] = v;
  } else {
    const B = resolveBracket(); const m = B && B.games.find(x => x.key === id);
    if (!m || !m.a || !m.b) return;
    const br = state.bracket;
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
  const items = poolSorted().map((g, i) => ({ kind: 'pool', id: g.id, num: i + 1, label: 'Pool A', t: toMin(g.time), field: g.field, a: { team: g.a }, b: { team: g.b }, sa: g.sa, sb: g.sb, final: isFinal(g) }));
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
}
function renderMast() {
  $('#mastName').textContent = state.name || 'Tournament Manager';
  document.title = state.name ? `${state.name} · Tournament Manager` : 'Tournament Manager';
  const bits = [];
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
  $$('.needs-top').forEach(b => { b.hidden = EMBEDDED; });
}
function renderTabs() {
  const has = state.games.length > 0;
  $$('.tabs [data-tab]').forEach(b => {
    const t = b.dataset.tab;
    b.setAttribute('aria-selected', String(state.tab === t));
    b.tabIndex = state.tab === t ? 0 : -1;
    b.disabled = t !== 'setup' && !has;
  });
  const fin = state.games.filter(isFinal).length;
  $('#cnt-schedule').textContent = has ? `${fin}/${state.games.length}` : '';
  const B = resolveBracket();
  $('#cnt-bracket').textContent = B ? (B.champion ? '🏆' : 'Live') : '';
}
function renderBanner() {
  const el = $('#banner');
  if (viewOnly) {
    el.className = 'banner';
    el.innerHTML = `<p>You're viewing a shared snapshot. Changes here won't be saved.</p><div class="actions"><button class="btn btn-sm" data-b="keep">Save as my tournament</button><button class="btn btn-sm" data-b="leave">Back to mine</button></div>`;
    el.hidden = false;
  } else if (state.demo) {
    el.className = 'banner';
    el.innerHTML = `<p>This is an example tournament with a few scores filled in. Look around, then start your own.</p><div class="actions"><button class="btn btn-sm btn-primary" data-b="fresh">Start my tournament</button><button class="btn btn-sm" data-b="dismiss">Keep the example</button></div>`;
    el.hidden = false;
  } else el.hidden = true;
}

/* ---------- Setup ---------- */
function teamList() { return [...new Set($('#teamsInput').value.split('\n').map(x => x.trim()).filter(Boolean))]; }
function renderSetup() {
  const S = state.settings;
  if (document.activeElement !== $('#tName')) $('#tName').value = state.name;
  $('#tDate').value = state.date || '';
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
  const won = winnerOf(it) === side.team;
  return `<span class="tm${won ? ' won' : ''}${hl === side.team ? ' mine' : ''}">${side.seed ? `<span class="seed">#${side.seed}</span>` : ''}<span>${esc(side.team)}</span></span>`;
}
function scoreInput(it, side) {
  const can = it.a && it.b && !viewOnly;
  const v = side === 'a' ? it.sa : it.sb;
  const name = side === 'a' ? (it.a && it.a.team) : (it.b && it.b.team);
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
  if (it.t === nextT && it.a && it.b) return '<span class="tag next">Up next</span>';
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
  $('#editToggle').disabled = viewOnly; $('#delaySel').disabled = viewOnly;
  const { items } = allItems();
  const pending = items.filter(i => !i.final && i.a && i.b);
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
  const row = (s, label, side) => `<div class="m-row">${s ? `<span class="tm${w === s.team ? ' won' : ''}"><span class="seed">#${s.seed}</span><span>${esc(s.team)}</span></span>` : `<span class="tm tbd">${esc(label || 'TBD')}</span>`}${scoreInput(it, side)}</div>`;
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
      <p class="note" style="margin:0 0 14px">${fin < total ? `${total - fin} pool game${total - fin > 1 ? 's' : ''} still need a score. Seeds come straight from the standings.` : `Pool play is done. ${seeds.length} teams advance, seeded by the standings.`}${nextPow2(seeds.length) !== seeds.length && S.bracketFormat === 'single' ? ` Top seeds get ${nextPow2(seeds.length) - seeds.length} first-round bye${nextPow2(seeds.length) - seeds.length > 1 ? 's' : ''}.` : ''}</p>
      <ol class="seed-list">${seeds.map((t, i) => `<li><b>${i + 1}</b><span>${esc(t)}</span><span class="rec">${r[t].w}-${r[t].l}${r[t].t ? '-' + r[t].t : ''}</span></li>`).join('')}</ol>
      <div class="actions" style="margin-top:16px"><button class="btn btn-primary" id="buildBracketBtn" ${viewOnly || seeds.length < 2 ? 'disabled' : ''}>Build the bracket</button>
      <span class="note" style="margin:0;align-self:center">Bracket games start at ${fmt(bracketStart())} and keep rotating through your fields.</span></div></div>`;
    return;
  }
  const B = resolveBracket();
  let html = '';
  if (seedsChanged() && !viewOnly) html += `<div class="banner warn"><p>Pool results changed after the bracket was built, so the seeds no longer match the standings.</p><div class="actions"><button class="btn btn-sm" id="reseedBtn">Rebuild with new seeds</button></div></div>`;
  html += `<div class="card"><div class="card-head"><h2 class="h-card">Championship bracket</h2><div class="actions"><span class="pill">${B.format === 'double' ? 'Double' : 'Single'} elimination · ${br.seeds.length} teams</span>${viewOnly ? '' : `<label class="switch"><input type="checkbox" id="editToggle2" ${ui.edit ? 'checked' : ''}><span>Edit times</span></label><button class="btn btn-sm" id="rebuildBtn">Rebuild</button>`}</div></div>
    <p class="note" style="margin:0 0 6px">Enter the final score in each game. The winner moves on automatically.${B.format === 'double' ? ' A team is out after its second loss.' : ''}</p>`;
  if (B.champion) html += `<div class="champ" style="margin:12px 0">${trophy()}<p class="eyebrow">${esc(state.name || 'Tournament')} champion</p><strong>${esc(B.champion.team)}</strong><span class="note" style="margin:0">#${B.champion.seed} seed</span></div>`;

  if (B.format === 'single') {
    html += `<div class="bracket-scroll"><div class="bk">` + B.rounds.map((round) => `<div class="bk-col"><h3>${esc(round[0].label)}</h3><div class="bk-slots">${round.map(m => `<div class="bk-slot">${m.bye ? `<div class="match is-bye"><div class="m-meta"><span>Bye</span></div><div class="m-row"><span class="tm"><span class="seed">#${m.winner.seed}</span><span>${esc(m.winner.team)}</span></span></div></div>` : bracketMatch(m)}</div>`).join('')}</div></div>`).join('') + `</div></div>`;
  } else {
    const L = B.losses;
    html += `<div class="status-strip" style="margin:12px 0">${br.seeds.map((t, i) => { const l = L[t] || 0; return `<span class="st ${l >= 2 ? 'out' : 'l' + l}"><span>#${i + 1} ${esc(t)}</span><i>${l >= 2 ? 'Out' : l === 1 ? '1 loss' : 'Unbeaten'}</i></span>`; }).join('')}</div>`;
    html += `<div class="bracket-scroll"><div class="de-cols">` + B.rounds.map((rd, ri) => {
      const groups = { w: [], e: [], c: [] }; rd.games.forEach(g => groups[g.group].push(g));
      const name = { w: 'Winners side', e: 'Elimination side', c: 'Championship' };
      const body = ['c', 'w', 'e'].filter(k => groups[k].length).map(k => `<p class="de-group ${k}">${name[k]}</p>${groups[k].map(g => bracketMatch(g)).join('')}`).join('');
      const byes = rd.byes.length ? `<div class="byes">Bye this round: ${rd.byes.map(b => esc(b.team)).join(', ')}</div>` : '';
      return `<div class="de-col"><h3>Round ${ri + 1}</h3>${body}${byes}</div>`;
    }).join('') + (!B.champion ? `<div class="de-col"><h3>Round ${B.rounds.length + 1}</h3><div class="waiting">Pairings appear when every game in round ${B.rounds.length} is final. Next start: about ${fmt(B.rounds[B.rounds.length - 1].nextTime)}.</div></div>` : '') + `</div></div>`;
  }
  html += `</div>`;
  area.innerHTML = html;
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

/* ============================ Share / export ============================ */
function b64url(bytes) { let s = ''; bytes.forEach(b => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function fromB64url(str) { const s = atob(str.replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, c => c.charCodeAt(0)); }
async function packState() {
  const json = new TextEncoder().encode(JSON.stringify({ ...state, tab: 'schedule', demo: false }));
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
  const lines = [`${state.name || 'Tournament'}${state.date ? ' — ' + fmtDate(state.date) : ''}`, ''];
  let lastT = null;
  items.forEach(i => {
    if (i.t !== lastT) { lines.push(fmt(i.t)); lastT = i.t; }
    const a = i.a ? i.a.team : (i.aLabel || 'TBD'), b = i.b ? i.b.team : (i.bLabel || 'TBD');
    const sc = i.final ? `  ${i.sa}-${i.sb} Final` : '';
    lines.push(`  G${i.num} ${fieldName(i.field)}${i.kind === 'bracket' ? ' (' + i.label + ')' : ''}: ${a} vs ${b}${sc}`);
  });
  lines.push('', 'Standings');
  rankTeams().forEach((r, i) => lines.push(`  ${i + 1}. ${r.team} ${r.w}-${r.l}${r.t ? '-' + r.t : ''} (RD ${r.rd > 0 ? '+' : ''}${r.rd})`));
  if (B && B.champion) lines.push('', `Champion: ${B.champion.team}`);
  return lines.join('\n');
}
async function copyText(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (er) { /* ignore */ }
    ta.remove(); toast(ok ? okMsg : 'Copy was blocked by the browser.');
  }
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
    if (act === 'copy') copyText(scheduleText(), 'Schedule copied. Paste it into your team chat.');
    if (act === 'print') window.print();
    if (act === 'export') download(`${(state.name || 'tournament').replace(/[^\w-]+/g, '-').toLowerCase()}-backup.json`, JSON.stringify(state, null, 2));
    if (act === 'import') $('#importFile').click();
    if (act === 'share') {
      try {
        const packed = await packState();
        const url = location.origin + location.pathname + '#view=' + packed;
        copyText(url, 'View-only link copied. It shows the tournament as it is right now.');
      } catch (er) { toast('Could not make a link in this browser.'); }
    }
    if (act === 'new') {
      if (await ask('Start a new tournament?', 'This clears every team, game and score saved in this browser. Download a backup first if you want to keep it.', 'Clear everything', true)) {
        const keep = state.settings; state = defaults(); state.settings = { ...state.settings, fields: keep.fields, startTime: keep.startTime, slotMinutes: keep.slotMinutes };
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
      state = normalize(data); viewOnly = false; save(); render(); toast('Backup restored.');
    } catch (er) { toast('That file is not a Tournament Manager backup.'); }
  });

  // banner
  $('#banner').addEventListener('click', async e => {
    const b = e.target.closest('[data-b]'); if (!b) return;
    const k = b.dataset.b;
    if (k === 'dismiss') { state.demo = false; save(); render(); }
    if (k === 'fresh') { const s = defaults(); state = s; save(); render(); $('#tName').focus(); }
    if (k === 'keep') {
      if (store.get(KEY) && !(await ask('Replace your tournament?', 'Saving this snapshot replaces the tournament stored in this browser.', 'Replace'))) return;
      viewOnly = false; history.replaceState(null, '', location.pathname); save(); render(); toast('Saved to this browser.');
    }
    if (k === 'leave') { viewOnly = false; history.replaceState(null, '', location.pathname); load(); render(); }
  });

  // setup inputs
  ['#tName', '#tDate', '#gamesPerTeam', '#startTime', '#slotMinutes', '#runCap', '#bracketFormat', '#advance'].forEach(sel => {
    $(sel).addEventListener('input', () => { readSettingsFromForm(); if (state.demo) state.demo = false; save(); renderMast(); renderSetupDerived(); });
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
      const left = state.games.filter(g => !isFinal(g)).length;
      if (left && !(await ask('Pool play is not finished', `${left} pool game${left > 1 ? 's are' : ' is'} still missing a score. Build the bracket from the current standings anyway?`, 'Build anyway'))) return;
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
async function boot() {
  load();
  const m = location.hash.match(/^#view=(.+)$/);
  if (m) {
    try { state = normalize(await unpackState(m[1])); viewOnly = true; }
    catch (e) { toast('That shared link could not be opened.'); }
  }
  bind();
  render();
}
window.__tm = { get state() { return state; }, resolveBracket, rankTeams, allItems }; // handy for debugging in the console
boot();
})();
