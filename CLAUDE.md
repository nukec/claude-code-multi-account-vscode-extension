# CLAUDE.md

## Project Overview

VS Code extension for managing multiple Claude (Anthropic CLI) accounts. Users can add, rename, delete, and switch between accounts — each isolated via separate `HOME`/`XDG_CONFIG_HOME` environment variables so the `claude` CLI maintains independent auth tokens and config per account.

## Commands

```bash
npm run compile        # Type-check + lint + build (dev)
npm run package        # Type-check + lint + build (prod, minified)
npm run watch          # Watch mode (tsc + esbuild in parallel)
npm run lint           # ESLint on src/
npm run check-types    # TypeScript strict type check only
npm run test           # Run VS Code extension tests
```

**Debug:** Press `F5` in VS Code to launch the Extension Development Host.

## Architecture

Single-file extension: all logic lives in `src/extension.ts`. Built with esbuild into `dist/extension.js`.

**Key components:**

- **`Provider` class** — `TreeDataProvider<string>` that renders the account list in the sidebar. Each item shows login status (circle icon), email, and usage %.
- **`activate()`** — registers all commands, the tree view, and the status bar item.
- **Account isolation** — each account gets a folder under `profilesRoot` (derived from `context.globalStorageUri`). Terminal sessions set `HOME` and `XDG_CONFIG_HOME` to that folder so `claude` CLI is fully isolated.
- **`getEmailAndUsage(cwd)`** — runs `claude /usage`, parses email and usage % via regex to determine login state.
- **Status bar** — shows `$(robot) Claude: [account-name]` for the active account.

**Login flow:**
1. If no email detected → open Chrome incognito to `claude.ai`, run `claude logout`, then launch interactive `claude` session.
2. If email found → launch terminal directly with the account active.

## Data Storage

- Account list: `context.globalState` (VS Code global state, keyed by extension ID)
- Account files: `~/.vscode/extensionData/.../globalStorageUri/claude-profiles/[account-name]/`

## Stack

- **Language:** TypeScript 5.x (strict mode, target ES2022)
- **Bundler:** esbuild (CJS output, `vscode` externalized)
- **Linter:** ESLint 9 + typescript-eslint
- **Tests:** @vscode/test-cli + Mocha
- **Min VS Code version:** 1.110.0

## Conventions

- All extension logic is in `src/extension.ts` — keep it single-file unless complexity genuinely warrants splitting.
- Use `context.globalState` for persistence; avoid writing to the filesystem outside the designated `profilesRoot`.
- Register every disposable (commands, status bar, tree views) via `context.subscriptions.push()`.
- Destructive actions (delete account) must show a confirmation dialog before proceeding.
- No external runtime dependencies — only Node.js built-ins and the VS Code API.
