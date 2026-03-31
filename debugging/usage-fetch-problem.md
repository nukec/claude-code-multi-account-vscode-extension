# Debug Log: Usage % Fetch Problem

**Date:** 2026-03-31
**Status:** Unsolved — blocked

---

## What We're Trying To Do

Fetch the Claude Pro usage % (e.g. `33%`) for each account and display it in the sidebar. The `/usage` command only works inside the Claude REPL (interactive mode), not as a CLI flag.

---

## What Works

- Running `node dist/pty-worker.js <accountPath>` **directly in a terminal** → outputs correct `33%`
- VS Code shell integration `echo HELLO_TEST` → captured correctly via `read()` stream
- Shell integration fires correctly even with `hideFromUser: true` disabled

---

## Approaches Tried (All Failed)

### 1. node-pty directly in extension process
- **Result:** Stole Windows focus — broke subsequent sidebar clicks
- **Root cause:** conpty creates a console host that takes OS-level focus

### 2. node-pty in detached child process (`pty-worker.ts`) with `windowsHide: true`
- **Result:** Exit code 1, empty stdout
- **Root cause:** `windowsHide: true` sets `CREATE_NO_WINDOW` — process has no console, conpty's `AttachConsole` fails

### 3. node-pty in child process with `detached: true` (no windowsHide)
- **Result:** Exit code 1, empty stdout from extension. Works fine when run directly in terminal.
- **Root cause:** VS Code extension host has no Windows console. Child inherits no console. node-pty (both conpty and winpty backends with `useConpty: false`) requires a console session.

### 4. node-pty worker spawned via hidden VS Code terminal shell integration
- **Result:** Exit code 1, empty stdout — same failure
- **Root cause:** Even inside `hideFromUser: true` terminal, the nested node process that runs node-pty still can't get a console for conpty

### 5. Run `claude` directly via shell integration `executeCommand`
- **Result:** `read()` stream yields empty output, for-await never resolves
- **Root cause:** `executeCommand` captures output from commands that print-and-exit. Claude is interactive and doesn't exit — stream never yields data.

### 6. `echo /usage | claude` via shell integration
- **Result:** Shell integration fires, but `read()` stream times out (20s) with no output
- **Status:** Currently being debugged — need to see what the visible terminal shows

---

## Key Technical Facts

- Claude stores auth in `USERPROFILE/.claude.json` only — no Windows Credential Manager
- `USERPROFILE`/`HOME` overrides work correctly and reach the terminal shell
- Account switching works — the click/focus/terminal issue is fully solved
- Email detection works — instant from `.claude.json`
- The pty-worker itself is correct — `33%` output confirmed when run directly

---

## Hypotheses for Next Session

1. **`echo /usage | claude`** — check visible terminal: does claude start? does it show usage? does it exit? The `read()` stream might work but timeout before claude exits.
2. **`printf '/usage\nexit\n' | claude`** — pipe both `/usage` and `/exit` so claude exits cleanly
3. **Write to temp file** — `node pty-worker.js <path> > /tmp/usage.txt`, poll for file, read result
4. **Fetch-only-on-refresh** (option 3 fallback) — don't auto-fetch on click, only on explicit Refresh button press, accepting a brief visible terminal flash

---

## Current Code State

- `src/pty-worker.ts` — standalone PTY worker, works when run directly
- `getUsageViaPty()` in `extension.ts` — currently using shell integration approach (approach 6 above)
- `hideFromUser` is commented out for debugging
