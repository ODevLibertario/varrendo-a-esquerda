const MAX_POINTS = 144;
const MAX_ALERTS = 100;
const BASELINE_POINTS = 12;
const MIN_BASELINE = 5;

function votes(national) {
  const left = Number(national?.votesLeft);
  const right = Number(national?.votesRight);
  if (!Number.isFinite(left) || !Number.isFinite(right) || left < 0 || right < 0) return null;
  return { left, right, total: left + right };
}

export function updateVoteTrend(previous, national, at, intervalMs = 600000, valid = true) {
  const history = Array.isArray(previous?.history) ? previous.history.slice(-MAX_POINTS) : [];
  const alerts = Array.isArray(previous?.alerts) ? previous.alerts.slice(-MAX_ALERTS) : [];
  if (!valid || !Number.isFinite(at)) return { history, alerts };
  const current = votes(national);
  if (!current) return { history, alerts };

  // A snapshot published before this feature may have national totals but no history.
  if (!history.length && previous?.source?.ok && previous.serverNow < at) {
    const old = votes(previous.national);
    if (old) history.push({ at: previous.serverNow, totalVotes: old.total,
      leftVotes: old.left, rightVotes: old.right, newVotes: null });
  }
  const last = history.at(-1);
  if (last && at <= last.at) return { history, alerts };
  const leftDelta = last ? current.left - last.leftVotes : 0;
  const rightDelta = last ? current.right - last.rightVotes : 0;
  const comparable = last && at - last.at <= intervalMs * 1.5 &&
    leftDelta >= 0 && rightDelta >= 0;
  const newVotes = comparable ? leftDelta + rightDelta : null;
  const point = { at, totalVotes: current.total, leftVotes: current.left,
    rightVotes: current.right, newVotes };
  if (newVotes !== null) {
    const baseline = history.map(item => item.newVotes)
      .filter(value => Number.isFinite(value) && value >= 0).slice(-BASELINE_POINTS);
    if (baseline.length >= MIN_BASELINE) {
      const mean = baseline.reduce((sum, value) => sum + value, 0) / baseline.length;
      const stddev = Math.sqrt(baseline.reduce((sum, value) => sum + (value - mean) ** 2, 0) / baseline.length);
      if (Math.abs(newVotes - mean) > stddev) {
        const winner = rightDelta > leftDelta ? "direita" : leftDelta > rightDelta ? "esquerda" : "empate";
        point.outlier = true;
        alerts.push({ id: `votes-${at}`, at, votes: newVotes, winner,
          direction: newVotes > mean ? "acima" : "abaixo", mean, stddev });
        if (alerts.length > MAX_ALERTS) alerts.splice(0, alerts.length - MAX_ALERTS);
      }
    }
  }
  history.push(point);
  if (history.length > MAX_POINTS) history.splice(0, history.length - MAX_POINTS);
  return { history, alerts };
}
