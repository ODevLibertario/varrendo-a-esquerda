var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// lib/tse.js
var require_tse = __commonJS({
  "lib/tse.js"(exports, module) {
    "use strict";
    var UFS2 = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"];
    var OFFICES2 = { 1: "Presidente", 3: "Governador(a)", 5: "Senador(a)", 6: "Dep. Federal", 7: "Dep. Estadual", 8: "Dep. Distrital" };
    var depEstadualCargo2 = (uf) => uf === "DF" ? 8 : 7;
    var MAX_EVENTS = 1e3;
    var normKey = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    var pad = (n, w) => String(n).padStart(w, "0");
    function fillTemplate(tpl, vars) {
      return tpl.replace(/\{(\w+)\}/g, (m, k) => vars[k] !== void 0 && vars[k] !== null ? String(vars[k]) : m);
    }
    function resultUrl2(tse2, { cycle, ele, uf, cargo }) {
      const u = String(uf).toLowerCase();
      return fillTemplate(tse2.resultUrl, { base: tse2.base, env: tse2.env, cycle, ele, uf: u, cargo4: pad(cargo, 4), ele6: pad(ele, 6), cargo });
    }
    var configUrl = (tse2) => fillTemplate(tse2.configUrl, { base: tse2.base, env: tse2.env });
    function parseIntLoose(v) {
      if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : 0;
      if (v == null) return 0;
      const d = String(v).replace(/[^0-9-]/g, "");
      const n = parseInt(d, 10);
      return Number.isFinite(n) ? n : 0;
    }
    function parsePct(v) {
      if (v == null || v === "") return null;
      let s = String(v).trim().replace("%", "");
      if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
      const n = parseFloat(s);
      return Number.isFinite(n) ? Math.max(0, Math.min(1, Math.round(n * 1e4) / 1e6)) : null;
    }
    var SIDES = /* @__PURE__ */ new Set(["direita", "esquerda"]);
    function normSide(v, fallback) {
      const s = String(v ?? "").trim().toLowerCase();
      return SIDES.has(s) ? s : fallback;
    }
    function indexParties2(cfg) {
      const byAcr = /* @__PURE__ */ new Map(), byNum = /* @__PURE__ */ new Map();
      const padrao = normSide(cfg && cfg.padrao, "esquerda");
      for (const p of cfg && cfg.parties || []) {
        const entry = { sigla: p.sigla, numero: p.numero ?? null, lado: normSide(p.lado, padrao) };
        for (const name of [p.sigla, ...p.aliases || []]) if (name) byAcr.set(normKey(name), entry);
        if (p.numero != null) byNum.set(Number(p.numero), entry);
      }
      const overrides = {};
      for (const [k, v] of Object.entries(cfg && cfg.overrides || {})) overrides[k.toLowerCase()] = normSide(v, padrao);
      return { byAcr, byNum, overrides, padrao };
    }
    function acronymFromCc(cc) {
      if (!cc) return null;
      const first = String(cc).split(/\s+-\s+|\/|\(|\s-|-\s/)[0].trim();
      return first || null;
    }
    var numPrefix = (n) => {
      const d = String(n ?? "").replace(/\D/g, "");
      return d.length >= 2 ? Number(d.slice(0, 2)) : null;
    };
    function sideOf(c, uf, P) {
      const ov = P.overrides[`${String(uf).toLowerCase()}:${c.number}`];
      if (ov) return ov;
      const a = c.party && P.byAcr.get(normKey(c.party));
      if (a) return a.lado;
      const b = P.byNum.get(numPrefix(c.number));
      if (b) return b.lado;
      return P.padrao || "esquerda";
    }
    var isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
    function looksCandidate(o) {
      if (!isObj(o) || o.vap === void 0) return false;
      if (o.nm === void 0 && o.nmu === void 0 && o.n === void 0) return false;
      for (const v of Object.values(o)) if (Array.isArray(v) && v.some((x) => isObj(x) && x.vap !== void 0)) return false;
      return true;
    }
    var partyField = (o) => o.sg ?? o.sgp ?? (typeof o.par === "string" ? o.par : void 0);
    var CONTAINER_KEYS = ["cand", "par", "agr", "abr", "carper"];
    function looksCandidateInfo(o) {
      if (!isObj(o) || o.vap !== void 0 || o.n === void 0) return false;
      if (o.nm === void 0 && o.nmu === void 0) return false;
      if (o.sg !== void 0 || CONTAINER_KEYS.some((k) => o[k] !== void 0)) return false;
      return true;
    }
    var candKey = (o) => o.n != null && String(o.n).trim() !== "" ? "n:" + String(o.n).trim() : o.sqcand != null ? "s:" + o.sqcand : null;
    function extractCandidates(json) {
      const byKey = /* @__PURE__ */ new Map(), order = [];
      const info = /* @__PURE__ */ new Map();
      const walk = (node, ctxParty) => {
        if (Array.isArray(node)) {
          for (const x of node) walk(x, ctxParty);
          return;
        }
        if (!isObj(node)) return;
        if (looksCandidate(node) || looksCandidateInfo(node)) {
          const own = partyField(node);
          const rec = {
            hasVotes: node.vap !== void 0,
            name: String(node.nmu || node.nm || "").trim(),
            number: node.n != null ? String(node.n).trim() : "",
            votes: parseIntLoose(node.vap),
            pct: parsePct(node.pvap),
            e: node.e,
            st: node.st != null ? String(node.st) : "",
            dvt: node.dvt != null ? String(node.dvt) : "",
            party: own ? String(own) : ctxParty || acronymFromCc(node.cc),
            rawParty: !!own || !!ctxParty
          };
          const key = candKey(node) || "x:" + order.length + ":" + rec.name;
          if (!rec.hasVotes) {
            if (!info.has(key)) info.set(key, rec);
            return;
          }
          const prev = byKey.get(key);
          if (!prev) {
            byKey.set(key, rec);
            order.push(key);
            return;
          }
          const [hi, lo] = rec.votes > prev.votes ? [rec, prev] : [prev, rec];
          byKey.set(key, {
            ...hi,
            name: hi.name || lo.name,
            st: hi.st || lo.st,
            e: hi.e ?? lo.e,
            dvt: hi.dvt || lo.dvt,
            pct: hi.pct ?? lo.pct,
            ...hi.party && (hi.rawParty || !lo.rawParty) ? {} : { party: lo.party || hi.party, rawParty: lo.rawParty }
          });
          return;
        }
        const p = partyField(node);
        const ctx = p ? String(p) : ctxParty;
        for (const v of Object.values(node)) if (v && typeof v === "object") walk(v, ctx);
      };
      walk(json, null);
      return order.map((k) => {
        const r = byKey.get(k), i = info.get(k);
        if (i) {
          if (!r.name) r.name = i.name;
          if (i.party && (!r.party || i.rawParty && !r.rawParty)) {
            r.party = i.party;
            r.rawParty = i.rawParty;
          }
          if (!r.st) r.st = i.st;
          if (r.e == null) r.e = i.e;
          if (!r.dvt) r.dvt = i.dvt;
        }
        const e = r.e;
        return {
          name: r.name || (r.number ? `Candidato ${r.number}` : "Candidato"),
          number: r.number,
          votes: r.votes,
          pct: r.pct,
          elected: e === "s" || e === "S" || e === true || /^eleit[oa]/i.test(r.st) && !/n[ãa]o eleit/i.test(r.st),
          st: r.st,
          valid: !/anulad|nulo/i.test(r.dvt),
          party: r.party,
          rawParty: r.rawParty
        };
      });
    }
    function sectionProgress(json) {
      for (const k of ["pst", "psa", "pesi"]) {
        let level = [json];
        for (let depth = 0; depth < 5 && level.length; depth++) {
          const next = [];
          for (const o of level) {
            if (Array.isArray(o)) {
              if (isObj(o[0])) next.push(o[0]);
              continue;
            }
            if (!isObj(o)) continue;
            if (o[k] != null && typeof o[k] !== "object") {
              const p = parsePct(o[k]);
              if (p != null) return p;
            }
            if (o.vap !== void 0) continue;
            for (const [kk, v] of Object.entries(o)) if (v && typeof v === "object" && kk !== "cand") next.push(v);
          }
          level = next;
        }
      }
      return 0;
    }
    function parseResult2(json, P, uf) {
      const cands = extractCandidates(json).map((c) => {
        if (c.party && !P.byAcr.has(normKey(c.party))) {
          const b = P.byNum.get(numPrefix(c.number));
          if (b && !c.rawParty) c.party = b.sigla;
        }
        if (!c.party) {
          const b = P.byNum.get(numPrefix(c.number));
          c.party = b ? b.sigla : "";
        }
        delete c.rawParty;
        c.side = sideOf(c, uf, P);
        return c;
      });
      const totalValid = cands.reduce((a, c) => a + (c.valid ? c.votes : 0), 0);
      for (const c of cands) if (c.pct == null) c.pct = totalValid > 0 && c.valid ? c.votes / totalValid : 0;
      let votesLeft = 0, votesRight = 0;
      for (const c of cands) {
        if (!c.valid) continue;
        if (c.side === "esquerda") votesLeft += c.votes;
        else if (c.side === "direita") votesRight += c.votes;
      }
      return { pctSections: sectionProgress(json), votesLeft, votesRight, candidates: cands };
    }
    function raceSummary2(parsed, office) {
      const cands = parsed.candidates.filter((c) => c.valid !== false);
      const top = cands.slice().sort((a, b) => b.votes - a.votes)[0];
      const runoff = cands.some((c) => /2[º°o]?\s*turno/i.test(c.st || ""));
      const decided = cands.some((c) => c.elected) || runoff;
      const leader = top && top.votes > 0 ? { name: top.name, party: top.party, side: top.side, pct: top.pct } : null;
      return { office, pctSections: parsed.pctSections, decided, status: runoff ? "2\xBA turno" : decided ? "decidido" : "pendente", leader };
    }
    function eventsFrom2(parsed, { office, uf, minEventPct = 0.03, isPresident = false, winsOnly = false }) {
      const evs = [];
      for (const c of parsed.candidates) {
        let kind = null;
        if (c.side === "direita" && c.elected) kind = "win";
        else if (c.side === "esquerda" && /n[ãa]o eleit/i.test(c.st) && c.pct >= minEventPct) kind = "loss";
        if (isPresident && kind === "loss" && /2[º°o]?\s*turno/i.test(c.st)) kind = null;
        if (winsOnly && kind === "loss") kind = null;
        if (!kind) continue;
        const U = String(uf).toUpperCase();
        evs.push({ id: `${office}-${U}-${c.number}-${kind}`, kind, name: c.name, office, uf: U, party: c.party, pct: c.pct });
      }
      return evs;
    }
    function cycleFromConfig(json, electionCode) {
      if (electionCode != null && isObj(json) && Array.isArray(json.pl)) {
        const want = String(Number(electionCode));
        const hit = json.pl.find((p) => isObj(p) && Array.isArray(p.e) && p.e.some((e) => isObj(e) && String(Number(e.cd)) === want));
        if (hit && typeof hit.c === "string" && hit.c) return hit.c;
      }
      if (isObj(json) && typeof json.c === "string" && json.c) return json.c;
      let found = null;
      const walk = (n) => {
        if (found) return;
        if (typeof n === "string" && /^ele\d{4}$/.test(n)) {
          found = n;
          return;
        }
        if (n && typeof n === "object") for (const v of Object.values(n)) walk(v);
      };
      walk(json);
      return found;
    }
    var HttpError = class extends Error {
      constructor(status, url) {
        super(`HTTP ${status} ${url}`);
        this.status = status;
      }
    };
    var isBlocked = (e) => e && (e.status === 429 || e.status === 403);
    var MAX_CONSECUTIVE_FAILURES = 4;
    function emptyStates3() {
      const s = {};
      for (const uf of UFS2) s[uf] = { pctSections: 0, votesLeft: 0, votesRight: 0 };
      return s;
    }
    function createPoller({ config, parties, fetchImpl = fetch, log = () => {
    }, now = Date.now, sleep, base, saveRaw }) {
      const tse2 = { ...config.tse };
      const envBase = typeof process !== "undefined" && process.env ? process.env.TSE_BASE : null;
      if (base || envBase) tse2.base = String(base || envBase).replace(/\/$/, "");
      const P = indexParties2(parties);
      const spacing = tse2.requestSpacingMs ?? 150;
      const doSleep = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
      const cache = /* @__PURE__ */ new Map();
      const parsedCache = /* @__PURE__ */ new Map();
      const seen = /* @__PURE__ */ new Map();
      let cycle = tse2.cycle || null;
      let lastReqAt = 0;
      const data = {
        national: { pctSections: 0, votesLeft: 0, votesRight: 0 },
        states: emptyStates3(),
        races: {},
        events: [],
        source: { ok: true, error: null, lastSuccessAt: 0 },
        refreshedAt: 0
      };
      async function get(url) {
        const wait = lastReqAt + spacing - now();
        if (wait > 0) await doSleep(wait);
        lastReqAt = now();
        const c = cache.get(url);
        const headers = { "accept": "application/json" };
        if (c && c.etag) headers["if-none-match"] = c.etag;
        if (c && c.lastModified) headers["if-modified-since"] = c.lastModified;
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), tse2.timeoutMs || 15e3);
        let res, text;
        try {
          res = await fetchImpl(url, { headers, signal: ctl.signal });
          if (res.status === 304 && c) {
            lastReqAt = now();
            return { json: c.json, changed: false };
          }
          if (!res.ok) {
            try {
              await res.body?.cancel();
            } catch {
            }
            throw new HttpError(res.status, url);
          }
          text = await res.text();
        } finally {
          clearTimeout(t);
        }
        lastReqAt = now();
        const json = JSON.parse(text);
        cache.set(url, { etag: res.headers.get("etag"), lastModified: res.headers.get("last-modified"), json });
        if (saveRaw && tse2.saveRawDir) {
          try {
            saveRaw(tse2.saveRawDir, url, text, now());
          } catch (e) {
            log("saveRaw: " + e.message);
          }
        }
        return { json, changed: true };
      }
      async function resolveCycle() {
        if (cycle) return cycle;
        const url = configUrl(tse2);
        try {
          const { json } = await get(url);
          cycle = cycleFromConfig(json, tse2.elections && tse2.elections.federal) || tse2.fallbackCycle || "ele2026";
        } catch (e) {
          if (isBlocked(e)) throw e;
          log(`config ${url} falhou (${e.message}); usando ${tse2.fallbackCycle || "ele2026"}`);
          if (e.status === 404 || e instanceof SyntaxError) cycle = tse2.fallbackCycle || "ele2026";
          else return tse2.fallbackCycle || "ele2026";
        }
        return cycle;
      }
      function jobs(cyc) {
        const fed = tse2.elections.federal, est = tse2.elections.estadual;
        const list = [{ key: "br-1", uf: "BR", cargo: 1, ele: fed, national: true }];
        for (const uf of UFS2) list.push({ key: `${uf}-1`, uf, cargo: 1, ele: fed });
        for (const uf of UFS2) list.push({ key: `${uf}-3`, uf, cargo: 3, ele: est });
        for (const uf of UFS2) list.push({ key: `${uf}-5`, uf, cargo: 5, ele: est });
        for (const uf of UFS2) list.push({ key: `${uf}-6`, uf, cargo: 6, ele: est });
        for (const uf of UFS2) list.push({ key: `${uf}-dep`, uf, cargo: depEstadualCargo2(uf), ele: est });
        for (const j of list) j.url = resultUrl2(tse2, { cycle: cyc, ele: j.ele, uf: j.uf, cargo: j.cargo });
        return list;
      }
      async function runCycle() {
        let errors = [], seriousErrors = 0;
        try {
          const cyc = await resolveCycle();
          const list = jobs(cyc);
          let streak = 0;
          for (const j of list) {
            try {
              const { json, changed } = await get(j.url);
              if (changed || !parsedCache.has(j.key)) parsedCache.set(j.key, parseResult2(json, P, j.uf));
              streak = 0;
            } catch (e) {
              if (j.national) throw e;
              if (isBlocked(e)) throw e;
              errors.push(e.message);
              if (e.status !== 404) {
                seriousErrors++;
                if (++streak >= MAX_CONSECUTIVE_FAILURES) {
                  log("muitas falhas seguidas; ciclo interrompido");
                  break;
                }
              }
            }
          }
          rebuild();
        } catch (e) {
          errors.unshift(e.message);
          try {
            rebuild();
          } catch {
          }
          data.source = { ...data.source, ok: false, error: errors.slice(0, 3).join("; ") };
          log("ciclo abortado: " + e.message);
          return { ok: false, error: data.source.error, aborted: true, backoff: true, blocked: isBlocked(e) };
        }
        const t = now();
        data.refreshedAt = t;
        data.source = { ok: errors.length === 0, error: errors.length ? `${errors.length} arquivo(s) com erro: ${errors.slice(0, 3).join("; ")}` : null, lastSuccessAt: t };
        if (errors.length) log(data.source.error);
        return { ok: errors.length === 0, error: data.source.error, backoff: seriousErrors > 0 };
      }
      function rebuild() {
        const t = now();
        const br = parsedCache.get("br-1");
        if (br) data.national = { pctSections: br.pctSections, votesLeft: br.votesLeft, votesRight: br.votesRight };
        const st = emptyStates3();
        for (const uf of UFS2) {
          const p = parsedCache.get(`${uf}-1`);
          if (p) st[uf] = { pctSections: p.pctSections, votesLeft: p.votesLeft, votesRight: p.votesRight };
        }
        data.states = st;
        const fresh = [];
        const consider = (key, office, uf, isPresident, winsOnly) => {
          const p = parsedCache.get(key);
          if (!p) return;
          for (const ev of eventsFrom2(p, { office, uf, minEventPct: tse2.minEventPct ?? 0.03, isPresident, winsOnly })) {
            if (seen.has(ev.id)) continue;
            const e = { ...ev, at: t };
            seen.set(ev.id, e);
            fresh.push(e);
          }
        };
        consider("br-1", OFFICES2[1], "BR", true);
        for (const uf of UFS2) {
          consider(`${uf}-3`, OFFICES2[3], uf);
          consider(`${uf}-5`, OFFICES2[5], uf);
        }
        for (const uf of UFS2) {
          consider(`${uf}-6`, OFFICES2[6], uf, false, true);
          consider(`${uf}-dep`, OFFICES2[depEstadualCargo2(uf)], uf, false, true);
        }
        data.events = [...seen.values()].sort((a, b) => b.at - a.at).slice(0, MAX_EVENTS);
        const races = {};
        for (const uf of UFS2) {
          races[uf] = [[`${uf}-3`, OFFICES2[3]], [`${uf}-5`, OFFICES2[5]], [`${uf}-6`, OFFICES2[6]], [`${uf}-dep`, OFFICES2[depEstadualCargo2(uf)]]].filter(([k]) => parsedCache.has(k)).map(([k, office]) => raceSummary2(parsedCache.get(k), office));
        }
        data.races = races;
      }
      async function probe() {
        const cUrl = configUrl(tse2);
        const out = { configUrl: cUrl };
        const cyc = await resolveCycle();
        out.cycle = cyc;
        const cfgCached = cache.get(cUrl);
        if (cfgCached) {
          const els = [];
          const walk = (n) => {
            if (Array.isArray(n)) n.forEach(walk);
            else if (isObj(n)) {
              if (n.cd != null && n.nm != null) els.push(`${n.cd} ${n.nm}`);
              Object.values(n).forEach((v) => v && typeof v === "object" && walk(v));
            }
          };
          walk(cfgCached.json);
          out.electionsInConfig = els.slice(0, 20);
          out.expected = tse2.elections;
        }
        const url = resultUrl2(tse2, { cycle: cyc, ele: tse2.elections.federal, uf: "br", cargo: 1 });
        out.nationalUrl = url;
        const exampleGov = resultUrl2(tse2, { cycle: cyc, ele: tse2.elections.estadual, uf: "sp", cargo: 3 });
        out.exampleGovernorUrl = exampleGov;
        const { json } = await get(url);
        const p = parseResult2(json, P, "BR");
        out.topLevelKeys = isObj(json) ? Object.keys(json) : typeof json;
        out.pctSections = p.pctSections;
        out.votesLeft = p.votesLeft;
        out.votesRight = p.votesRight;
        out.candidates = p.candidates.map((c) => ({ n: c.number, nome: c.name, partido: c.party, lado: c.side, votos: c.votes, pct: c.pct, st: c.st, eleito: c.elected, valido: c.valid }));
        return out;
      }
      return { runCycle, probe, data, get cycle() {
        return cycle;
      } };
    }
    module.exports = {
      UFS: UFS2,
      OFFICES: OFFICES2,
      depEstadualCargo: depEstadualCargo2,
      normKey,
      fillTemplate,
      resultUrl: resultUrl2,
      configUrl,
      parseIntLoose,
      parsePct,
      indexParties: indexParties2,
      acronymFromCc,
      sideOf,
      extractCandidates,
      sectionProgress,
      parseResult: parseResult2,
      eventsFrom: eventsFrom2,
      raceSummary: raceSummary2,
      cycleFromConfig,
      createPoller,
      emptyStates: emptyStates3
    };
  }
});

