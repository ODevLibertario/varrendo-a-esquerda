import assert from "node:assert/strict";
import { test } from "node:test";
import { assembleSnapshot } from "../src/collector.mjs";

const START = Date.parse("2026-10-04T20:00:00Z");
const TEN_MINUTES = 600000;

function batches(at, left, right, error = null) {
  return [
    { checkedAt: at, error, jobs: { "br-1": {
      totals: { pctSections: .5, votesLeft: left, votesRight: right }, updatedAt: at,
    } } },
    ...Array.from({ length: 3 }, () => ({ checkedAt: at, error: null, jobs: {} })),
  ];
}

test("registra alerta quando votos novos saem de média ±1 desvio padrão", () => {
  let previous = null;
  const totals = [1000, 1100, 1210, 1300, 1405, 1500, 1700];
  for (let index = 0; index < totals.length; index++) {
    const at = START + index * TEN_MINUTES;
    previous = assembleSnapshot(batches(at, 400, totals[index] - 400), at, previous);
  }
  assert.equal(previous.history.length, 7);
  assert.deepEqual(previous.history.map(point => point.newVotes), [null, 100, 110, 90, 105, 95, 200]);
  assert.equal(previous.alerts.length, 1);
  assert.equal(previous.alerts[0].votes, 200);
  assert.equal(previous.alerts[0].at, START + 6 * TEN_MINUTES);
  assert.equal(previous.alerts[0].winner, "direita");
  assert.equal(previous.alerts[0].direction, "acima");
});

test("não duplica ponto nem alerta ao publicar a mesma rodada novamente", () => {
  const at = START;
  const first = assembleSnapshot(batches(at, 400, 600), at);
  const again = assembleSnapshot(batches(at, 400, 600), at, first);
  assert.equal(again.history.length, 1);
  assert.equal(again.alerts.length, 0);
});

test("falha de coleta preserva o histórico e não inventa votos novos", () => {
  const first = assembleSnapshot(batches(START, 400, 600), START);
  const failed = assembleSnapshot(batches(START + TEN_MINUTES, 400, 600, "HTTP 503"), START + TEN_MINUTES, first);
  assert.equal(failed.source.ok, false);
  assert.deepEqual(failed.history, first.history);
  assert.deepEqual(failed.alerts, first.alerts);
});

test("queda no ritmo também gera alerta e informa o lado dos votos novos", () => {
  let previous = null;
  const increments = [100, 102, 98, 101, 99, 20];
  let left = 400, right = 600;
  previous = assembleSnapshot(batches(START, left, right), START);
  for (let index = 0; index < increments.length; index++) {
    left += increments[index];
    const at = START + (index + 1) * TEN_MINUTES;
    previous = assembleSnapshot(batches(at, left, right), at, previous);
  }
  assert.equal(previous.alerts.length, 1);
  assert.deepEqual([previous.alerts[0].votes, previous.alerts[0].direction, previous.alerts[0].winner],
    [20, "abaixo", "esquerda"]);
});

test("correções e lacunas não são confundidas com votos apurados no intervalo", () => {
  const first = assembleSnapshot(batches(START, 400, 600), START);
  const correction = assembleSnapshot(batches(START + TEN_MINUTES, 390, 600), START + TEN_MINUTES, first);
  assert.equal(correction.history.at(-1).newVotes, null);
  const afterGap = assembleSnapshot(batches(START + 4 * TEN_MINUTES, 450, 650), START + 4 * TEN_MINUTES, correction);
  assert.equal(afterGap.history.at(-1).newVotes, null);
  assert.equal(afterGap.alerts.length, 0);
});
