import assert from "node:assert/strict";
import { test } from "node:test";
import { collectionHealth } from "../src/collection-health.mjs";
import { assembleSnapshot, INTERVAL_MS, readSnapshot, START_AT } from "../src/collector.mjs";

const complete = (at, extra = {}) => ({ mode: "tse", serverNow: at,
  source: { ok: true, error: null, lastCompleteAt: at }, ...extra });

test("distingue antes das 17h da espera pela primeira rodada", () => {
  assert.deepEqual(collectionHealth(null, START_AT - 1),
    { state: "scheduled", lastCompleteAt: 0, error: null });
  assert.deepEqual(collectionHealth(null, START_AT),
    { state: "waiting_first", lastCompleteAt: 0, error: null });
});

test("distingue atualizado, rodada pendente e dado desatualizado", () => {
  const snapshot = complete(START_AT);
  assert.equal(collectionHealth(snapshot, START_AT + INTERVAL_MS - 1).state, "updated");
  assert.equal(collectionHealth(snapshot, START_AT + INTERVAL_MS).state, "updating");
  assert.equal(collectionHealth(snapshot, START_AT + 20 * 60 * 1000 + 1).state, "stale");
});

test("falha de leitura e coleta com erro não são tratadas como espera normal", () => {
  assert.equal(collectionHealth(null, START_AT + 1000, { readFailed: true }).state, "error");
  const snapshot = complete(START_AT, { source: { ok: false, error: "lote 2 falhou", lastCompleteAt: START_AT } });
  assert.deepEqual(collectionHealth(snapshot, START_AT + 1000),
    { state: "error", lastCompleteAt: START_AT, error: "lote 2 falhou" });
});

test("modo simulado é identificado separadamente", () => {
  assert.equal(collectionHealth({ mode: "fake", source: { ok: true } }, START_AT).state, "simulation");
});

test("última rodada válida não avança quando um lote falha", () => {
  const at = START_AT + INTERVAL_MS;
  const jobs = { "br-1": { totals: { pctSections: .1, votesLeft: 1, votesRight: 2 }, updatedAt: at } };
  const batches = Array.from({ length: 4 }, () => ({ checkedAt: at, jobs }));
  const first = assembleSnapshot(batches, at);
  assert.equal(first.source.lastCompleteAt, at);
  batches[2] = { ...batches[2], error: "HTTP 503" };
  const second = assembleSnapshot(batches, at + INTERVAL_MS, first);
  assert.equal(second.source.ok, false);
  assert.equal(second.source.lastCompleteAt, at);
  assert.equal(second.source.lastSuccessAt, at);
});

test("snapshot legado preserva o horário da coleta ao ser lido e detecta atraso", async () => {
  const at = START_AT + INTERVAL_MS;
  const stored = { serverNow: at, nextRefreshAt: at + INTERVAL_MS,
    source: { ok: true, error: null, lastSuccessAt: at } };
  const kv = { async get() { return stored; } };
  const fresh = await readSnapshot(kv, at + 1000);
  assert.equal(fresh.source.lastCompleteAt, at);
  assert.equal(collectionHealth(fresh, at + 1000).state, "updated");
  const stale = await readSnapshot(kv, at + 20 * 60 * 1000 + 1);
  assert.equal(stale.source.lastCompleteAt, at);
  assert.equal(collectionHealth(stale, at + 20 * 60 * 1000 + 1).state, "stale");
});
