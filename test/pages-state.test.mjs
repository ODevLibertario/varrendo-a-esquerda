import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { START_AT } from "../src/collector.mjs";

const workerSource = await readFile(new URL("../public/_worker.js", import.meta.url), "utf8");
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(workerSource).toString("base64")}`);

async function atTime(now, path, kv) {
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    return await worker.fetch(new Request(`https://example.com${path}`), { RESULTS: kv });
  } finally {
    Date.now = originalNow;
  }
}

test("antes das 17h a API oficial não lê o KV, inclusive no endpoint de eventos", async () => {
  const kv = { async get() { throw new Error("KV não deve ser lido"); } };
  for (const path of ["/api/state", "/api/events"]) {
    const response = await atTime(START_AT - 1, path, kv);
    assert.equal(response.status, 503);
    const body = path === "/api/events"
      ? JSON.parse((await response.text()).split("data: ")[1].trim())
      : await response.json();
    assert.equal(body.collection.state, "scheduled");
  }
});

test("às 17h a API passa a ler o KV e informa primeira rodada pendente", async () => {
  let reads = 0;
  const kv = { async get(key) { assert.equal(key, "snapshot:v2"); reads++; return null; } };
  const response = await atTime(START_AT, "/api/state", kv);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).collection.state, "waiting_first");
  assert.equal(reads, 1);
});

test("modo simulado funciona antes das 17h sem ler o KV", async () => {
  const kv = { async get() { throw new Error("KV não deve ser lido"); } };
  const response = await atTime(START_AT - 1, "/api/state?mode=fake", kv);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).collection.state, "simulation");
});
