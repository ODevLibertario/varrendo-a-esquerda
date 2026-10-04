import assert from "node:assert/strict";
import { test } from "node:test";
import configFile from "../config.json" with { type: "json" };
import parties from "../parties.json" with { type: "json" };
import { allJobs, phaseJobs, collectPhase, electionConfig, readSnapshot } from "../src/collector.mjs";

function fakeKv() {
  const data = new Map();
  return {
    data,
    async get(key, type) {
      const value = data.get(key);
      return value && type === "json" ? JSON.parse(value) : value || null;
    },
    async put(key, value) { data.set(key, value); },
  };
}

const config = electionConfig(configFile);
const electionStart = Date.parse("2026-10-04T20:00:00Z");

test("coleta a eleição em quatro lotes e publica um único snapshot", async () => {
  const kv = fakeKv(), requests = [];
  const fetchImpl = async url => {
    requests.push(url);
    return new Response(JSON.stringify({ pst: "25,00", cand: [
      { n: "22", nm: "Azul", cc: "PL", vap: "600", pvap: "60,00" },
      { n: "13", nm: "Vermelho", cc: "PT", vap: "400", pvap: "40,00" },
    ] }), { headers: { "content-type": "application/json" } });
  };
  assert.equal(allJobs(config).length, 136);
  for (let phase = 0; phase < 4; phase++) {
    assert.equal(phaseJobs(config, phase).length, 34);
    await collectPhase({ kv, phase, config, parties, fetchImpl,
      now: () => electionStart + phase * 60000, sleep: async () => {} });
  }
  assert.equal(requests.length, 136);
  const snapshot = await readSnapshot(kv, electionStart + 3 * 60000);
  assert.equal(snapshot.source.ok, true);
  assert.equal(snapshot.national.votesRight, 600);
  assert.equal(snapshot.states.SP.votesLeft, 400);
  assert.equal(snapshot.races.SP.length, 4);
  assert.equal(snapshot.history.length, 1);
  assert.equal(snapshot.history[0].totalVotes, 1000);
  assert.deepEqual(snapshot.alerts, []);
  assert.ok(requests.some(url => url.includes("/dados/df/df-c0008-")));
  assert.equal(kv.data.has("snapshot:v2"), true);
});

test("arquivo nacional ausente impede os demais lotes", async () => {
  const kv = fakeKv();
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response(null, { status: 404 }); };
  await collectPhase({ kv, phase: 0, config, parties, fetchImpl,
    now: () => electionStart, sleep: async () => {} });
  const next = await collectPhase({ kv, phase: 1, config, parties, fetchImpl,
    now: () => electionStart + 60000, sleep: async () => {} });
  assert.equal(next.skipped, "TSE em espera após bloqueio");
  assert.equal(calls, 1);
});

test("fora da janela eleitoral não consulta o TSE", async () => {
  const result = await collectPhase({ kv: fakeKv(), phase: 0, config, parties,
    fetchImpl: () => { throw new Error("não deveria consultar"); },
    now: () => electionStart - 60000 });
  assert.equal(result.skipped, "fora da janela eleitoral");
});
