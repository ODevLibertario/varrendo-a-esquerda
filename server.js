'use strict';
// Varrendo a Esquerda — single process: TSE poller OR fake generator, static files, SSE.
// Run: node server.js | MODE=fake node server.js | node server.js --probe
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createPoller, emptyStates } = require('./lib/tse');
const { createFake } = require('./lib/fake');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const readJson = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const config = readJson('config.json');
// Election profile (config.eleicao / ELEICAO env): overrides fields of config.tse, only 2026 today (TSE no longer serves 2022).
const ELEICAO = String(process.env.ELEICAO || config.eleicao || '2026');
if (config.eleicoes) {
  if (!config.eleicoes[ELEICAO]) { console.error(`ELEICAO=${ELEICAO} não existe em config.json (opções: ${Object.keys(config.eleicoes).join(', ')})`); process.exit(1); }
  config.tse = { ...config.tse, ...config.eleicoes[ELEICAO] };
}
const parties = readJson('parties.json');
let rawCycleAt = null;
function saveRaw(dir, url, body, at) {
  rawCycleAt ??= at;
  const folder = path.resolve(ROOT, dir, new Date(rawCycleAt).toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, path.basename(new URL(url).pathname)), body);
}

const MODE = (process.env.MODE || config.mode || 'tse').toLowerCase() === 'fake' ? 'fake' : 'tse';
const PORT = Number(process.env.PORT || config.port || 8090);
const INTERVAL_SEC = Number(process.env.INTERVAL_SEC || config.intervalSec || 300);
const FAKE_INTERVAL_SEC = Number(process.env.FAKE_INTERVAL_SEC || config.fakeIntervalSec || 20);
const MAX_BACKOFF_SEC = Number(config.maxBackoffSec || 600);
const log = (...a) => console.log(new Date().toISOString(), ...a);
log(`eleição ${ELEICAO}: códigos ${config.tse.elections.federal}/${config.tse.elections.estadual}, ciclo ${config.tse.cycle || '(do ele-c.json)'}`);

// ---------- --probe ----------
if (process.argv.includes('--probe')) {
  const poller = createPoller({ config, parties, log, saveRaw });
  poller.probe().then(out => {
    console.log(JSON.stringify(out, null, 2));
    process.exit(0);
  }, err => {
    console.error('PROBE FALHOU:', err.message);
    process.exit(1);
  });
  return;
}

// ---------- state ----------
const intervalSec = MODE === 'fake' ? FAKE_INTERVAL_SEC : INTERVAL_SEC;
let snap = {
  mode: MODE, serverNow: Date.now(), refreshedAt: 0, nextRefreshAt: Date.now(), intervalSec,
  national: { pctSections: 0, votesLeft: 0, votesRight: 0 }, states: emptyStates(), races: {}, events: [],
  source: { ok: true, error: null, lastSuccessAt: 0 },
};
const clients = new Set();
const snapshot = () => ({ ...snap, serverNow: Date.now() });
function broadcast() {
  const msg = `event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`;
  for (const res of clients) res.write(msg);
}

// ---------- refresh loops ----------
if (MODE === 'fake') {
  const fake = createFake(parties);
  const apply = () => {
    const t = Date.now();
    snap = { ...snap, ...fake.data(), refreshedAt: t, nextRefreshAt: t + intervalSec * 1000, source: { ok: true, error: null, lastSuccessAt: t } };
  };
  apply();
  const tick = () => { fake.step(); apply(); broadcast(); setTimeout(tick, intervalSec * 1000); };
  setTimeout(tick, intervalSec * 1000);
} else {
  const poller = createPoller({ config, parties, log, saveRaw });
  let failures = 0;
  const run = async () => {
    rawCycleAt = null;
    const started = Date.now();
    let delaySec = intervalSec;
    try {   // whatever happens, the next cycle is always scheduled (the loop must never die)
      log('ciclo TSE iniciado');
      const r = await poller.runCycle();
      failures = r.backoff ? failures + 1 : 0;
      delaySec = failures ? Math.min(Math.max(MAX_BACKOFF_SEC, intervalSec), intervalSec * 2 ** failures) : intervalSec;
      if (r.blocked) delaySec = Math.max(delaySec, 600);   // TSE blocks ~10 min; retrying earlier renews the block
      const d = poller.data;
      snap = { ...snap, national: d.national, states: d.states, races: d.races, events: d.events, source: d.source,
        refreshedAt: d.refreshedAt, nextRefreshAt: Date.now() + delaySec * 1000 };
      log(`ciclo TSE ${r.ok ? 'ok' : 'com erro'} em ${((Date.now() - started) / 1000).toFixed(1)}s; br=${(d.national.pctSections * 100).toFixed(2)}%; próximo em ${delaySec}s`);
      broadcast();
    } catch (e) {
      failures++;
      delaySec = Math.min(Math.max(MAX_BACKOFF_SEC, intervalSec), intervalSec * 2);
      snap = { ...snap, nextRefreshAt: Date.now() + delaySec * 1000 };
      log('erro inesperado no ciclo TSE: ' + (e && e.stack || e));
    }
    setTimeout(run, delaySec * 1000);
  };
  run();
}

// ---------- HTTP ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.webp': 'image/webp' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/state') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(JSON.stringify(snapshot()));
  }
  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'connection': 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(`retry: 3000\nevent: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`);
    clients.add(res);
    res.on('error', () => clients.delete(res));
    req.on('close', () => clients.delete(res));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
});
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000).unref();
server.listen(PORT, () => log(`Varrendo a Esquerda em http://localhost:${PORT} (modo ${MODE}, intervalo ${intervalSec}s)`));
