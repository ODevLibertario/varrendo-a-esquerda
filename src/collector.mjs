import tse from "../lib/tse.js";
import { updateVoteTrend } from "./vote-trends.mjs";

const { UFS, OFFICES, depEstadualCargo, resultUrl, indexParties, parseResult, raceSummary, eventsFrom, emptyStates } = tse;
export const PHASE_COUNT = 4;
export const INTERVAL_MS = 10 * 60 * 1000;
export const CRONS = ["*/10 * * * *", "1-59/10 * * * *", "2-59/10 * * * *", "3-59/10 * * * *"];
const MAX_BODY_BYTES = 16 * 1024 * 1024;
export const START_AT = Date.parse("2026-10-04T20:00:00Z");
const STOP_AT = Date.parse("2026-10-06T03:00:00Z");
const batchKey = phase => `batch:v2:${phase}`;
const snapshotKey = "snapshot:v2";
const controlKey = "control:v2";

export function electionConfig(configFile, env = {}) {
  const config = structuredClone(configFile);
  const election = String(env.ELEICAO || config.eleicao || "2026");
  if (!config.eleicoes?.[election]) throw new Error(`Perfil eleitoral desconhecido: ${election}`);
  config.tse = { ...config.tse, ...config.eleicoes[election] };
  if (env.TSE_BASE) config.tse.base = String(env.TSE_BASE).replace(/\/$/, "");
  return config;
}

export function allJobs(config) {
  const t = config.tse, fed = t.elections.federal, est = t.elections.estadual;
  const jobs = [{ key: "br-1", uf: "BR", office: 1, election: fed }];
  for (const uf of UFS) {
    jobs.push({ key: `${uf}-1`, uf, office: 1, election: fed });
    for (const office of [3, 5, 6, 7]) {
      const actualOffice = office === 7 ? depEstadualCargo(uf) : office;
      jobs.push({ key: `${uf}-${office === 7 ? "dep" : office}`, uf, office: actualOffice, election: est });
    }
  }
  return jobs.map(job => ({ ...job, url: resultUrl(t, { cycle: t.cycle || t.fallbackCycle, ele: job.election, uf: job.uf, cargo: job.office }) }));
}

export function phaseJobs(config, phase) {
  if (!Number.isInteger(phase) || phase < 0 || phase >= PHASE_COUNT) throw new Error("Fase inválida");
  const jobs = allJobs(config);
  const size = Math.ceil(jobs.length / PHASE_COUNT);
  return jobs.slice(phase * size, (phase + 1) * size);
}

async function boundedJson(response) {
  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_BODY_BYTES) throw new Error("Arquivo TSE grande demais");
  if (!response.body) throw new Error("Resposta TSE sem corpo");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let size = 0, body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) throw new Error("Arquivo TSE grande demais");
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  return JSON.parse(body);
}

async function fetchJob(job, prior, config, partiesIndex, fetchImpl, now) {
  const headers = { accept: "application/json" };
  if (prior?.url === job.url && prior.etag) headers["if-none-match"] = prior.etag;
  if (prior?.url === job.url && prior.lastModified) headers["if-modified-since"] = prior.lastModified;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.tse.timeoutMs || 15000);
  try {
    const response = await fetchImpl(job.url, { headers, signal: controller.signal });
    if (response.status === 304 && prior) return prior;
    if (!response.ok) {
      await response.body?.cancel();
      const error = new Error(`HTTP ${response.status} ${job.url}`);
      error.status = response.status;
      throw error;
    }
    const parsed = parseResult(await boundedJson(response), partiesIndex, job.uf);
    const office = OFFICES[job.office];
    const isPresident = job.office === 1;
    const freshEvents = job.uf === "BR" || !isPresident
      ? eventsFrom(parsed, { office, uf: job.uf, minEventPct: config.tse.minEventPct ?? .03,
          isPresident, winsOnly: job.office === 6 || job.office === 7 || job.office === 8 })
      : [];
    const seen = new Map((prior?.events || []).map(event => [event.id, event]));
    const events = freshEvents.map(event => ({ ...event, at: seen.get(event.id)?.at || now() }));
    return {
      url: job.url, etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified"),
      totals: { pctSections: parsed.pctSections, votesLeft: parsed.votesLeft, votesRight: parsed.votesRight },
      race: isPresident ? null : raceSummary(parsed, office), events, updatedAt: now(),
    };
  } finally { clearTimeout(timeout); }
}