// lib/fake.js
var require_fake = __commonJS({
  "lib/fake.js"(exports, module) {
    "use strict";
    var { UFS: UFS2, emptyStates: emptyStates3, indexParties: indexParties2, normKey } = require_tse();
    var ELECTORATE = { SP: 34.4, MG: 16.3, RJ: 12.8, BA: 11.3, RS: 8.6, PR: 8.5, PE: 7, CE: 6.8, PA: 6.1, SC: 5.5, MA: 4.9, GO: 4.9, PB: 3, ES: 2.9, AM: 2.7, RN: 2.6, PI: 2.6, MT: 2.5, AL: 2.3, DF: 2.2, MS: 2, SE: 1.7, RO: 1.2, TO: 1.1, AC: 0.6, AP: 0.55, RR: 0.37 };
    var TARGET_RIGHT = { SP: 0.56, MG: 0.51, RJ: 0.57, BA: 0.33, RS: 0.55, PR: 0.62, PE: 0.36, CE: 0.35, PA: 0.47, SC: 0.68, MA: 0.32, GO: 0.61, PB: 0.38, ES: 0.58, AM: 0.52, RN: 0.4, PI: 0.29, MT: 0.66, AL: 0.44, DF: 0.59, MS: 0.6, SE: 0.39, RO: 0.69, TO: 0.53, AC: 0.64, AP: 0.5, RR: 0.72 };
    var SPEED = { SP: 0.13, MG: 0.12, RJ: 0.11, BA: 0.12, RS: 0.15, PR: 0.17, PE: 0.13, CE: 0.14, PA: 0.07, SC: 0.18, MA: 0.09, GO: 0.15, PB: 0.14, ES: 0.16, AM: 0.06, RN: 0.15, PI: 0.13, MT: 0.12, AL: 0.14, DF: 0.22, MS: 0.14, SE: 0.16, RO: 0.1, TO: 0.08, AC: 0.06, AP: 0.05, RR: 0.05 };
    var FIRST = ["Ana", "Bruno", "Carla", "Diego", "Elaine", "F\xE1bio", "Gisele", "Henrique", "Irene", "Jo\xE3o", "K\xE1tia", "Leandro", "Marina", "N\xE9lson", "Ol\xEDvia", "Paulo", "Raquel", "S\xE9rgio", "T\xE2nia", "Valter", "Wagner", "Yara", "Rog\xE9rio", "Denise", "Murilo", "Patr\xEDcia", "Ot\xE1vio", "Luciana"];
    var LAST = ["Andrade", "Barreto", "Cavalcanti", "Duarte", "Esteves", "Figueira", "Guimar\xE3es", "Holanda", "Lacerda", "Macedo", "Nogueira", "Pacheco", "Queiroz", "Rezende", "Siqueira", "Tavares", "Valadares", "Xavier", "Brand\xE3o", "Coutinho", "Peixoto", "Moraes", "Amaral", "Teixeira"];
    var OFFICES2 = ["Governador(a)", "Senador(a)", "Senador(a)", "Dep. Federal", "Dep. Federal", "Dep. Estadual"];
    function createFake2(parties, { now = Date.now, seed = 20261004, idPrefix } = {}) {
      const P = indexParties2(parties);
      const list = (parties && parties.parties || []).filter((p) => p.sigla && p.ativo !== false);
      const ladoOf = (p) => P.byAcr.get(normKey(p.sigla)).lado;
      const PARTY_RIGHT = list.filter((p) => ladoOf(p) === "direita").map((p) => p.sigla);
      const PARTY_LEFT = list.filter((p) => ladoOf(p) === "esquerda").map((p) => p.sigla);
      if (!PARTY_RIGHT.length) PARTY_RIGHT.push("PL");
      if (!PARTY_LEFT.length) PARTY_LEFT.push("PT");
      const rnd = () => (seed = seed * 1664525 + 1013904223 >>> 0) / 4294967296;
      const pick = (a) => a[Math.floor(rnd() * a.length)];
      let state, used, events, counter, doneOnce, leaders;
      const RACES = [["Governador(a)", 0.85], ["Senador(a)", 0.85], ["Dep. Federal", 1], ["Dep. Estadual", 1]];
      const boot = idPrefix || Date.now().toString(36);
      function advance(scale = 1) {
        for (const uf of UFS2) {
          const s = state[uf];
          if (s.prog >= 1) continue;
          s.prog = Math.min(1, s.prog + SPEED[uf] * scale * (0.6 + rnd() * 0.8));
          const noise = (rnd() - 0.5) * 0.14 * (1 - s.prog);
          s.right = Math.max(0.05, Math.min(0.95, TARGET_RIGHT[uf] + noise));
        }
      }
      function makeEvent(minProg, at) {
        const ready = UFS2.filter((uf2) => state[uf2].prog > minProg);
        if (!ready.length) return null;
        const uf = pick(ready);
        const win = rnd() < 0.55;
        let name, tries = 0;
        do {
          name = pick(FIRST) + " " + pick(LAST);
        } while (used.has(name) && ++tries < 50);
        used.add(name);
        const pct = win ? 0.5 + rnd() * 0.22 : 0.18 + rnd() * 0.28;
        return {
          id: `fake-${boot}-${++counter}-${uf}`,
          kind: win ? "win" : "loss",
          name,
          office: pick(OFFICES2),
          uf,
          party: win ? pick(PARTY_RIGHT) : pick(PARTY_LEFT),
          pct,
          at
        };
      }
      function reset() {
        state = {};
        used = /* @__PURE__ */ new Set();
        events = [];
        counter = counter || 0;
        doneOnce = false;
        for (const uf of UFS2) state[uf] = { prog: 0, right: 0.5 };
        leaders = {};
        for (const uf of UFS2) leaders[uf] = RACES.map(() => [
          { name: pick(FIRST) + " " + pick(LAST), party: pick(PARTY_RIGHT), side: "direita" },
          { name: pick(FIRST) + " " + pick(LAST), party: pick(PARTY_LEFT), side: "esquerda" }
        ]);
      }
      function init() {
        reset();
        advance(1.5);
        const t = now();
        for (let i = 4; i >= 0; i--) {
          const e = makeEvent(0, t - (i + 1) * 9e4);
          if (e) events.unshift(e);
        }
      }
      function step() {
        const allDone = UFS2.every((uf) => state[uf].prog >= 1);
        if (allDone) {
          if (doneOnce) {
            reset();
            return;
          }
          doneOnce = true;
          return;
        }
        advance(1);
        if (UFS2.some((uf) => state[uf].prog > 0.4)) {
          const n = 1 + (rnd() < 0.5 ? 1 : 0);
          for (let i = 0; i < n; i++) {
            const e = makeEvent(0.4, now() + i);
            if (e) events.unshift(e);
          }
        }
        events = events.slice(0, 1e3);
      }
      function parties_() {
        return { right: PARTY_RIGHT.slice(), left: PARTY_LEFT.slice() };
      }
      function data() {
        const states = emptyStates3();
        let vL = 0, vR = 0, sec = 0, tot = 0;
        for (const uf of UFS2) {
          const s = state[uf];
          const counted = ELECTORATE[uf] * 1e6 * 0.79 * s.prog;
          const r = Math.round(counted * s.right), l = Math.round(counted * (1 - s.right));
          states[uf] = { pctSections: s.prog, votesLeft: l, votesRight: r };
          vL += l;
          vR += r;
          sec += ELECTORATE[uf] * s.prog;
          tot += ELECTORATE[uf];
        }
        const races = {};
        for (const uf of UFS2) {
          const s = state[uf];
          races[uf] = RACES.map(([office, doneAt], i) => {
            const [r, l] = leaders[uf][i], dep = office.startsWith("Dep");
            const share = dep ? 0.02 + 0.03 * (s.right >= 0.5 ? s.right : 1 - s.right) : Math.max(s.right, 1 - s.right) * 0.9;
            const decided = s.prog >= doneAt;
            return {
              office,
              pctSections: s.prog,
              decided,
              status: decided ? "decidido" : "pendente",
              leader: s.prog > 0 ? { ...s.right >= 0.5 ? r : l, pct: share } : null
            };
          });
        }
        return { national: { pctSections: sec / tot, votesLeft: vL, votesRight: vR }, states, races, events: events.slice() };
      }
      init();
      return { step, data, parties: parties_ };
    }
    module.exports = { createFake: createFake2 };
  }
});

