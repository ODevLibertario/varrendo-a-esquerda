# AGENTS.md — how to run "Varrendo a Esquerda"

Local, throwaway live dashboard for Brazil's 2026 election (1st round, 4 Oct 2026, results from 17:00 Brasília).
One Node process polls the TSE public results files, serves the page, and pushes updates to the browser (SSE).

## Requirements

- **Node.js 22 or newer.** Nothing else: no `npm install`, no database, no build step, no Docker.
- Check: `node -v` (must print `v22.x` or higher).
- Install if missing:
  - Windows: `winget install OpenJS.NodeJS.LTS` (or the installer from https://nodejs.org)
  - macOS: `brew install node` (or the installer from https://nodejs.org)
  - Linux: use your distro's Node 22+ package, `nvm install 22`, or https://nodejs.org

Run every command below from this folder (the one containing `server.js`).

## Run

| What | bash / zsh (macOS, Linux) | PowerShell (Windows) | cmd (Windows) |
|---|---|---|---|
| Live TSE mode | `node server.js` | `node server.js` | `node server.js` |
| Demo (fake data) | `MODE=fake node server.js` | `$env:MODE="fake"; node server.js` | `set "MODE=fake" && node server.js` |
| TSE probe (one shot, prints URLs + parsed result, exits) | `node server.js --probe` | `node server.js --probe` | `node server.js --probe` |
| Other port | `PORT=9000 node server.js` | `$env:PORT="9000"; node server.js` | `set "PORT=9000" && node server.js` |
| Tests | `node --test` | `node --test` | `node --test` |

Then open **http://localhost:8090** (default port). Stop with Ctrl+C.
In PowerShell/cmd the variable stays set for the rest of that terminal; open a new terminal (or `Remove-Item Env:MODE` / `set MODE=`) to go back to live mode.

Other env vars: `INTERVAL_SEC` (TSE poll interval, default 300), `FAKE_INTERVAL_SEC` (demo refresh, default 20), `TSE_BASE` (point at a mirror/mock).
The refresh interval is decided by the server only; the page just shows the countdown.

## Files to edit

- `config.json`: port, intervals, TSE base URL, cycle (`ele2026`), election codes (6257 federal, 6259 state), URL template `tse.resultUrl`, `saveRawDir` (set e.g. `"raw"` to keep every fetched JSON).
- `parties.json`: which party is right (`"direita"`). Owner's rule: only the parties marked direita are right; everything else, including unknown parties, is left (`"padrao": "esquerda"`). `overrides` forces one candidate, e.g. `{ "sp:15": "direita" }`.
- `public/index.html`: the whole frontend (single file). `lib/tse.js`: TSE URLs + parsing + poller. `lib/fake.js`: demo data.

## TSE rules (do not break these)

- Only the server talks to TSE. **Never** make the browser call `resultados.tse.jus.br`.
- TSE allows 100 requests/s per IP and blocks the IP for ~10 min if exceeded; 304s count too. The poller does ~136 sequential requests per cycle, 150 ms apart. Don't lower the spacing or the interval aggressively.
- **Never probe or guess URLs.** Repeated 404s can also get the IP blocked. Build URLs only from `config.json`; if `--probe` shows a 404, fix `tse.resultUrl` instead of retrying.
- Before 17:00 Brasília the files may have no votes yet; that is normal.

## Troubleshooting

- `EADDRINUSE`: the port is taken, use `PORT=...` (default 8090).
- Page says "Fonte TSE indisponível": TSE errored; the page keeps the last good data. Check the server log.
- Fonts look plain offline: Google Fonts is optional.
