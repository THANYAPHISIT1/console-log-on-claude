# console-log-on-claude

Local bridge ให้ Claude Code "มองเห็น" console + network (fetch/XHR) ของ browser
โดยไม่ต้องให้ Claude grep/tail log ดิบทีละบรรทัด — bridge **dedup + group + นับ count** ให้แล้ว

ใช้งานผ่าน CLI `clc` (standalone binary, ไม่ต้องมี Bun/Node ในเครื่องปลายทาง)

```
Browser tab ──POST──▶  clc :3737  ◀──HTTP──  Claude (clc summary / clc logs)
                          │
                          ├──▶ logs.jsonl
                          └──▶ summary.json
```

## Build

```bash
bun install
bun run build         # build public/capture.js
bun run build:bin     # → dist/clc (native, ~58 MB)

# cross-compile ทั้ง macOS arm64 + x64:
bun run build:bin:all # → dist/clc-darwin-arm64, dist/clc-darwin-x64
```

ถ้าไม่ compile ก็รันจาก source ได้เลย: `bun run src/cli.ts start`

## Install (เรียก `clc` ได้จากทุก directory)

```bash
bun run install:bin   # build:bin + symlink → ~/.local/bin/clc
```

ถ้า `~/.local/bin` ยังไม่อยู่ใน PATH script จะเตือนให้ใส่บรรทัดนี้ใน `~/.zshrc`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

ต้องการติดตั้งที่อื่น: `CLC_INSTALL_DIR=/usr/local/bin bun run install:bin`
(อาจต้องใช้ `sudo` ขึ้นกับสิทธิ์ของ directory นั้น)

## Quick start

```bash
clc start                  # เริ่ม bridge + dashboard (foreground)
clc start --no-dashboard   # headless
```

ถ้ายังไม่ได้ install สามารถเรียก `./dist/clc start` ตรงๆ ได้

ใส่ใน HTML ของแอปที่จะ debug (หรือใช้ `clc snippet` สร้างให้):

```html
<script src="http://127.0.0.1:3737/capture.js" data-session="my-app"></script>
```

Options บน `<script>` (dataset หรือ query string):

- `data-session="name"` — แยก session
- `data-levels="warn,error"` — filter console levels (default ทุก level)
- `data-endpoint="http://..."` — override ingest URL

## CLI

```
clc start     [--port 3737] [--host 127.0.0.1] [--data-dir .] [--no-dashboard]
clc status    [--port 3737] [--host 127.0.0.1]
clc summary   [--kind console|network] [--level err,warn] [--method GET,POST]
              [--status-min 400] [--status-max 599] [--url-pattern regex] [--limit 50]
clc logs      [--kind console|network] [--level err,warn] [--tail 20] [--grep regex]
clc clear
clc snippet   [--session my-app] [--levels warn,error] [--port 3737] [--host 127.0.0.1]
clc help
```

`start` รัน server + dashboard (foreground) — คำสั่งอื่นทั้งหมดเป็น stateless HTTP call
ไปยัง running server

**Exit codes:** `0` ok · `1` error · `2` server unreachable

## Dashboard

รันอยู่บน terminal ตอน `clc start` — อัปเดตทุก 500ms

```
clc  ·  http://127.0.0.1:3737  ·  uptime 00:05:23
────────────────────────────────────────────────────
totals  console: 142  (err 3 · warn 8 · info 12 · log 119 · debug 0)
        network:  38  (ok 33 · err 5)
────────────────────────────────────────────────────
TOP CONSOLE  [level: all]
  ×  3  error  TypeError: Cannot read x of undefined
  ×  8  warn   deprecated API /foo
────────────────────────────────────────────────────
TOP NETWORK
  ×  5  GET   /api/users/<n>   404  p50=123ms p95=450ms
  ×  2  POST  /api/login       500  p50=80ms  p95=80ms
────────────────────────────────────────────────────
LIVE TAIL
  14:22:01 C ERR TypeError: Cannot read x ...
  14:22:03 N GET /api/users/42    404  123ms

[q]uit  [c]lear  [p]ause  [f]level(all)  [/]grep
```

**Keybindings:**
- `q` — quit
- `c` — clear (store + logs.jsonl + summary.json)
- `p` — pause re-render
- `f` — cycle level filter (all → err → err+warn → all)
- `/` — grep prompt (Enter=confirm, Esc=cancel, `/` ซ้ำ=clear grep)

## How Claude should consume this

Claude เรียกผ่าน `clc` subcommand — output เป็น JSON ที่ stdout ทั้งหมด

**เริ่มจาก `clc summary` เสมอ** (grouped/counted แล้ว):

```bash
clc summary --limit 20
clc summary --kind console --level error
clc summary --kind network --status-min 400 --url-pattern '/api/'
```

**Deep-dive** เมื่อต้อง trace timing/sequence:

```bash
clc logs --grep "TypeError" --tail 20
clc logs --kind network --level error --tail 50
```

**Reset ก่อนเริ่ม session ใหม่:**

```bash
clc clear
```

## HTTP API

ถ้าอยาก integrate ตรงๆ โดยไม่ผ่าน CLI:

| Method | Path | Purpose |
|---|---|---|
| GET  | `/capture.js` | เสิร์ฟ browser snippet |
| POST | `/ingest` | รับ `{events: Event[]}` จาก capture.js |
| GET  | `/summary` | grouped snapshot (same shape as summary.json) |
| GET  | `/summary?kind=console&level=error&limit=20` | filter |
| GET  | `/summary?kind=network&statusMin=400&urlPattern=/api/` | filter |
| GET  | `/logs?tail=50&level=error&grep=...` | ring buffer (last 200 events) |
| POST | `/clear` | reset ทั้งหมด |
| GET  | `/healthz` | liveness + uptime |

## Grouping rules

**Console:** signature = `level + hash(normalized message)` โดย normalize:
- เลข → `<n>` (e.g. `user 42` → `user <n>`)
- UUID → `<uuid>`
- ISO timestamp → `<ts>`
- hex → `<hex>`

**Network:** signature = `api + method + urlPattern + status`
- Path ตัด query string, `/42/` → `/<n>/`, `/<uuid>/`, `/<hash>/`

→ `GET /api/users/1`, `/api/users/2`, `/api/users/3` = **1 group count=3**

## Defaults

- Port `3737`, bind `127.0.0.1` (localhost only)
- Data dir = CWD (logs.jsonl, summary.json เขียนที่ directory ที่รัน `clc start`)
- Cap 100 groups ต่อ kind (drop ตัว count น้อย + เก่าก่อน)
- Ring buffer (`/logs`) เก็บ 200 events ล่าสุด
- Batch 200ms / 20 events (capture side); summary flush debounce 500ms
- Body ของ request ไม่เก็บ — เฉพาะ method/url/status/headers/duration
# -console-log-on-claude