// config.json
var config_default = {
  mode: "tse",
  port: 8090,
  intervalSec: 300,
  fakeIntervalSec: 20,
  maxBackoffSec: 600,
  eleicao: "2026",
  _eleicaoComment: "Escolhe o perfil em 'eleicoes' (sobrescreve campos de 'tse'). S\xF3 existe 2026: o TSE n\xE3o publica mais os arquivos de 2022 (todos d\xE3o 404). Vari\xE1vel de ambiente: ELEICAO.",
  tse: {
    base: "https://resultados.tse.jus.br",
    env: "oficial",
    configUrl: "{base}/{env}/comum/config/ele-c.json",
    cycle: "ele2026",
    fallbackCycle: "ele2026",
    elections: {
      federal: 6257,
      estadual: 6259
    },
    resultUrl: "{base}/{env}/{cycle}/{ele}/dados/{uf}/{uf}-c{cargo4}-e{ele6}-u.json",
    minEventPct: 0.03,
    requestSpacingMs: 150,
    timeoutMs: 15e3,
    saveRawDir: null
  },
  eleicoes: {
    "2026": {
      cycle: "ele2026",
      fallbackCycle: "ele2026",
      elections: {
        federal: 6257,
        estadual: 6259
      },
      resultUrl: "{base}/{env}/{cycle}/{ele}/dados/{uf}/{uf}-c{cargo4}-e{ele6}-u.json"
    }
  }
};

