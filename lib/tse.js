'use strict';
// TSE results: URL building, defensive parsing and the poller. No dependencies.
const fs = require('node:fs');
const path = require('node:path');

const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];
const OFFICES = { 1: 'Presidente', 3: 'Governador(a)', 5: 'Senador(a)', 6: 'Dep. Federal', 7: 'Dep. Estadual', 8: 'Dep. Distrital' };
// Deputies: DF has no c0007 (it 404s); its state-level chamber is Deputado Distrital, c0008.
const depEstadualCargo = uf => (uf === 'DF' ? 8 : 7);
const MAX_EVENTS = 1000; // high enough that a state picked on the map still has its own history

// ---------- small helpers ----------
const normKey = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const pad = (n, w) => String(n).padStart(w, '0');

function fillTemplate(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}

function resultUrl(tse, { cycle, ele, uf, cargo }) {
  const u = String(uf).toLowerCase();
  return fillTemplate(tse.resultUrl, { base: tse.base, env: tse.env, cycle, ele, uf: u, cargo4: pad(cargo, 4), ele6: pad(ele, 6), cargo });
}
const configUrl = tse => fillTemplate(tse.configUrl, { base: tse.base, env: tse.env });

// "1.234.567" / "1234567" / 1234567 -> 1234567
function parseIntLoose(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : 0;
  if (v == null) return 0;
  const d = String(v).replace(/[^0-9-]/g, '');
  const n = parseInt(d, 10);
  return Number.isFinite(n) ? n : 0;
}
// "12,34" (percent) -> 0.1234 ; numbers are treated as percent too
function parsePct(v) {
  if (v == null || v === '') return null;
  let s = String(v).trim().replace('%', '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, Math.round(n * 1e4) / 1e6)) : null;
}

// ---------- parties ----------
// Only 'direita' and 'esquerda' exist. Anything else (missing, typo, old 'centro') and any unmatched
// party falls back to cfg.padrao (default 'esquerda').
const SIDES = new Set(['direita', 'esquerda']);
function normSide(v, fallback) { const s = String(v ?? '').trim().toLowerCase(); return SIDES.has(s) ? s : fallback; }

function indexParties(cfg) {
  const byAcr = new Map(), byNum = new Map();
  const padrao = normSide(cfg && cfg.padrao, 'esquerda');
  for (const p of (cfg && cfg.parties) || []) {
    const entry = { sigla: p.sigla, numero: p.numero ?? null, lado: normSide(p.lado, padrao) };
    for (const name of [p.sigla, ...(p.aliases || [])]) if (name) byAcr.set(normKey(name), entry);
    if (p.numero != null) byNum.set(Number(p.numero), entry);
  }
  const overrides = {};
  for (const [k, v] of Object.entries((cfg && cfg.overrides) || {})) overrides[k.toLowerCase()] = normSide(v, padrao);
  return { byAcr, byNum, overrides, padrao };
}

function acronymFromCc(cc) {
  if (!cc) return null;
  const first = String(cc).split(/\s+-\s+|\/|\(|\s-|-\s/)[0].trim();
  return first || null;
}
const numPrefix = n => { const d = String(n ?? '').replace(/\D/g, ''); return d.length >= 2 ? Number(d.slice(0, 2)) : null; };

function sideOf(c, uf, P) {
  const ov = P.overrides[`${String(uf).toLowerCase()}:${c.number}`];
  if (ov) return ov;
  const a = c.party && P.byAcr.get(normKey(c.party));
  if (a) return a.lado;
  const b = P.byNum.get(numPrefix(c.number));
  if (b) return b.lado;
  return P.padrao || 'esquerda';
}

// ---------- defensive parser ----------
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
function looksCandidate(o) {
  if (!isObj(o) || o.vap === undefined) return false;
  if (o.nm === undefined && o.nmu === undefined && o.n === undefined) return false;
  // a party/coalition node that wraps candidates is a container, not a candidate
  for (const v of Object.values(o)) if (Array.isArray(v) && v.some(x => isObj(x) && x.vap !== undefined)) return false;
  return true;
}
const partyField = o => o.sg ?? o.sgp ?? (typeof o.par === 'string' ? o.par : undefined);
const CONTAINER_KEYS = ['cand', 'par', 'agr', 'abr', 'carper'];
// name/number-only record (e.g. the fixed part of a unified file: carper/agr/par/cand without votes)
function looksCandidateInfo(o) {
  if (!isObj(o) || o.vap !== undefined || o.n === undefined) return false;
  if (o.nm === undefined && o.nmu === undefined) return false;
  if (o.sg !== undefined || CONTAINER_KEYS.some(k => o[k] !== undefined)) return false; // party / coalition / abrangência node
  return true;
}
const candKey = o => (o.n != null && String(o.n).trim() !== '') ? 'n:' + String(o.n).trim() : (o.sqcand != null ? 's:' + o.sqcand : null);

// Collects every candidate record in the tree and MERGES duplicates by candidate number, so a candidate that
// appears twice (fixed + variable parts of a unified file, or several abrangências) is counted once.
// Votes/pct/status come from the record with the most votes (the widest scope); name/party from whichever has them.
function extractCandidates(json) {
  const byKey = new Map(), order = [];
  const info = new Map();
  const walk = (node, ctxParty) => {
    if (Array.isArray(node)) { for (const x of node) walk(x, ctxParty); return; }
    if (!isObj(node)) return;
    if (looksCandidate(node) || looksCandidateInfo(node)) {
      const own = partyField(node);
      const rec = {
        hasVotes: node.vap !== undefined,
        name: String(node.nmu || node.nm || '').trim(),
        number: node.n != null ? String(node.n).trim() : '',
        votes: parseIntLoose(node.vap),
        pct: parsePct(node.pvap),
        e: node.e, st: node.st != null ? String(node.st) : '',
        dvt: node.dvt != null ? String(node.dvt) : '',
        party: own ? String(own) : (ctxParty || acronymFromCc(node.cc)),
        rawParty: !!own || !!ctxParty,
      };
      const key = candKey(node) || ('x:' + order.length + ':' + rec.name);
      if (!rec.hasVotes) { if (!info.has(key)) info.set(key, rec); return; }
      const prev = byKey.get(key);
      if (!prev) { byKey.set(key, rec); order.push(key); return; }
      const [hi, lo] = rec.votes > prev.votes ? [rec, prev] : [prev, rec];
      byKey.set(key, { ...hi, name: hi.name || lo.name, st: hi.st || lo.st, e: hi.e ?? lo.e, dvt: hi.dvt || lo.dvt,
        pct: hi.pct ?? lo.pct, ...(hi.party && (hi.rawParty || !lo.rawParty) ? {} : { party: lo.party || hi.party, rawParty: lo.rawParty }) });
      return;
    }
    const p = partyField(node);
    const ctx = p ? String(p) : ctxParty;
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, ctx);
  };
  walk(json, null);
  return order.map(k => {
    const r = byKey.get(k), i = info.get(k);
    if (i) {
      if (!r.name) r.name = i.name;
      if (i.party && (!r.party || (i.rawParty && !r.rawParty))) { r.party = i.party; r.rawParty = i.rawParty; }
      if (!r.st) r.st = i.st;
      if (r.e == null) r.e = i.e;
      if (!r.dvt) r.dvt = i.dvt;
    }
    const e = r.e;
    return {
      name: r.name || (r.number ? `Candidato ${r.number}` : 'Candidato'),
      number: r.number,
      votes: r.votes,
      pct: r.pct,
      elected: e === 's' || e === 'S' || e === true || (/^eleit[oa]/i.test(r.st) && !/n[ãa]o eleit/i.test(r.st)),
      st: r.st,
      valid: !/anulad|nulo/i.test(r.dvt),
      party: r.party,
      rawParty: r.rawParty,
    };
  });
}

// Section progress: breadth-first, shallowest node wins (root, root.s, abr[0], abr[0].s ...), pst preferred.
function sectionProgress(json) {
  for (const k of ['pst', 'psa', 'pesi']) {
    let level = [json];
    for (let depth = 0; depth < 5 && level.length; depth++) {
      const next = [];
      for (const o of level) {
        if (Array.isArray(o)) { if (isObj(o[0])) next.push(o[0]); continue; }  // first abrangência only
        if (!isObj(o)) continue;
        if (o[k] != null && typeof o[k] !== 'object') { const p = parsePct(o[k]); if (p != null) return p; }
        if (o.vap !== undefined) continue;                     // never descend into candidates
        for (const [kk, v] of Object.entries(o)) if (v && typeof v === 'object' && kk !== 'cand') next.push(v);
      }
      level = next;
    }
  }
  return 0;
}

function parseResult(json, P, uf) {
  const cands = extractCandidates(json).map(c => {
    // if the acronym came from cc and is unknown but the number maps to a known party, prefer that label
    if (c.party && !P.byAcr.has(normKey(c.party))) {
      const b = P.byNum.get(numPrefix(c.number));
      if (b && !c.rawParty) c.party = b.sigla;
    }
    if (!c.party) { const b = P.byNum.get(numPrefix(c.number)); c.party = b ? b.sigla : ''; }
    delete c.rawParty;
    c.side = sideOf(c, uf, P);
    return c;
  });
  const totalValid = cands.reduce((a, c) => a + (c.valid ? c.votes : 0), 0);
  for (const c of cands) if (c.pct == null) c.pct = totalValid > 0 && c.valid ? c.votes / totalValid : 0;
  let votesLeft = 0, votesRight = 0;
  for (const c of cands) {
    if (!c.valid) continue;
    if (c.side === 'esquerda') votesLeft += c.votes; else if (c.side === 'direita') votesRight += c.votes;
  }
  return { pctSections: sectionProgress(json), votesLeft, votesRight, candidates: cands };
}

// Race status for the state sidebar: decided once someone is elected (or the race goes to a runoff),
// otherwise pending with the current leader. Deputies have many winners, so "leader" = most voted so far.
function raceSummary(parsed, office) {
  const cands = parsed.candidates.filter(c => c.valid !== false);
  const top = cands.slice().sort((a, b) => b.votes - a.votes)[0];
  const runoff = cands.some(c => /2[º°o]?\s*turno/i.test(c.st || ''));
  const decided = cands.some(c => c.elected) || runoff;
  const leader = top && top.votes > 0 ? { name: top.name, party: top.party, side: top.side, pct: top.pct } : null;
  return { office, pctSections: parsed.pctSections, decided, status: runoff ? '2º turno' : decided ? 'decidido' : 'pendente', leader };
}

// events (without `at`) from a parsed file
function eventsFrom(parsed, { office, uf, minEventPct = 0.03, isPresident = false, winsOnly = false }) {
  const evs = [];
  for (const c of parsed.candidates) {
    let kind = null;
    if (c.side === 'direita' && c.elected) kind = 'win';
    else if (c.side === 'esquerda' && /n[ãa]o eleit/i.test(c.st) && c.pct >= minEventPct) kind = 'loss';
    if (isPresident && kind === 'loss' && /2[º°o]?\s*turno/i.test(c.st)) kind = null;
    if (winsOnly && kind === 'loss') kind = null;   // deputies: hundreds of losers, announce only right-wing seats won
    if (!kind) continue;
    const U = String(uf).toUpperCase();
    evs.push({ id: `${office}-${U}-${c.number}-${kind}`, kind, name: c.name, office, uf: U, party: c.party, pct: c.pct });
  }
  return evs;
}

function cycleFromConfig(json, electionCode) {
  // ele-c.json lists several pleitos (pl[]), e.g. 2024 municipal first: pick the one containing our election code.
  if (electionCode != null && isObj(json) && Array.isArray(json.pl)) {
    const want = String(Number(electionCode));
    const hit = json.pl.find(p => isObj(p) && Array.isArray(p.e) && p.e.some(e => isObj(e) && String(Number(e.cd)) === want));
    if (hit && typeof hit.c === 'string' && hit.c) return hit.c;
  }
  if (isObj(json) && typeof json.c === 'string' && json.c) return json.c;
  let found = null;
  const walk = n => {
    if (found) return;
    if (typeof n === 'string' && /^ele\d{4}$/.test(n)) { found = n; return; }
    if (n && typeof n === 'object') for (const v of Object.values(n)) walk(v);
  };
  walk(json);
  return found;
}

// ---------- poller ----------
class HttpError extends Error { constructor(status, url) { super(`HTTP ${status} ${url}`); this.status = status; } }
// 429 = rate limited; 403 is what a CDN usually answers once the IP is blocked. Both: stop and wait >= 10 min.
const isBlocked = e => e && (e.status === 429 || e.status === 403);
const MAX_CONSECUTIVE_FAILURES = 4; // 5xx/network/timeouts in a row -> stop the cycle instead of hammering

function emptyStates() { const s = {}; for (const uf of UFS) s[uf] = { pctSections: 0, votesLeft: 0, votesRight: 0 }; return s; }

function createPoller({ config, parties, fetchImpl = fetch, log = () => {}, now = Date.now, sleep }) {
  const tse = { ...config.tse };
  if (process.env.TSE_BASE) tse.base = process.env.TSE_BASE.replace(/\/$/, '');
  const P = indexParties(parties);
  const spacing = tse.requestSpacingMs ?? 150;
  const doSleep = sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const cache = new Map();     // url -> { etag, lastModified, json }
  const parsedCache = new Map(); // key -> parsed
  const seen = new Map();      // id -> event
  let cycle = tse.cycle || null;
  let lastReqAt = 0;
  let rawDir = null;

  const data = { national: { pctSections: 0, votesLeft: 0, votesRight: 0 }, states: emptyStates(), races: {}, events: [],
    source: { ok: true, error: null, lastSuccessAt: 0 }, refreshedAt: 0 };

  async function get(url) {
    const wait = lastReqAt + spacing - now();
    if (wait > 0) await doSleep(wait);
    lastReqAt = now();
    const c = cache.get(url);
    const headers = { 'accept': 'application/json' };
    if (c && c.etag) headers['if-none-match'] = c.etag;
    if (c && c.lastModified) headers['if-modified-since'] = c.lastModified;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), tse.timeoutMs || 15000);
    let res, text;
    try {   // the timeout also covers reading the body (a stalled body must not hang the cycle forever)
      res = await fetchImpl(url, { headers, signal: ctl.signal });
      if (res.status === 304 && c) { lastReqAt = now(); return { json: c.json, changed: false }; }
      if (!res.ok) { try { await res.body?.cancel(); } catch {} throw new HttpError(res.status, url); }
      text = await res.text();
    } finally { clearTimeout(t); }
    lastReqAt = now();
    const json = JSON.parse(text);
    cache.set(url, { etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified'), json });
    if (rawDir) { try { fs.writeFileSync(path.join(rawDir, path.basename(new URL(url).pathname)), text); } catch (e) { log('saveRaw: ' + e.message); } }
    return { json, changed: true };
  }

  async function resolveCycle() {
    if (cycle) return cycle;
    const url = configUrl(tse);
    try {
      const { json } = await get(url);
      cycle = cycleFromConfig(json, tse.elections && tse.elections.federal) || tse.fallbackCycle || 'ele2026';
    } catch (e) {
      if (isBlocked(e)) throw e;
      log(`config ${url} falhou (${e.message}); usando ${tse.fallbackCycle || 'ele2026'}`);
      if (e.status === 404 || e instanceof SyntaxError) cycle = tse.fallbackCycle || 'ele2026';
      else return tse.fallbackCycle || 'ele2026';
    }
    return cycle;
  }

  function jobs(cyc) {
    const fed = tse.elections.federal, est = tse.elections.estadual;
    const list = [{ key: 'br-1', uf: 'BR', cargo: 1, ele: fed, national: true }];
    for (const uf of UFS) list.push({ key: `${uf}-1`, uf, cargo: 1, ele: fed });
    for (const uf of UFS) list.push({ key: `${uf}-3`, uf, cargo: 3, ele: est });
    for (const uf of UFS) list.push({ key: `${uf}-5`, uf, cargo: 5, ele: est });
    for (const uf of UFS) list.push({ key: `${uf}-6`, uf, cargo: 6, ele: est });
    for (const uf of UFS) list.push({ key: `${uf}-dep`, uf, cargo: depEstadualCargo(uf), ele: est });
    for (const j of list) j.url = resultUrl(tse, { cycle: cyc, ele: j.ele, uf: j.uf, cargo: j.cargo });
    return list;
  }

  // Runs one poll cycle. Returns { ok, error }. Never throws.
  async function runCycle() {
    let errors = [], seriousErrors = 0;
    try {
      if (tse.saveRawDir) {
        rawDir = path.join(tse.saveRawDir, new Date(now()).toISOString().replace(/[:.]/g, '-'));
        fs.mkdirSync(rawDir, { recursive: true });
      }
      const cyc = await resolveCycle();
      const list = jobs(cyc);
      let streak = 0;
      for (const j of list) {
        try {
          const { json, changed } = await get(j.url);
          if (changed || !parsedCache.has(j.key)) parsedCache.set(j.key, parseResult(json, P, j.uf));
          streak = 0;
        } catch (e) {
          if (j.national) throw e;                 // national first: abort the cycle on any failure (esp. 404)
          if (isBlocked(e)) throw e;               // rate limited / blocked: stop now
          errors.push(e.message);                  // 404: logged, never retried within this cycle
          if (e.status !== 404) {                  // 5xx / network / bad JSON -> back off next cycle
            seriousErrors++;
            if (++streak >= MAX_CONSECUTIVE_FAILURES) { log('muitas falhas seguidas; ciclo interrompido'); break; }
          }
        }
      }
      rebuild();
    } catch (e) {
      errors.unshift(e.message);
      try { rebuild(); } catch {}   // keep whatever was fetched before the abort (e.g. files before a 429)
      data.source = { ...data.source, ok: false, error: errors.slice(0, 3).join('; ') };
      log('ciclo abortado: ' + e.message);
      return { ok: false, error: data.source.error, aborted: true, backoff: true, blocked: isBlocked(e) };
    } finally { rawDir = null; }
    const t = now();
    data.refreshedAt = t;
    data.source = { ok: errors.length === 0, error: errors.length ? `${errors.length} arquivo(s) com erro: ${errors.slice(0, 3).join('; ')}` : null, lastSuccessAt: t };
    if (errors.length) log(data.source.error);
    return { ok: errors.length === 0, error: data.source.error, backoff: seriousErrors > 0 };
  }

  function rebuild() {
    const t = now();
    const br = parsedCache.get('br-1');
    if (br) data.national = { pctSections: br.pctSections, votesLeft: br.votesLeft, votesRight: br.votesRight };
    const st = emptyStates();
    for (const uf of UFS) { const p = parsedCache.get(`${uf}-1`); if (p) st[uf] = { pctSections: p.pctSections, votesLeft: p.votesLeft, votesRight: p.votesRight }; }
    data.states = st;
    const fresh = [];
    const consider = (key, office, uf, isPresident, winsOnly) => {
      const p = parsedCache.get(key); if (!p) return;
      for (const ev of eventsFrom(p, { office, uf, minEventPct: tse.minEventPct ?? 0.03, isPresident, winsOnly })) {
        if (seen.has(ev.id)) continue;
        const e = { ...ev, at: t }; seen.set(ev.id, e); fresh.push(e);
      }
    };
    consider('br-1', OFFICES[1], 'BR', true);
    for (const uf of UFS) { consider(`${uf}-3`, OFFICES[3], uf); consider(`${uf}-5`, OFFICES[5], uf); }
    // deputies last, so in a burst the governor/senator results stay at the top of the capped list
    for (const uf of UFS) { consider(`${uf}-6`, OFFICES[6], uf, false, true); consider(`${uf}-dep`, OFFICES[depEstadualCargo(uf)], uf, false, true); }
    data.events = [...seen.values()].sort((a, b) => b.at - a.at).slice(0, MAX_EVENTS);
    const races = {};
    for (const uf of UFS) {
      races[uf] = [[`${uf}-3`, OFFICES[3]], [`${uf}-5`, OFFICES[5]], [`${uf}-6`, OFFICES[6]], [`${uf}-dep`, OFFICES[depEstadualCargo(uf)]]]
        .filter(([k]) => parsedCache.has(k)).map(([k, office]) => raceSummary(parsedCache.get(k), office));
    }
    data.races = races;
  }

  // one-shot check used by --probe
  async function probe() {
    const cUrl = configUrl(tse);
    const out = { configUrl: cUrl };
    const cyc = await resolveCycle();
    out.cycle = cyc;
    const cfgCached = cache.get(cUrl);
    if (cfgCached) {   // elections listed in ele-c.json, to check 6257/6259 against config.json
      const els = [];
      const walk = n => { if (Array.isArray(n)) n.forEach(walk); else if (isObj(n)) { if (n.cd != null && n.nm != null) els.push(`${n.cd} ${n.nm}`); Object.values(n).forEach(v => v && typeof v === 'object' && walk(v)); } };
      walk(cfgCached.json);
      out.electionsInConfig = els.slice(0, 20);
      out.expected = tse.elections;
    }
    const url = resultUrl(tse, { cycle: cyc, ele: tse.elections.federal, uf: 'br', cargo: 1 });
    out.nationalUrl = url;
    const exampleGov = resultUrl(tse, { cycle: cyc, ele: tse.elections.estadual, uf: 'sp', cargo: 3 });
    out.exampleGovernorUrl = exampleGov;
    const { json } = await get(url);
    const p = parseResult(json, P, 'BR');
    out.topLevelKeys = isObj(json) ? Object.keys(json) : typeof json;
    out.pctSections = p.pctSections;
    out.votesLeft = p.votesLeft; out.votesRight = p.votesRight;
    out.candidates = p.candidates.map(c => ({ n: c.number, nome: c.name, partido: c.party, lado: c.side, votos: c.votes, pct: c.pct, st: c.st, eleito: c.elected, valido: c.valid }));
    return out;
  }

  return { runCycle, probe, data, get cycle() { return cycle; } };
}

module.exports = { UFS, OFFICES, depEstadualCargo, normKey, fillTemplate, resultUrl, configUrl, parseIntLoose, parsePct, indexParties, acronymFromCc,
  sideOf, extractCandidates, sectionProgress, parseResult, eventsFrom, raceSummary, cycleFromConfig, createPoller, emptyStates };
