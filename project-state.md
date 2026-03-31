# Claude Code Multi-Account VSCode Extension — Project State

**Last updated:** 2026-03-31
**Last commit:** 266fe1b

---

## Goal

Build a VS Code extension that enables **multiple Claude Code CLI accounts** using **session isolation (NOT API keys)**, all running on Claude Pro ($20/month).

---

## Core Concept

Each account is isolated via its own directory inside VS Code's global storage:

```
globalStorageUri/claude-profiles/
  account1/
  account2/
  account3/
```

Each terminal and exec call runs with:

- `HOME` → account folder
- `USERPROFILE` → account folder  (Windows: Node.js reads this, not HOME)
- `XDG_CONFIG_HOME` → account folder
- `APPDATA` → account folder/AppData/Roaming
- `LOCALAPPDATA` → account folder/AppData/Local

Claude stores its auth in `~/.claude.json`. With all env vars overridden, each account gets a fully isolated config and session.

---

## Features Implemented

### 1. Account Management

- Add account → creates isolated folder
- Rename account → renames folder, updates state
- Delete account → removes folder with confirmation dialog
- All stored in `context.globalState`

### 2. Sidebar (Tree View UI)

```
● main    user@example.com (10%)     ← green circle, usage loads async
○ alt     Not logged in
```

- Green circle = logged in, usage < 70%
- Yellow circle = 70–89%
- Red circle = ≥ 90%
- Grey circle = not logged in
- Inline buttons: ✏️ Rename (left), 🗑 Delete (right) — visible on hover (VS Code platform limitation)
- Top bar: ➕ Add Account, 🔄 Refresh

### 3. Terminal Execution

Clicking a logged-in account:

1. Reads email instantly from `~/.claude.json` (via `USERPROFILE` override) → sidebar updates immediately
2. Opens terminal: `cwd = account folder`, env overridden as above, runs `claude`
3. In background: spawns hidden child process (`dist/pty-worker.js`) with `windowsHide: true`, which uses node-pty to send `/usage` and parse response, updates sidebar with usage % (~5–8s)

Clicking a not-logged-in account:

1. Opens Chrome incognito to `claude.ai`
2. Opens terminal, runs `claude` then `/logout` so user can log in fresh
3. When terminal closes → re-checks login status, updates sidebar

### 4. Email Detection

Reads directly from `USERPROFILE/.claude.json` → `oauthAccount.emailAddress`.

No exec call needed — instant and reliable.

### 5. Usage Detection

Uses a **detached hidden child process** (`dist/pty-worker.js`) to avoid conpty focus-stealing on Windows:

1. Extension spawns `node dist/pty-worker.js <accountPath>` with `windowsHide: true`
2. Worker spawns a PTY internally, runs `claude`, sends `/usage`, parses output
3. Result written to stdout, extension reads it and updates sidebar

**Known issue:** Usage % not working — 6 approaches tried, all failed. Full debug log in `debugging/usage-fetch-problem.md`. Next to try: `printf '/usage\nexit\n' | claude` or temp-file workaround.

### 6. Refresh Button

- Email: updates instantly for all accounts from `.claude.json`
- Usage: fetches all logged-in accounts in parallel via pty-worker

---

## Root Cause Discoveries (This Session)

### Click events only firing once
- **Cause:** `terminal.show()` without `preserveFocus: true` stole focus from the sidebar. Second click re-focused VS Code window instead of hitting the tree item.
- **Fix:** Always call `terminal.show(true)`.

### PTY breaking subsequent clicks
- **Cause:** `node-pty` uses Windows conpty which creates a console host process that steals OS-level focus, even when no terminal UI is shown.
- **Fix:** Moved PTY execution to a separate child process (`pty-worker.ts`) spawned with `windowsHide: true`, communicating results via stdout.

### Windows Credential Manager — not an issue
- Confirmed via `cmdkey /list`: Claude does NOT use Windows Credential Manager.
- All auth stored in `USERPROFILE/.claude.json` only — USERPROFILE override is sufficient for isolation.

---

## Architecture

```
src/
  extension.ts     — VS Code extension entry point, all commands + UI
  pty-worker.ts    — Standalone PTY worker, spawned as hidden child process
  utils.ts         — Pure functions (testable): accountEnv, parseEmailFromJson,
                     parseEmailFromConfig, readClaudeConfig, parseEmailAndUsageFromOutput
  test/
    utils.test.ts  — 35 unit tests (all passing)

dist/
  extension.js     — bundled extension
  pty-worker.js    — bundled PTY worker (separate entry point)
```

**Dependencies:**
- `node-pty` (runtime) — PTY for usage detection (used in pty-worker only)
- All else: VS Code API + Node.js built-ins only

---

## Session Work (2026-03-31)

- Written proper public-facing `README.md` (features, architecture, install instructions)
- Fixed `vsce package` warnings:
  - Added `repository` field to `package.json`
  - Changed activation event from `*` to `onView:claudeProfilesView`
  - Added `LICENSE` (MIT)
- Removed `*.vsix` from `.gitignore` so built packages are tracked
- Repo made public-ready
- Fixed terminal `cwd`: opening an account now uses the current VS Code workspace folder instead of the account profile folder, so `claude` starts in the user's project directory
- Renamed extension display name to "Claude Account Switcher" (activity bar title + `displayName` in `package.json`)
- Added launch mode quick-pick on account click: user chooses between `claude` (normal) or `claude --dangerously-skip-permissions` before terminal opens
- Added `@vscode/vsce` as dev dependency + `vsce:package` npm script so VSIX can be built via `node_modules/.bin/vsce package` without a global install
- Fixed env leak: terminal no longer has HOME/USERPROFILE overridden — isolation now handled by a per-account `launch-claude.cmd` wrapper (uses `setlocal`/`endlocal` to scope env to the claude process only). Git, SSH, npm all work normally in the terminal.

---

## Known Issues / Pending

1. **Usage % not showing** — pty-worker spawned but result not reaching sidebar. Needs debugging.
2. **Inline button visibility** — Edit/delete buttons only visible on hover. VS Code platform limitation, cannot be changed via contribution points.
3. **Login flow** — After clicking a not-logged-in account, user must log in manually via browser. Sidebar updates when terminal is closed.

---

## Future Ideas

- Auto-switch account based on usage hitting threshold
- Per-project account binding (`.claude-account` file)
- Multi-terminal orchestration
- Hotkey account switching
