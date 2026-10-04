import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const start = html.indexOf("/* ---------- atualização definida pelo servidor ---------- */");
assert.ok(start > 0);
const script = html.slice(start, html.indexOf("</script>", start));

function browser(initialVisibility = "visible") {
  let visibility = initialVisibility, requests = 0, timerId = 0;
  const timers = new Map(), handlers = {}, elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { style: {}, dataset: {}, addEventListener() {} });
    return elements.get(id);
  };
  const context = {
    document: { get visibilityState() { return visibility; }, getElementById: element,
      addEventListener(type, fn) { handlers[type] = fn; } },
    fxToggle: element("fxToggle"), localStorage: { getItem: () => null },
    location: { search: "", pathname: "/" }, URLSearchParams,
    UFS: [], state: {}, national: {}, races: {},
    render() {}, renderTrend() {}, renderPending() {}, lean: x => x,
    brTime: () => "", brDateTime: () => "", addEvent() {},
    console: { warn() {} },
    setInterval() {},
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async fetch() {
      requests++;
      return { ok: false, async json() { return {
        mode: "tse", serverNow: Date.now(), nextRefreshAt: Date.now() + 30000,
        source: { ok: false }, collection: { state: "scheduled", lastCompleteAt: 0 },
        national: {}, states: {}, races: {}, events: [], history: [], alerts: [],
      }; } };
    },
  };
  const ready = runInNewContext(script, context);
  return { ready, timers, get requests() { return requests; },
    setVisibility(value) { visibility = value; handlers.visibilitychange(); } };
}

test("aba visível consulta no máximo uma vez por minuto", async () => {
  const page = browser();
  await page.ready;
  assert.equal(page.requests, 1);
  assert.deepEqual([...page.timers.values()].map(timer => timer.ms), [60000]);
});

test("aba inicialmente oculta espera ficar visível antes de consultar", async () => {
  const page = browser("hidden");
  await page.ready;
  assert.equal(page.requests, 0);
  assert.equal(page.timers.size, 0);
  page.setVisibility("visible");
  await new Promise(setImmediate);
  assert.equal(page.requests, 1);
});

test("ocultar a aba cancela a próxima consulta", async () => {
  const page = browser();
  await page.ready;
  assert.equal(page.timers.size, 1);
  page.setVisibility("hidden");
  assert.equal(page.timers.size, 0);
});