// parties.json
var parties_default = {
  _comment: `Regra do Gilson: SOMENTE os partidos marcados 'direita' contam como direita. Todo o resto (inclusive partido desconhecido ou nao encontrado) e esquerda, via 'padrao'. Nao existe mais 'centro'. Os partidos 'esquerda' abaixo estao listados so para clareza (sigla + numero ajudam a identificar o partido quando o arquivo do TSE nao traz a sigla). 'ativo': false = partido historico/extinto/incorporado: mantido na lista, mas nao usado na simulacao. 'numero': null = numero desconhecido ou nao usado (o PSC fica sem numero porque o 20 hoje e do PODE). Sigla comparada sem acentos, espacos e maiusculas (MISS\xC3O = Missao). 'aliases' sao nomes alternativos opcionais. 'overrides' forca o lado de um candidato especifico: chave '<uf>:<numero>' (uf minuscula, 'br' para Presidente), ex.: { "sp:15": "direita" }.`,
  padrao: "esquerda",
  parties: [
    { sigla: "PL", numero: 22, lado: "direita" },
    { sigla: "NOVO", numero: 30, lado: "direita" },
    { sigla: "REPUBLICANOS", numero: 10, lado: "direita", aliases: ["REPUBLICANO"] },
    { sigla: "MISS\xC3O", numero: null, lado: "direita", aliases: ["PARTIDO MISSAO"] },
    { sigla: "PRD", numero: 25, lado: "direita", aliases: ["PARTIDO RENOVACAO DEMOCRATICA"] },
    { sigla: "PRC", numero: null, lado: "direita", ativo: false, aliases: ["PARTIDO REPUBLICANO CONSERVADOR"] },
    { sigla: "PSC", numero: null, lado: "direita", ativo: false },
    { sigla: "PDS", numero: null, lado: "direita", ativo: false },
    { sigla: "PRONA", numero: null, lado: "direita", ativo: false },
    { sigla: "PRM", numero: null, lado: "direita", ativo: false },
    { sigla: "UDN", numero: null, lado: "direita", ativo: false },
    { sigla: "PT", numero: 13, lado: "esquerda" },
    { sigla: "PSOL", numero: 50, lado: "esquerda" },
    { sigla: "PCdoB", numero: 65, lado: "esquerda", aliases: ["PC do B"] },
    { sigla: "PV", numero: 43, lado: "esquerda" },
    { sigla: "REDE", numero: 18, lado: "esquerda" },
    { sigla: "PSB", numero: 40, lado: "esquerda" },
    { sigla: "PDT", numero: 12, lado: "esquerda" },
    { sigla: "SOLIDARIEDADE", numero: 77, lado: "esquerda", aliases: ["SD"] },
    { sigla: "PCO", numero: 29, lado: "esquerda" },
    { sigla: "PSTU", numero: 16, lado: "esquerda" },
    { sigla: "UP", numero: 80, lado: "esquerda" },
    { sigla: "PCB", numero: 21, lado: "esquerda" },
    { sigla: "MDB", numero: 15, lado: "esquerda" },
    { sigla: "PSD", numero: 55, lado: "esquerda" },
    { sigla: "AVANTE", numero: 70, lado: "esquerda" },
    { sigla: "PP", numero: 11, lado: "esquerda", aliases: ["PROGRESSISTAS"] },
    { sigla: "UNI\xC3O", numero: 44, lado: "esquerda", aliases: ["UNIAO BRASIL"] },
    { sigla: "PSDB", numero: 45, lado: "esquerda" },
    { sigla: "CIDADANIA", numero: 23, lado: "esquerda" },
    { sigla: "PODE", numero: 20, lado: "esquerda", aliases: ["PODEMOS"] },
    { sigla: "DC", numero: 27, lado: "esquerda" },
    { sigla: "AGIR", numero: 36, lado: "esquerda" },
    { sigla: "MOBILIZA", numero: 33, lado: "esquerda" },
    { sigla: "PMB", numero: 35, lado: "esquerda" },
    { sigla: "PRTB", numero: 28, lado: "esquerda" }
  ],
  overrides: {}
};

