'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const tse = require('../lib/tse');

const ROOT = path.join(__dirname, '..');
const fx = name => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
const parties = JSON.parse(fs.readFileSync(path.join(ROOT, 'parties.json'), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const P = tse.indexParties(parties);

test('number/percent parsing', () => {
  assert.equal(tse.parseIntLoose('18.500.123'), 18500123);
  assert.equal(tse.parseIntLoose(42), 42);
  assert.equal(tse.parseIntLoose(undefined), 0);
  assert.equal(tse.parsePct('12,34'), 0.1234);
  assert.equal(tse.parsePct('100,00'), 1);
  assert.equal(tse.parsePct(null), null);
});

test('URL building', () => {
  const t = { ...config.tse };
  assert.equal(tse.resultUrl(t, { cycle: 'ele2026', ele: 6257, uf: 'BR', cargo: 1 }),
    'https://resultados.tse.jus.br/oficial/ele2026/6257/dados/br/br-c0001-e006257-u.json');
  assert.equal(tse.resultUrl(t, { cycle: 'ele2026', ele: 6259, uf: 'SP', cargo: 3 }),
    'https://resultados.tse.jus.br/oficial/ele2026/6259/dados/sp/sp-c0003-e006259-u.json');
  assert.equal(tse.configUrl(t), 'https://resultados.tse.jus.br/oficial/comum/config/ele-c.json');
  assert.equal(tse.cycleFromConfig(fx('ele-c.json')), 'ele2026');
  assert.equal(tse.cycleFromConfig({ x: [{ y: 'ele2030' }] }), 'ele2030');
  // real ele-c.json lists the 2024 municipal pleito first; pick the pleito containing the federal code
  const realish = { pl: [ { cd: '1000', c: 'ele2024', e: [ { cd: '619' } ] }, { cd: '3220', c: 'ele2026', e: [ { cd: '6257' }, { cd: '6259' } ] } ] };
  assert.equal(tse.cycleFromConfig(realish, 6257), 'ele2026');
});

test('simplified (2022-style) national file', () => {
  const r = tse.parseResult(fx('br-pres-simplified.json'), P, 'BR');
  assert.equal(r.pctSections, 0.4231);
  assert.equal(r.candidates.length, 6);
  const by = Object.fromEntries(r.candidates.map(c => [c.number, c]));
  assert.equal(by['22'].party, 'PL'); assert.equal(by['22'].side, 'direita');
  assert.equal(by['13'].party, 'PT'); assert.equal(by['13'].side, 'esquerda'); // federation cc -> number fallback
  assert.equal(by['15'].side, 'esquerda', 'MDB is not on the right list -> esquerda');
  assert.equal(by['50'].party, 'PSOL');
  assert.equal(by['16'].valid, false);
  assert.equal(by['22'].pct, 0.4625);
  // left = 13 + 15 + 50 + 29 (16 is anulado), right = 22; no centro anymore
  assert.equal(r.votesLeft, 17000000 + 3000000 + 1200000 + 299877);
  assert.equal(r.votesRight, 18500123);
  const evs = tse.eventsFrom(r, { office: 'Presidente', uf: 'BR', minEventPct: 0.03, isPresident: true });
  // 2º turno is not a loss; MDB 7.5% and PSOL 3% are >= 3% -> loss; PCO 0.75% below threshold
  assert.deepEqual(evs.map(e => e.id), ['Presidente-BR-15-loss', 'Presidente-BR-50-loss']);
});

test('nested variant (abr[0] / party nodes with sg)', () => {
  const r = tse.parseResult(fx('sp-gov-nested.json'), P, 'SP');
  assert.equal(r.pctSections, 1);
  assert.equal(r.candidates.length, 3, 'party nodes must not be counted as candidates');
  const by = Object.fromEntries(r.candidates.map(c => [c.number, c]));
  assert.equal(by['22'].name, 'Governador Azul');
  assert.equal(by['22'].party, 'PL');
  assert.equal(by['13'].party, 'PT');
  assert.equal(r.votesRight, 12345678);
  assert.equal(r.votesLeft, 9100000);
  const evs = tse.eventsFrom(r, { office: 'Governador(a)', uf: 'sp', minEventPct: 0.03 });
  assert.deepEqual(evs.map(e => [e.id, e.kind]), [['Governador(a)-SP-22-win', 'win'], ['Governador(a)-SP-13-loss', 'loss']]);
});

test('number-prefix party fallback and overrides', () => {
  const r = tse.parseResult(fx('rj-sen-numfallback.json'), P, 'RJ');
  const by = Object.fromEntries(r.candidates.map(c => [c.number, c]));
  assert.equal(by['221'].party, 'PL'); assert.equal(by['221'].side, 'direita');
  assert.equal(by['131'].party, 'PT'); assert.equal(by['131'].side, 'esquerda');
  assert.equal(by['999'].side, 'esquerda', 'unknown party -> padrao (esquerda)');
  assert.equal(r.pctSections, 0.875);
  const P2 = tse.indexParties({ ...parties, overrides: { 'RJ:999': 'direita' } });
  assert.equal(tse.parseResult(fx('rj-sen-numfallback.json'), P2, 'RJ').candidates.find(c => c.number === '999').side, 'direita');
  // accent/case-insensitive acronym
  assert.equal(tse.sideOf({ party: 'uniao', number: '' }, 'sp', P), 'esquerda');
  assert.equal(tse.sideOf({ party: 'Podemos', number: '' }, 'sp', P), 'esquerda');
  for (const m of ['MISSÃO', 'Missao', 'missão', 'MISSAO']) assert.equal(tse.sideOf({ party: m, number: '' }, 'sp', P), 'direita', m);
  for (const r of ['PL', 'novo', 'Republicanos', 'prd', 'PSC', 'pds', 'Prona', 'PRM', 'udn', 'PRC']) assert.equal(tse.sideOf({ party: r, number: '' }, 'sp', P), 'direita', r);
});

test('party rule: only listed right parties are direita; padrao, legacy centro, overrides', () => {
  assert.equal(P.padrao, 'esquerda');
  assert.ok(!parties.parties.some(p => p.lado !== 'direita' && p.lado !== 'esquerda'), 'parties.json has only direita/esquerda');
  // legacy 'centro' or a typo in lado/overrides is treated as padrao
  const L = tse.indexParties({ parties: [{ sigla: 'XX', numero: 99, lado: 'centro' }], overrides: { 'sp:1': 'centro', 'sp:2': 'DIREITA' } });
  assert.equal(tse.sideOf({ party: 'XX', number: '99' }, 'rj', L), 'esquerda');
  assert.equal(tse.sideOf({ party: 'ZZZ', number: '1' }, 'sp', L), 'esquerda');
  assert.equal(tse.sideOf({ party: 'ZZZ', number: '2' }, 'sp', L), 'direita');
  assert.equal(tse.sideOf({ party: '', number: '' }, 'sp', L), 'esquerda', 'no party info -> esquerda');
  // padrao is honoured if someone flips it
  assert.equal(tse.sideOf({ party: 'ZZZ', number: '' }, 'sp', tse.indexParties({ padrao: 'direita', parties: [] })), 'direita');
  // number fallback for right parties
  assert.equal(tse.sideOf({ party: '', number: '301' }, 'sp', P), 'direita');
  assert.equal(tse.sideOf({ party: '', number: '25' }, 'sp', P), 'direita');
  assert.equal(tse.sideOf({ party: '', number: '20' }, 'sp', P), 'esquerda', '20 is PODE, not PSC');
});

test('fake mode uses only active right parties for wins and esquerda parties for losses', () => {
  const { createFake } = require('../lib/fake');
  const f = createFake(parties);
  assert.deepEqual(f.parties().right.sort(), ['MISSÃO', 'NOVO', 'PL', 'PRD', 'REPUBLICANOS']);
  for (let i = 0; i < 8; i++) f.step(); // stays before the demo loops back to zero
  const evs = f.data().events;
  assert.ok(evs.length > 8, `got ${evs.length} events`);
  const right = new Set(f.parties().right), left = new Set(f.parties().left);
  for (const e of evs) assert.ok(e.kind === 'win' ? right.has(e.party) : left.has(e.party), `${e.kind} ${e.party}`);
  for (const e of evs) if (e.kind === 'loss') assert.equal(tse.sideOf({ party: e.party, number: '' }, e.uf, P), 'esquerda');
});

test('elected detection', () => {
  const c = tse.extractCandidates({ cand: [
    { n: '1', nm: 'a', vap: '1', st: 'Eleito por QP' },
    { n: '2', nm: 'b', vap: '1', st: 'Não eleito' },
    { n: '3', nm: 'c', vap: '1', e: 's' },
  ] });
  assert.deepEqual(c.map(x => x.elected), [true, false, true]);
});

test('number/percent edge cases', () => {
  assert.equal(tse.parseIntLoose('1234567'), 1234567);
  assert.equal(tse.parseIntLoose('1,234,567'), 1234567);
  assert.equal(tse.parseIntLoose(''), 0);
  assert.equal(tse.parsePct('42.31'), 0.4231);
  assert.equal(tse.parsePct('42,31%'), 0.4231);
  assert.equal(tse.parsePct(100), 1);
  assert.equal(tse.parsePct('0,00'), 0);
});

test('unified file: fixed + variable parts merged, no double counting, nested pst, name fallback', () => {
  const r = tse.parseResult(fx('br-pres-unified.json'), P, 'BR');
  assert.equal(r.pctSections, 0.6356, 'pst found in abr[0].s');
  assert.equal(r.candidates.length, 4, 'each candidate once');
  const by = Object.fromEntries(r.candidates.map(c => [c.number, c]));
  assert.equal(by['22'].name, 'Direitão'); assert.equal(by['22'].party, 'PL'); assert.equal(by['22'].votes, 45000000);
  assert.equal(by['13'].name, 'Esquerdão'); assert.equal(by['13'].party, 'PT');
  assert.equal(by['70'].name, 'Candidato 70', 'no name anywhere -> Candidato <n>');
  assert.equal(by['70'].party, 'AVANTE');
  assert.equal(r.votesRight, 45000000, 'BR totals, not BR + SP');
  assert.equal(r.votesLeft, 40000000 + 4000000 + 1000000);
  const evs = tse.eventsFrom(r, { office: 'Presidente', uf: 'BR', isPresident: true });
  assert.deepEqual(evs.map(e => [e.id, e.name, e.party]), [['Presidente-BR-50-loss', 'Psolista', 'PSOL']]);
});

test('same candidate twice with votes is counted once; missing pvap -> computed pct', () => {
  const j = { pst: '10,00', cand: [ { n: '22', nm: 'A', cc: 'PL', vap: '600' }, { n: '13', nm: 'B', cc: 'PT', vap: '400', st: 'Não eleito' } ],
    resumo: { cand: [ { n: '22', vap: '600' }, { n: '13', vap: '400' } ] } };
  const r = tse.parseResult(j, P, 'SP');
  assert.equal(r.candidates.length, 2);
  assert.equal(r.votesRight, 600); assert.equal(r.votesLeft, 400);
  assert.equal(r.candidates.find(c => c.number === '13').pct, 0.4);
  assert.equal(tse.extractCandidates({ cand: [{ n: '99', vap: '5' }] })[0].name, 'Candidato 99');
});

// ---------- mock TSE server ----------
function startMock(handler) {
  return new Promise(resolve => {
    const reqs = [];
    const srv = http.createServer((req, res) => { reqs.push({ url: req.url, headers: req.headers }); handler(req, res, reqs); });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, reqs, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

function fixtureFor(url) {
  if (url.endsWith('/comum/config/ele-c.json')) return fx('ele-c.json');
  if (url.includes('/dados/br/br-c0001-')) return fx('br-pres-simplified.json');
  if (url.includes('/dados/sp/sp-c0003-')) return fx('sp-gov-nested.json');
  if (url.includes('/dados/rj/rj-c0005-')) return fx('rj-sen-numfallback.json');
  if (url.includes('/dados/sp/sp-c0006-')) return { pst: '100,00', cand: [
    { n: '2222', nm: 'Dep Azul', vap: '300000', pvap: '1,20', e: 's', st: 'Eleito por QP' },
    { n: '1313', nm: 'Dep Vermelho', vap: '250000', pvap: '1,00', e: 's', st: 'Eleito por média' },
    { n: '1399', nm: 'Dep Perdeu', vap: '9000', pvap: '0,04', e: 'n', st: 'Não eleito' }] };
  const m = url.match(/\/dados\/(\w\w)\/\w\w-c0001-/);
  if (m) return { pst: m[1] === 'sp' ? '50,00' : '10,00', cand: [
    { n: '22', nm: 'D', cc: 'PL', vap: '600', pvap: '60,00', st: '2º turno' },
    { n: '13', nm: 'E', cc: 'PT', vap: '400', pvap: '40,00', st: '2º turno' }] };
  return { pst: '0,00', cand: [] };
}

test('full poll cycle against mock server: snapshot, conditional headers, 304, spacing', async () => {
  const { srv, reqs, base } = await startMock((req, res) => {
    const etag = '"v1-' + req.url.length + '"';
    if (req.headers['if-none-match'] === etag) { res.writeHead(304); return res.end(); }
    res.writeHead(200, { 'content-type': 'application/json', etag, 'last-modified': 'Sun, 04 Oct 2026 20:00:00 GMT' });
    res.end(JSON.stringify(fixtureFor(req.url)));
  });
  try {
    const cfg = { ...config, tse: { ...config.tse, cycle: null, base, requestSpacingMs: 0 } };
    const poller = tse.createPoller({ config: cfg, parties });
    const r1 = await poller.runCycle();
    assert.equal(r1.ok, true, r1.error);
    assert.equal(reqs.length, 1 + 136, 'config + 136 result files');
    assert.ok(reqs.some(r => r.url.includes('/dados/df/df-c0008-')), 'DF uses Deputado Distrital (c0008)');
    assert.ok(!reqs.some(r => r.url.includes('/dados/df/df-c0007-')), 'never request df-c0007 (404)');
    assert.ok(reqs.some(r => r.url.includes('/dados/sp/sp-c0007-')) && reqs.some(r => r.url.includes('/dados/sp/sp-c0006-')));
    assert.ok(reqs[1].url.includes('/oficial/ele2026/6257/dados/br/br-c0001-e006257-u.json'), 'national first: ' + reqs[1].url);
    const d = poller.data;
    assert.equal(d.national.pctSections, 0.4231);
    assert.equal(d.national.votesRight, 18500123);
    assert.equal(Object.keys(d.states).length, 27);
    assert.deepEqual(d.states.SP, { pctSections: 0.5, votesLeft: 400, votesRight: 600 });
    assert.equal(d.states.AC.pctSections, 0.1);
    const ids = d.events.map(e => e.id).sort();
    assert.deepEqual(ids, ['Dep. Federal-SP-2222-win', 'Governador(a)-SP-13-loss', 'Governador(a)-SP-22-win', 'Presidente-BR-15-loss', 'Presidente-BR-50-loss', 'Senador(a)-RJ-131-loss', 'Senador(a)-RJ-221-win'].sort());
    assert.ok(d.events.every(e => typeof e.at === 'number' && e.at > 0));
    assert.equal(d.source.ok, true);
    const firstAt = d.events[0].at;

    // second cycle: config is cached (not refetched), everything sends conditional headers and gets 304
    reqs.length = 0;
    const r2 = await poller.runCycle();
    assert.equal(r2.ok, true, r2.error);
    assert.equal(reqs.length, 136);
    assert.ok(reqs.every(q => q.headers['if-none-match'] && q.headers['if-modified-since']), 'conditional headers sent');
    assert.equal(poller.data.national.votesRight, 18500123, 'cached body kept on 304');
    assert.equal(poller.data.states.SP.votesRight, 600);
    assert.equal(poller.data.events.length, 7, 'no duplicate events');
    assert.ok(poller.data.events.every(e => e.at <= firstAt + 5000));
  } finally { srv.close(); }
});

test('national 404 aborts the cycle; other errors keep last good data', async () => {
  let mode = '404';
  const { srv, reqs, base } = await startMock((req, res) => {
    if (mode === '404' && req.url.includes('/dados/')) { res.writeHead(404); return res.end(); }
    if (mode === '503' && req.url.includes('/dados/') && !req.url.includes('/br/')) { res.writeHead(503); return res.end(); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(fixtureFor(req.url)));
  });
  try {
    const cfg = { ...config, tse: { ...config.tse, cycle: null, base, requestSpacingMs: 0 } };
    const poller = tse.createPoller({ config: cfg, parties });
    const r = await poller.runCycle();
    assert.equal(r.ok, false); assert.equal(r.aborted, true); assert.equal(r.backoff, true);
    assert.equal(reqs.filter(q => q.url.includes('/dados/')).length, 1, 'only the national file was requested');
    assert.equal(poller.data.source.ok, false);
    assert.equal(poller.data.refreshedAt, 0);

    mode = 'ok';
    assert.equal((await poller.runCycle()).ok, true);
    assert.equal(poller.data.states.SP.votesRight, 600);

    mode = '503';
    const r3 = await poller.runCycle();
    assert.equal(r3.ok, false); assert.equal(r3.backoff, true);
    assert.equal(poller.data.states.SP.votesRight, 600, 'last good per-UF data kept');
    assert.equal(poller.data.source.ok, false);
  } finally { srv.close(); }
});

test('TSE_BASE env overrides config base; 429 stops the cycle', async () => {
  const { srv, reqs, base } = await startMock((req, res) => {
    if (req.url.includes('/dados/') && !req.url.includes('/br/')) { res.writeHead(429); return res.end(); }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(fixtureFor(req.url)));
  });
  process.env.TSE_BASE = base;
  try {
    const poller = tse.createPoller({ config: { ...config, tse: { ...config.tse, requestSpacingMs: 0 } }, parties });
    const r = await poller.runCycle();
    assert.equal(r.aborted, true);
    assert.equal(reqs.filter(q => q.url.includes('/dados/')).length, 2, 'stops right after the 429');
  } finally { delete process.env.TSE_BASE; srv.close(); }
});

test('request spacing is respected', async () => {
  const { srv, reqs, base } = await startMock((req, res) => {
    reqs[reqs.length - 1].t = Date.now();
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(fixtureFor(req.url)));
  });
  try {
    const sleeps = [];
    const poller = tse.createPoller({ config: { ...config, tse: { ...config.tse, base, requestSpacingMs: 150 } }, parties,
      sleep: ms => { sleeps.push(ms); return Promise.resolve(); } });
    await poller.runCycle();
    assert.ok(sleeps.length > 70, 'sleeps between requests: ' + sleeps.length);
    assert.ok(sleeps.every(ms => ms > 0 && ms <= 150));
  } finally { srv.close(); }
});

test('server smoke test in fake mode', async () => {
  const port = 18000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: { ...process.env, MODE: 'fake', PORT: String(port) }, stdio: 'pipe' });
  try {
    let s;
    for (let i = 0; i < 150 && !s; i++) {
      await new Promise(r => setTimeout(r, 100));
      try { s = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json(); } catch {}
    }
    assert.ok(s, 'server answered');
    assert.equal(s.mode, 'fake');
    assert.equal(Object.keys(s.states).length, 27);
    assert.equal(s.events.length, 5);
    assert.ok(s.national.pctSections > 0.1 && s.national.pctSections < 0.4);
    assert.ok(s.nextRefreshAt > s.serverNow);
    const trav = await fetch(`http://127.0.0.1:${port}/..%2fconfig.json`);
    assert.notEqual(trav.status, 200);
    const em = await fetch(`http://127.0.0.1:${port}/emoji/humor-01.png`);
    assert.equal(em.status, 200); assert.equal(em.headers.get('content-type'), 'image/png');
  } finally { child.kill(); }
});

test('403 (CDN block) stops the cycle and is flagged as blocked; partial data kept', async () => {
  const { srv, reqs, base } = await startMock((req, res) => {
    if (req.url.includes('/dados/') && req.url.includes('-c0003-')) { res.writeHead(403); return res.end(); }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(fixtureFor(req.url)));
  });
  try {
    const poller = tse.createPoller({ config: { ...config, tse: { ...config.tse, cycle: null, base, requestSpacingMs: 0 } }, parties });
    const r = await poller.runCycle();
    assert.equal(r.aborted, true); assert.equal(r.blocked, true);
    assert.equal(reqs.filter(q => q.url.includes('/dados/')).length, 1 + 27 + 1, 'stops at the first 403');
    assert.equal(poller.data.states.SP.votesRight, 600, 'files fetched before the block are used');
  } finally { srv.close(); }
});

