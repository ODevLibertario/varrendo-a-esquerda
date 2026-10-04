import configFile from "../config.json";
import parties from "../parties.json";
import { emptyStates } from "../lib/tse.js";
import { createFake } from "../lib/fake.js";
import { readSnapshot } from "./collector.mjs";
import { updateVoteTrend } from "./vote-trends.mjs";
import { collectionHealth } from "./collection-health.mjs";

function emptySnapshot(mode, now, intervalSec) {
  return {
    mode, serverNow: now, refreshedAt: 0, nextRefreshAt: now + intervalSec * 1000, intervalSec,
    national: { pctSections: 0, votesLeft: 0, votesRight: 0 },
    states: emptyStates(), races: {}, events: [], history: [], alerts: [],
    source: { ok: false, error: "Aguardando a primeira coleta do TSE", lastSuccessAt: 0 },
  };
}

function fakeSnapshot(now) {
  const intervalMs = Math.max(10000, Number(configFile.fakeIntervalSec || 20) * 1000);
  const bucket = Math.floor(now / intervalMs);
  const period = Math.floor(bucket / 30);
  const steps = bucket % 30;
  let simulatedNow = period * 30 * intervalMs;
  const fake = createFake(parties, { idPrefix: `pages-${period}`, now: () => simulatedNow });
  let trend = updateVoteTrend(null, fake.data().national, simulatedNow, intervalMs);
  for (let step = 0; step < steps; step++) {
    simulatedNow += intervalMs;
    fake.step();
    trend = updateVoteTrend(trend, fake.data().national, simulatedNow, intervalMs);
  }
  return { ...fake.data(), mode: "fake", serverNow: now, refreshedAt: bucket * intervalMs,
    nextRefreshAt: (bucket + 1) * intervalMs, intervalSec: intervalMs / 1000,
    ...trend,
    source: { ok: true, error: null, lastSuccessAt: bucket * intervalMs } };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function stateResponse(request, env) {
  const url = new URL(request.url);
  const mode = String(url.searchParams.get("mode") || env.MODE || configFile.mode || "tse").toLowerCase() === "fake" ? "fake" : "tse";
  const now = Date.now();
  if (mode === "fake") {
    const snapshot = fakeSnapshot(now);
    return jsonResponse({ ...snapshot, collection: collectionHealth(snapshot, now) });
  }
  try {
    const snapshot = await readSnapshot(env.RESULTS, now);
    if (snapshot) return jsonResponse({ ...snapshot, collection: collectionHealth(snapshot, now) });
    return jsonResponse({ ...emptySnapshot(mode, now, 30), collection: collectionHealth(null, now) }, 503);
  } catch (error) {
    console.error(JSON.stringify({ event: "snapshot_read_failed", error: String(error) }));
    return jsonResponse({ ...emptySnapshot(mode, now, 30), collection: collectionHealth(null, now, { readFailed: true }),
      source: { ok: false, error: "Não foi possível ler a apuração", lastSuccessAt: 0 } }, 503);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/state") {
      return request.method === "GET" ? stateResponse(request, env) : new Response(null, { status: 405 });
    }
    if (url.pathname === "/api/events") {
      if (request.method !== "GET") return new Response(null, { status: 405 });
      const response = await stateResponse(new Request(new URL("/api/state" + url.search, url), request), env);
      const body = `retry: 30000\nevent: snapshot\ndata: ${await response.text()}\n\n`;
      return new Response(body, { status: response.status,
        headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store" } });
    }
    if (url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
    return env.ASSETS.fetch(request);
  },
};
