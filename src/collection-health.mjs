import { INTERVAL_MS, START_AT } from "./collector.mjs";

const STALE_MS = 20 * 60 * 1000;

export function collectionHealth(snapshot, now = Date.now(), { readFailed = false } = {}) {
  if (snapshot?.mode === "fake") return { state: "simulation", lastCompleteAt: 0, error: null };
  const source = snapshot?.source;
  const lastCompleteAt = source?.lastCompleteAt || (source?.ok ? snapshot.serverNow || 0 : 0);
  if (readFailed) return { state: "error", lastCompleteAt, error: "Não foi possível ler a apuração" };
  if (!snapshot) return { state: now < START_AT ? "scheduled" : "waiting_first", lastCompleteAt: 0, error: null };
  if (source?.stale || (lastCompleteAt && now - lastCompleteAt > STALE_MS)) {
    return { state: "stale", lastCompleteAt, error: source?.error || null };
  }
  if (source?.ok === false) return { state: "error", lastCompleteAt, error: source.error || null };
  return { state: lastCompleteAt && now - lastCompleteAt >= INTERVAL_MS ? "updating" : "updated",
    lastCompleteAt, error: null };
}
