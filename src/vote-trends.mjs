const MAX_POINTS = 144;
const MAX_ALERTS = 100;
const BASELINE_POINTS = 12;
const MIN_BASELINE = 5;

function votes(national) {
  const left = Number(national?.votesLeft);
  const right = Number(national?.votesRight);
  if (!Number.isFinite(left) || !Number.isFinite(right) || left < 0 || right < 0) return null;
  const sections = national?.pctSections == null ? NaN : Number(national.pctSections);
  return { left, right, total: left + right,
    sections: Number.isFinite(sections) && sections >= 0 && sections <= 1 ? sections : null };
}

export function updateVoteTrend(previous, national, at, intervalMs = 600000, valid = true) {
  const history = Array.isArray(previous?.history) ? previous.history.slice(-MAX_POINTS) : [];
  const alerts = Array.isArray(previous?.alerts)
    ? previous.alerts.filter(alert => alert?.severity === "alert").slice(-MAX_ALERTS) : [];
  if (!valid || !Number.isFinite(at)) return { history, alerts };
  const current = votes(national);
  if (!current) return { history, alerts };

  // A snapshot published before this feature may have national totals but no history.
  if (!history.length && previous?.source?.ok && previous.serverNow < at) {
    const old = votes(previous.national);
    if (old) history.push({ at: previous.serverNow, totalVotes: old.total,
      leftVotes: old.left, rightVotes: old.right, pctSections: old.sections, newVotes: null });
  }
  const last = history.at(-1);
  if (last && at <= last.at) return { history, alerts };
  const leftDelta = last ? current.left - last.leftVotes : 0;
  const rightDelta = last ? current.right - last.rightVotes : 0;
  const comparable = last && at - last.at <= intervalMs * 1.5 &&
    leftDelta >= 0 && rightDelta >= 0;
  const newVotes = comparable ? leftDelta + rightDelta : null;
  const point = { at, totalVotes: current.total, leftVotes: current.left,
    rightVotes: current.right, pctSections: current.sections, newVotes };
  const sectionsDeltaPct = comparable && current.sections !== null &&
    Number.isFinite(last.pctSections) && current.sections >= last.pctSections
    ? (current.sections - last.pctSections) * 100 : null;
  if (newVotes !== null) {
    const baseline = history.map(item => item.newVotes)
      .filter(value => Number.isFinite(value) && value >= 0).slice(-BASELINE_POINTS);
    if (baseline.length >= MIN_BASELINE) {
      const mean = baseline.reduce((sum, value) => sum + value, 0) / baseline.length;
      const stddev = Math.sqrt(baseline.reduce((sum, value) => sum + (value - mean) ** 2, 0) / baseline.length);
      if (Math.abs(newVotes - mean) > stddev) {
        point.mean = mean;
        point.stddev = stddev;
        point.severity = Math.abs(newVotes - mean) > 3 * stddev ? "alert" : "variation";
      }
      if (point.severity === "alert") {
        const winner = rightDelta > leftDelta ? "direita" : leftDelta > rightDelta ? "esquerda" : "empate";
        alerts.push({ id: `votes-${at}`, at, votes: newVotes, winner, severity: "alert",
          direction: newVotes > mean ? "acima" : "abaixo", mean, stddev,
          lower: Math.max(0, mean - 3 * stddev), upper: mean + 3 * stddev,
          newLeft: leftDelta, newRight: rightDelta, sectionsDeltaPct });
        if (alerts.length > MAX_ALERTS) alerts.splice(0, alerts.length - MAX_ALERTS);
      }
    }
  }
  history.push(point);
  if (history.length > MAX_POINTS) history.splice(0, history.length - MAX_POINTS);
  return { history, alerts };
}