// src/index.js
var import_tse2 = __toESM(require_tse());
var import_fake = __toESM(require_fake());

// src/collector.mjs
var import_tse = __toESM(require_tse(), 1);

// src/vote-trends.mjs
var MAX_POINTS = 144;
var MAX_ALERTS = 100;
var BASELINE_POINTS = 12;
var MIN_BASELINE = 5;
function votes(national) {
  const left = Number(national?.votesLeft);
  const right = Number(national?.votesRight);
  if (!Number.isFinite(left) || !Number.isFinite(right) || left < 0 || right < 0) return null;
  return { left, right, total: left + right };
}
function updateVoteTrend(previous, national, at, intervalMs = 6e5, valid = true) {
  const history = Array.isArray(previous?.history) ? previous.history.slice(-MAX_POINTS) : [];
  const alerts = Array.isArray(previous?.alerts) ? previous.alerts.slice(-MAX_ALERTS) : [];
  if (!valid || !Number.isFinite(at)) return { history, alerts };
  const current = votes(national);
  if (!current) return { history, alerts };
  if (!history.length && previous?.source?.ok && previous.serverNow < at) {
    const old = votes(previous.national);
    if (old) history.push({
      at: previous.serverNow,
      totalVotes: old.total,
      leftVotes: old.left,
      rightVotes: old.right,
      newVotes: null
    });
  }
  const last = history.at(-1);
  if (last && at <= last.at) return { history, alerts };
  const leftDelta = last ? current.left - last.leftVotes : 0;
  const rightDelta = last ? current.right - last.rightVotes : 0;
  const comparable = last && at - last.at <= intervalMs * 1.5 && leftDelta >= 0 && rightDelta >= 0;
  const newVotes = comparable ? leftDelta + rightDelta : null;
  const point = {
    at,
    totalVotes: current.total,
    leftVotes: current.left,
    rightVotes: current.right,
    newVotes
  };
  if (newVotes !== null) {
    const baseline = history.map((item) => item.newVotes).filter((value) => Number.isFinite(value) && value >= 0).slice(-BASELINE_POINTS);
    if (baseline.length >= MIN_BASELINE) {
      const mean = baseline.reduce((sum, value) => sum + value, 0) / baseline.length;
      const stddev = Math.sqrt(baseline.reduce((sum, value) => sum + (value - mean) ** 2, 0) / baseline.length);
      if (Math.abs(newVotes - mean) > stddev) {
        const winner = rightDelta > leftDelta ? "direita" : leftDelta > rightDelta ? "esquerda" : "empate";
        point.outlier = true;
        alerts.push({
          id: `votes-${at}`,
          at,
          votes: newVotes,
          winner,
          direction: newVotes > mean ? "acima" : "abaixo",
          mean,
          stddev
        });
        if (alerts.length > MAX_ALERTS) alerts.splice(0, alerts.length - MAX_ALERTS);
      }
    }
  }
  history.push(point);
  if (history.length > MAX_POINTS) history.splice(0, history.length - MAX_POINTS);
  return { history, alerts };
}