test('repeated 5xx stops the cycle early instead of hammering', async () => {
  const { srv, reqs, base } = await startMock((req, res) => {
    if (req.url.includes('/dados/') && !req.url.includes('/br/')) { res.writeHead(502); return res.end(); }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(fixtureFor(req.url)));
  });
  try {
    const poller = tse.createPoller({ config: { ...config, tse: { ...config.tse, cycle: null, base, requestSpacingMs: 0 } }, parties });
    const r = await poller.runCycle();
    assert.equal(r.ok, false); assert.equal(r.backoff, true);
    assert.equal(reqs.filter(q => q.url.includes('/dados/')).length, 1 + 4);
    assert.equal(poller.data.national.votesRight, 18500123, 'national data still published');
  } finally { srv.close(); }
});

test('TSE unreachable or stalled body never throws or hangs', async () => {
  const cfg = { ...config, tse: { ...config.tse, requestSpacingMs: 0, timeoutMs: 300 } };
  const down = tse.createPoller({ config: cfg, parties, fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  const r = await down.runCycle();
  assert.equal(r.ok, false); assert.equal(r.aborted, true);

  const { srv, base } = await startMock((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"pst":"1'); // never ends
  });
  try {
    const stalled = tse.createPoller({ config: { ...cfg, tse: { ...cfg.tse, base } }, parties });
    const t0 = Date.now();
    const r2 = await stalled.runCycle();
    assert.equal(r2.ok, false);
    assert.ok(Date.now() - t0 < 5000, 'body read is covered by the timeout');
  } finally { srv.closeAllConnections(); srv.close(); }
});

test('raceSummary: pending with leader, decided when elected or runoff', () => {
  const P = tse.indexParties(parties);
  const pending = tse.parseResult({ pst: '40,00', cand: [
    { n: '13', nm: 'Vermelho', vap: '400', pvap: '40,00', st: '' },
    { n: '22', nm: 'Azul', vap: '600', pvap: '60,00', st: '' }] }, P, 'sp');
  const r = tse.raceSummary(pending, 'Governador(a)');
  assert.equal(r.decided, false); assert.equal(r.status, 'pendente'); assert.equal(r.pctSections, 0.4);
  assert.deepEqual([r.leader.name, r.leader.side, r.leader.pct], ['Azul', 'direita', 0.6]);
  const done = tse.parseResult({ pst: '100,00', cand: [{ n: '22', nm: 'Azul', vap: '600', pvap: '60,00', e: 's', st: 'Eleito' }] }, P, 'sp');
  assert.equal(tse.raceSummary(done, 'Governador(a)').decided, true);
  const runoff = tse.parseResult({ pst: '100,00', cand: [{ n: '22', nm: 'Azul', vap: '6', pvap: '45,00', st: '2º turno' }] }, P, 'sp');
  assert.equal(tse.raceSummary(runoff, 'Governador(a)').status, '2º turno');
  const empty = tse.parseResult({ pst: '0,00', cand: [{ n: '22', nm: 'Azul', vap: '0', pvap: '0,00' }] }, P, 'sp');
  assert.equal(tse.raceSummary(empty, 'Governador(a)').leader, null);
});

test('fake mode exposes 4 races per state', () => {
  const { createFake } = require('../lib/fake');
  const d = createFake(parties).data();
  assert.equal(Object.keys(d.races).length, 27);
  assert.deepEqual(d.races.SP.map(r => r.office), ['Governador(a)', 'Senador(a)', 'Dep. Federal', 'Dep. Estadual']);
});
