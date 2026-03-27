# Claude Code Multi-Account VSCode Extension — Project State

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

Claude stores its auth in `~/.claude.json`. With all three vars overridden, each account gets a fully isolated config and session.

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
- Inline buttons: ✏️ Rename (left), 🗑 Delete (right)
- Top bar: ➕ Add Account, 🔄 Refresh

### 3. Terminal Execution

Clicking a logged-in account:

1. Reads email instantly from `~/.claude.json` (via `USERPROFILE` override) → sidebar updates immediately
2. Opens terminal: `cwd = account folder`, env overridden as above, runs `claude`
3. In background: spawns hidden PTY via `node-pty`, sends `/usage`, parses response, updates sidebar with usage % (~3–5s)

Clicking a not-logged-in account:

1. Opens Chrome incognito to `claude.ai`
2. Opens terminal, runs `claude` then `/logout` so user can log in fresh
3. When terminal closes → re-checks login status, updates sidebar

### 4. Email Detection

Reads directly from `USERPROFILE/.claude.json` → `oauthAccount.emailAddress`.

Falls back to real system home (`C:\Users\{user}\.claude.json`) for accounts logged in before USERPROFILE isolation was added.

No exec call needed — instant and reliable.

### 5. Usage Detection

Uses `node-pty` to spawn a real PTY (required because `/usage` is a TTY-only REPL command):

1. Spawns `cmd.exe /c claude` in a hidden PTY with account env
2. Waits for Claude welcome screen
3. Sends `/usage`
4. Parses output: prefers "Current week" percentage over session percentage
5. Kills PTY, updates sidebar

### 6. Refresh Button

- Email: updates instantly for all accounts from `.claude.json`
- Usage: fetches all logged-in accounts in parallel via PTY (~5s total)

---

## Architecture

```
src/
  extension.ts   — VS Code extension entry point, all commands + UI
  utils.ts       — Pure functions (testable): accountEnv, parseEmailFromJson,
                   parseEmailFromConfig, readClaudeConfig, parseEmailAndUsageFromOutput
  test/
    utils.test.ts  — 35 unit tests (all passing)
```

**Dependencies:**
- `node-pty` (runtime) — PTY for usage detection
- All else: VS Code API + Node.js built-ins only

---

## Known Limitations

1. **Windows Credential Manager**: Claude may cache credentials at OS level. If two accounts share the same Windows credentials, isolation may be incomplete. The USERPROFILE override mitigates this for new logins.
2. **Usage latency**: Usage % takes 3–8s to appear (PTY startup). Email shows instantly.
3. **Login flow**: After clicking a not-logged-in account, user must log in manually via the browser. Sidebar updates when the terminal is closed.

---

## Future Ideas

- Auto-switch account based on usage hitting threshold
- Per-project account binding (`.claude-account` file)
- Multi-terminal orchestration
- Hotkey account switching