// src/collector.mjs
var { UFS, OFFICES, depEstadualCargo, resultUrl, indexParties, parseResult, raceSummary, eventsFrom, emptyStates } = import_tse.default;
var INTERVAL_MS = 10 * 60 * 1e3;
var MAX_BODY_BYTES = 16 * 1024 * 1024;
var START_AT = Date.parse("2026-10-04T20:00:00Z");
var STOP_AT = Date.parse("2026-10-06T03:00:00Z");
var snapshotKey = "snapshot:v2";
async function readSnapshot(kv, now = Date.now()) {
  const snapshot = await kv.get(snapshotKey, "json");
  if (!snapshot) return null;
  const stale = now - snapshot.serverNow > 20 * 60 * 1e3;
  return {
    ...snapshot,
    serverNow: now,
    nextRefreshAt: stale ? now + 3e4 : Math.max(now + 1e3, snapshot.nextRefreshAt),
    source: stale ? { ...snapshot.source, ok: false, error: "Coleta desatualizada" } : snapshot.source
  };
}

// src/index.js
function emptySnapshot(mode, now, intervalSec) {
  return {
    mode,
    serverNow: now,
    refreshedAt: 0,
    nextRefreshAt: now + intervalSec * 1e3,
    intervalSec,
    national: { pctSections: 0, votesLeft: 0, votesRight: 0 },
    states: (0, import_tse2.emptyStates)(),
    races: {},
    events: [],
    history: [],
    alerts: [],
    source: { ok: false, error: "Aguardando a primeira coleta do TSE", lastSuccessAt: 0 }
  };
}
function fakeSnapshot(now) {
  const intervalMs = Math.max(1e4, Number(config_default.fakeIntervalSec || 20) * 1e3);
  const bucket = Math.floor(now / intervalMs);
  const period = Math.floor(bucket / 30);
  const steps = bucket % 30;
  let simulatedNow = period * 30 * intervalMs;
  const fake = (0, import_fake.createFake)(parties_default, { idPrefix: `pages-${period}`, now: () => simulatedNow });
  let trend = updateVoteTrend(null, fake.data().national, simulatedNow, intervalMs);
  for (let step = 0; step < steps; step++) {
    simulatedNow += intervalMs;
    fake.step();
    trend = updateVoteTrend(trend, fake.data().national, simulatedNow, intervalMs);
  }
  return {
    ...fake.data(),
    mode: "fake",
    serverNow: now,
    refreshedAt: bucket * intervalMs,
    nextRefreshAt: (bucket + 1) * intervalMs,
    intervalSec: intervalMs / 1e3,
    ...trend,
    source: { ok: true, error: null, lastSuccessAt: bucket * intervalMs }
  };
}
function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
async function stateResponse(request, env) {
  const url = new URL(request.url);
  const mode = String(url.searchParams.get("mode") || env.MODE || config_default.mode || "tse").toLowerCase() === "fake" ? "fake" : "tse";
  const now = Date.now();
  if (mode === "fake") return jsonResponse(fakeSnapshot(now));
  try {
    const snapshot = await readSnapshot(env.RESULTS, now);
    if (snapshot) return jsonResponse(snapshot);
    return jsonResponse(emptySnapshot(mode, now, 30), 503);
  } catch (error) {
    console.error(JSON.stringify({ event: "snapshot_read_failed", error: String(error) }));
    return jsonResponse({
      ...emptySnapshot(mode, now, 30),
      source: { ok: false, error: "N\xE3o foi poss\xEDvel ler a apura\xE7\xE3o", lastSuccessAt: 0 }
    }, 503);
  }
}
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/state") {
      return request.method === "GET" ? stateResponse(request, env) : new Response(null, { status: 405 });
    }
    if (url.pathname === "/api/events") {
      if (request.method !== "GET") return new Response(null, { status: 405 });
      const response = await stateResponse(new Request(new URL("/api/state" + url.search, url), request), env);
      const body = `retry: 30000
event: snapshot
data: ${await response.text()}

`;
      return new Response(body, {
        status: response.status,
        headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" }
      });
    }
    if (url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
    return env.ASSETS.fetch(request);
  }
};
export {
  index_default as default
};
