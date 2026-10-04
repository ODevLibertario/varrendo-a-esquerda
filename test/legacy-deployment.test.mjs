import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const legacyDir = fileURLToPath(new URL("../legacy-public/", import.meta.url));

test("legacy deployment is static and sends API polling to a local static response", async () => {
  const files = await readdir(legacyDir);
  assert.ok(!files.includes("_worker.js"));
  assert.ok(!files.includes("_routes.json"));

  const redirects = await readFile(new URL("../legacy-public/_redirects", import.meta.url), "utf8");
  const rules = redirects.trim().split(/\r?\n/).map((line) => line.trim().split(/\s+/));
  assert.deepEqual(rules[0], ["/api/*", "/api-paused.json", "302"]);
  assert.deepEqual(rules[1], ["/", "https://eleicoesbr.pages.dev/", "302"]);
  assert.deepEqual(rules[2], ["/index.html", "https://eleicoesbr.pages.dev/", "302"]);

  const paused = JSON.parse(await readFile(new URL("../legacy-public/api-paused.json", import.meta.url), "utf8"));
  assert.match(paused.error, /eleicoesbr\.pages\.dev/);
});