export function assembleSnapshot(batches, now = Date.now(), previous = null) {
  const states = emptyStates(), races = {}, events = [];
  let national = { pctSections: 0, votesLeft: 0, votesRight: 0 };
  let refreshedAt = 0, lastSuccessAt = 0;
  const errors = [];
  for (let phase = 0; phase < PHASE_COUNT; phase++) {
    const batch = batches[phase];
    if (!batch) { errors.push(`lote ${phase} ausente`); continue; }
    if (batch.error) errors.push(`lote ${phase}: ${batch.error}`);
    if (!batch.checkedAt || now - batch.checkedAt > 20 * 60 * 1000) errors.push(`lote ${phase} desatualizado`);
    if (!batch.error) lastSuccessAt = Math.max(lastSuccessAt, batch.checkedAt || 0);
    for (const [key, item] of Object.entries(batch.jobs || {})) {
      if (!item?.totals) continue;
      refreshedAt = Math.max(refreshedAt, item.updatedAt || 0);
      if (key === "br-1") national = item.totals;
      else if (key.endsWith("-1")) states[key.slice(0, 2)] = item.totals;
      if (item.race) (races[key.slice(0, 2)] ||= []).push(item.race);
      if (item.events) events.push(...item.events);
    }
  }
  if (!refreshedAt) errors.push("nenhum resultado do TSE disponível");
  events.sort((a, b) => b.at - a.at);
  const latestCheck = Math.max(0, ...batches.map(batch => batch?.checkedAt || 0));
  const sourceOk = errors.length === 0;
  const trend = updateVoteTrend(previous, national, now, INTERVAL_MS, sourceOk);
  return {
    mode: "tse", serverNow: now, refreshedAt,
    nextRefreshAt: errors.length ? now + 30000 : latestCheck + INTERVAL_MS,
    intervalSec: INTERVAL_MS / 1000, national, states, races, events: events.slice(0, 1000),
    ...trend,
    source: { ok: sourceOk, error: errors.length ? errors.slice(0, 3).join("; ") : null,
      lastSuccessAt, lastCompleteAt: sourceOk ? now :
        (previous?.source?.lastCompleteAt || (previous?.source?.ok ? previous.serverNow : 0) || 0) },
  };
}

export async function readSnapshot(kv, now = Date.now()) {
  const snapshot = await kv.get(snapshotKey, "json");
  if (!snapshot) return null;
  const stale = now - snapshot.serverNow > 20 * 60 * 1000;
  const source = { ...snapshot.source, lastCompleteAt: snapshot.source?.lastCompleteAt ||
    (snapshot.source?.ok ? snapshot.serverNow : 0) || 0 };
  return { ...snapshot, serverNow: now,
    nextRefreshAt: stale ? now + 30000 : Math.max(now + 1000, snapshot.nextRefreshAt),
    source: stale ? { ...source, ok: false, stale: true, error: "Coleta desatualizada" } : source };
}

export async function collectPhase({ kv, phase, config, parties, fetchImpl = fetch, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const startedAt = now();
  if (startedAt < START_AT || startedAt > STOP_AT) return { skipped: "fora da janela eleitoral" };
  const slot = Math.floor(startedAt / INTERVAL_MS);
  const [oldBatch, control] = await Promise.all([
    kv.get(batchKey(phase), "json"), kv.get(controlKey, "json"),
  ]);
  if (oldBatch?.slot === slot) return { skipped: "lote já coletado" };
  if (control?.blockedUntil > startedAt) return { skipped: "TSE em espera após bloqueio" };
  if (phase > 0) {
    const first = await kv.get(batchKey(0), "json");
    if (!first?.jobs?.["br-1"]?.totals || first.slot !== slot || first.error?.includes("HTTP 404")) {
      return { skipped: "arquivo nacional ainda indisponível" };
    }
  }

  const previous = oldBatch || { jobs: {} };
  const current = { slot, checkedAt: startedAt, jobs: { ...previous.jobs }, error: null };
  const partyIndex = indexParties(parties);
  let lastRequestAt = 0, failures = 0;
  const errors = [];
  for (const job of phaseJobs(config, phase)) {
    const prior = current.jobs[job.key];
    if (prior?.missing && prior.url === job.url && now() < prior.retryAt) {
      errors.push(`HTTP 404 ${job.url}`);
      continue;
    }
    const delay = lastRequestAt + Math.max(150, config.tse.requestSpacingMs || 150) - now();
    if (delay > 0) await sleep(delay);
    lastRequestAt = now();
    try {
      current.jobs[job.key] = await fetchJob(job, prior, config, partyIndex, fetchImpl, now);
      failures = 0;
    } catch (error) {
      errors.push(error.message);
      if (error.status === 404 && job.key !== "br-1") {
        current.jobs[job.key] = { ...prior, url: job.url, missing: true, retryAt: now() + 30 * 60 * 1000 };
      }
      if (job.key === "br-1" && error.status === 404) {
        await kv.put(controlKey, JSON.stringify({ blockedUntil: now() + 60 * 60 * 1000 }));
      }
      if (error.status === 403 || error.status === 429) {
        await kv.put(controlKey, JSON.stringify({ blockedUntil: now() + 10 * 60 * 1000 }));
        break;
      }
      if (job.key === "br-1" || (error.status !== 404 && ++failures >= 4)) break;
    }
  }
  current.checkedAt = now();
  current.error = errors.length ? `${errors.length} arquivo(s): ${errors.slice(0, 2).join("; ")}` : null;
  await kv.put(batchKey(phase), JSON.stringify(current));
  if (phase === PHASE_COUNT - 1) {
    const batches = await Promise.all(Array.from({ length: PHASE_COUNT }, (_, index) =>
      index === phase ? current : kv.get(batchKey(index), "json")));
    if (batches.every(batch => batch?.slot === slot)) {
      const previousSnapshot = await kv.get(snapshotKey, "json");
      await kv.put(snapshotKey, JSON.stringify(assembleSnapshot(batches, now(), previousSnapshot)));
    }
  }
  return { phase, fetched: phaseJobs(config, phase).length, errors: errors.length, checkedAt: current.checkedAt };
}
