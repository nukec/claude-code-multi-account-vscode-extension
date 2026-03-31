# Claude Code Multi-Account VS Code Extension

A VS Code extension for managing multiple [Claude Code](https://claude.ai/code) CLI accounts simultaneously — using session isolation, not API keys.

Designed for users on **Claude Pro ($20/month)** who want to rotate between multiple accounts to maximize usage.

---

## How It Works

Each account gets its own isolated directory inside VS Code's global storage. When you open a terminal for an account, the extension overrides the relevant environment variables so the `claude` CLI reads and writes auth/config to that account's folder only:

| Variable | Value |
|---|---|
| `HOME` | `<account-folder>` |
| `USERPROFILE` | `<account-folder>` |
| `XDG_CONFIG_HOME` | `<account-folder>` |
| `APPDATA` | `<account-folder>/AppData/Roaming` |
| `LOCALAPPDATA` | `<account-folder>/AppData/Local` |

Claude stores its auth token in `~/.claude.json`. With all env vars pointed at an account-specific folder, sessions are fully isolated — no credential sharing between accounts.

---

## Features

### Sidebar Account List

A dedicated sidebar panel shows all your accounts at a glance:

```
● main    user@example.com (10%)
○ alt     Not logged in
```

- **Green circle** — logged in, usage < 70%
- **Yellow circle** — logged in, usage 70–89%
- **Red circle** — logged in, usage ≥ 90%
- **Grey circle** — not logged in

### Account Management

- **Add** — creates a new isolated account folder
- **Rename** — renames the account (and its folder)
- **Delete** — removes the account with a confirmation dialog

### Terminal Launch

Click any account to open a terminal:

- **Logged-in account** — opens a terminal with `claude` running under that account's environment
- **Not-logged-in account** — opens Chrome in incognito to `claude.ai`, then opens a terminal so you can log in; sidebar updates automatically when the terminal closes

### Status Bar

Shows the currently active account: `⊙ Claude: main`

---

## Requirements

- [Claude Code CLI](https://claude.ai/code) installed and on your `PATH`
- VS Code 1.110.0+
- Windows (primary target; macOS/Linux may work but are untested)

---

## Installation

This extension is not yet on the VS Code Marketplace. Two options:

### 🚀 Option 1 — Dev mode (fastest)

Just press `F5` in VS Code. Opens an Extension Development Host with the extension running. Good for testing, but doesn't persist across restarts.

### 📦 Option 2 — Real install (permanent)

Installs into your main VS Code like a normal extension.

**Step 1 — Clone and install dependencies**

```bash
git clone https://github.com/nukec/claude-code-multi-account-vscode-extension
cd claude-code-multi-account-extension
npm install
```

**Step 2 — Build**

```bash
npm run package
```

**Step 3 — Package as `.vsix`**

```bash
npx vsce package
```

Produces: `claude-code-multi-account-0.0.1.vsix`

> Or skip steps 1–3 and download the `.vsix` directly from the repo.

**Step 4 — Install**

Option A — GUI:
1. Open VS Code
2. Go to the Extensions panel
3. Click `...` (top right)
4. Click **Install from VSIX...**
5. Select the `.vsix` file

Option B — CLI:
```bash
code --install-extension claude-code-multi-account-0.0.1.vsix
```

**Step 5 — Reload**

`Ctrl+Shift+P` → **Reload Window**

Done — the extension now runs in your main VS Code, persistently, no `F5` needed.

---

## Development

```bash
npm run compile      # Type-check + lint + build (dev)
npm run package      # Type-check + lint + build (prod, minified)
npm run watch        # Watch mode
npm run lint         # ESLint
npm run check-types  # TypeScript strict type check
npm run test         # Run tests
```

Press `F5` in VS Code to launch the Extension Development Host with the extension loaded.

---

## Known Issues

- **Usage % display** — usage detection via PTY is still being debugged; the percentage may not always appear
- **Edit/Delete buttons** — only visible on hover (VS Code platform limitation, cannot be changed)

---

## Architecture

```
src/
  extension.ts     — All extension logic (commands, tree view, terminals)
  pty-worker.ts    — Standalone PTY worker, spawned as a hidden child process for usage detection
  utils.ts         — Pure utility functions (env setup, config parsing)
  test/
    utils.test.ts  — Unit tests

dist/
  extension.js     — Bundled extension
  pty-worker.js    — Bundled PTY worker
```

**Dependencies:** `node-pty` (runtime) for PTY-based usage detection. Everything else uses VS Code API and Node.js built-ins only.

---

## License

MIT
