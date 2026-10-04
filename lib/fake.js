'use strict';
// Fake-data generator: the prototype's simulation, server-side. Same Snapshot pieces as TSE mode.
const { UFS, emptyStates, indexParties, normKey } = require('./tse');

const ELECTORATE = { SP:34.4, MG:16.3, RJ:12.8, BA:11.3, RS:8.6, PR:8.5, PE:7.0, CE:6.8, PA:6.1, SC:5.5, MA:4.9, GO:4.9, PB:3.0, ES:2.9, AM:2.7, RN:2.6, PI:2.6, MT:2.5, AL:2.3, DF:2.2, MS:2.0, SE:1.7, RO:1.2, TO:1.1, AC:0.6, AP:0.55, RR:0.37 };
const TARGET_RIGHT = { SP:.56, MG:.51, RJ:.57, BA:.33, RS:.55, PR:.62, PE:.36, CE:.35, PA:.47, SC:.68, MA:.32, GO:.61, PB:.38, ES:.58, AM:.52, RN:.40, PI:.29, MT:.66, AL:.44, DF:.59, MS:.60, SE:.39, RO:.69, TO:.53, AC:.64, AP:.50, RR:.72 };
const SPEED = { SP:.13, MG:.12, RJ:.11, BA:.12, RS:.15, PR:.17, PE:.13, CE:.14, PA:.07, SC:.18, MA:.09, GO:.15, PB:.14, ES:.16, AM:.06, RN:.15, PI:.13, MT:.12, AL:.14, DF:.22, MS:.14, SE:.16, RO:.10, TO:.08, AC:.06, AP:.05, RR:.05 };
const FIRST = ["Ana","Bruno","Carla","Diego","Elaine","Fábio","Gisele","Henrique","Irene","João","Kátia","Leandro","Marina","Nélson","Olívia","Paulo","Raquel","Sérgio","Tânia","Valter","Wagner","Yara","Rogério","Denise","Murilo","Patrícia","Otávio","Luciana"];
const LAST = ["Andrade","Barreto","Cavalcanti","Duarte","Esteves","Figueira","Guimarães","Holanda","Lacerda","Macedo","Nogueira","Pacheco","Queiroz","Rezende","Siqueira","Tavares","Valadares","Xavier","Brandão","Coutinho","Peixoto","Moraes","Amaral","Teixeira"];
const OFFICES = ["Governador(a)","Senador(a)","Senador(a)","Dep. Federal","Dep. Federal","Dep. Estadual"];

function createFake(parties, { now = Date.now, seed = 20261004 } = {}) {
  // Same side rule as TSE mode (indexParties): only 'direita' is right, everything else falls to 'padrao' (esquerda).
  // Historical/merged parties ('ativo': false) are skipped so the demo only uses parties on the 2026 ballot.
  const P = indexParties(parties);
  const list = ((parties && parties.parties) || []).filter(p => p.sigla && p.ativo !== false);
  const ladoOf = p => P.byAcr.get(normKey(p.sigla)).lado;
  const PARTY_RIGHT = list.filter(p => ladoOf(p) === 'direita').map(p => p.sigla);
  const PARTY_LEFT = list.filter(p => ladoOf(p) === 'esquerda').map(p => p.sigla);
  if (!PARTY_RIGHT.length) PARTY_RIGHT.push('PL');
  if (!PARTY_LEFT.length) PARTY_LEFT.push('PT');

  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pick = a => a[Math.floor(rnd() * a.length)];
  let state, used, events, counter, doneOnce, leaders;
  const RACES = [['Governador(a)', .85], ['Senador(a)', .85], ['Dep. Federal', 1], ['Dep. Estadual', 1]];
  const boot = Date.now().toString(36); // ids unique across server restarts (open pages remember seen ids)

  function advance(scale = 1) {
    for (const uf of UFS) {
      const s = state[uf];
      if (s.prog >= 1) continue;
      s.prog = Math.min(1, s.prog + SPEED[uf] * scale * (0.6 + rnd() * 0.8));
      const noise = (rnd() - .5) * .14 * (1 - s.prog);
      s.right = Math.max(.05, Math.min(.95, TARGET_RIGHT[uf] + noise));
    }
  }

  function makeEvent(minProg, at) {
    const ready = UFS.filter(uf => state[uf].prog > minProg);
    if (!ready.length) return null;
    const uf = pick(ready);
    const win = rnd() < .55;
    let name, tries = 0;
    do { name = pick(FIRST) + ' ' + pick(LAST); } while (used.has(name) && ++tries < 50);
    used.add(name);
    const pct = win ? .5 + rnd() * .22 : .18 + rnd() * .28;
    return { id: `fake-${boot}-${++counter}-${uf}`, kind: win ? 'win' : 'loss', name, office: pick(OFFICES), uf,
      party: win ? pick(PARTY_RIGHT) : pick(PARTY_LEFT), pct, at };
  }

  function reset() {
    state = {}; used = new Set(); events = []; counter = counter || 0; doneOnce = false;
    for (const uf of UFS) state[uf] = { prog: 0, right: .5 };
    leaders = {};   // fixed fictional leaders per state/race: [right-wing, left-wing]
    for (const uf of UFS) leaders[uf] = RACES.map(() => [
      { name: pick(FIRST) + ' ' + pick(LAST), party: pick(PARTY_RIGHT), side: 'direita' },
      { name: pick(FIRST) + ' ' + pick(LAST), party: pick(PARTY_LEFT), side: 'esquerda' }]);
  }

  function init() {
    reset();
    advance(1.5); // ~20% in
    const t = now();
    for (let i = 4; i >= 0; i--) { const e = makeEvent(0, t - (i + 1) * 90e3); if (e) events.unshift(e); }
  }

  // one fake refresh
  function step() {
    const allDone = UFS.every(uf => state[uf].prog >= 1);
    if (allDone) {
      if (doneOnce) { reset(); return; } // loop the demo
      doneOnce = true; return;
    }
    advance(1);
    if (UFS.some(uf => state[uf].prog > .4)) {
      const n = 1 + (rnd() < .5 ? 1 : 0);
      for (let i = 0; i < n; i++) { const e = makeEvent(.4, now() + i); if (e) events.unshift(e); }
    }
    events = events.slice(0, 1000);
  }

  function parties_() { return { right: PARTY_RIGHT.slice(), left: PARTY_LEFT.slice() }; }

  function data() {
    const states = emptyStates();
    let vL = 0, vR = 0, sec = 0, tot = 0;
    for (const uf of UFS) {
      const s = state[uf];
      const counted = ELECTORATE[uf] * 1e6 * .79 * s.prog;
      const r = Math.round(counted * s.right), l = Math.round(counted * (1 - s.right));
      states[uf] = { pctSections: s.prog, votesLeft: l, votesRight: r };
      vL += l; vR += r; sec += ELECTORATE[uf] * s.prog; tot += ELECTORATE[uf];
    }
    const races = {};
    for (const uf of UFS) {
      const s = state[uf];
      races[uf] = RACES.map(([office, doneAt], i) => {
        const [r, l] = leaders[uf][i], dep = office.startsWith('Dep');
        const share = dep ? .02 + .03 * (s.right >= .5 ? s.right : 1 - s.right) : Math.max(s.right, 1 - s.right) * .9;
        const decided = s.prog >= doneAt;
        return { office, pctSections: s.prog, decided, status: decided ? 'decidido' : 'pendente',
          leader: s.prog > 0 ? { ...(s.right >= .5 ? r : l), pct: share } : null };
      });
    }
    return { national: { pctSections: sec / tot, votesLeft: vL, votesRight: vR }, states, races, events: events.slice() };
  }

  init();
  return { step, data, parties: parties_ };
}

module.exports = { createFake };
