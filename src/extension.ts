import { exec } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type * as NodePty from "node-pty";
import {
  accountEnv,
  parseEmailAndUsageFromOutput,
  readClaudeConfig,
} from "./utils";

interface ClaudeAccount {
  name: string;
  expectedEmail?: string;
  usage?: string;
}

export function activate(context: vscode.ExtensionContext) {
  const profilesRoot = path.join(
    context.globalStorageUri.fsPath,
    "claude-profiles",
  );

  if (!fs.existsSync(profilesRoot)) {
    fs.mkdirSync(profilesRoot, { recursive: true });
  }

  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );

  function getAccounts(): ClaudeAccount[] {
    return context.globalState.get<ClaudeAccount[]>("accounts") || [];
  }

  function getAccountPath(name: string): string {
    return path.join(profilesRoot, name);
  }

  function updateStatusBar() {
    const active = context.globalState.get<string>("active_account");
    statusBar.text = active
      ? `$(robot) Claude: ${active}`
      : "$(robot) Claude: none";
    statusBar.show();
  }

  updateStatusBar();

  function openIncognito() {
    exec("start chrome --incognito https://claude.ai");
  }

  async function getEmail(cwd: string): Promise<string | null> {
    return readClaudeConfig(cwd).email;
  }

  // node-pty gives us a real PTY so /usage works inside Claude's REPL
  function getUsageViaPty(cwd: string): Promise<string | null> {
    return new Promise((resolve) => {
      let ptyModule: typeof NodePty;
      try {
        ptyModule = require("node-pty");
      } catch {
        return resolve(null);
      }

      // node-pty env must be Record<string, string> — strip undefined values
      const env = Object.fromEntries(
        Object.entries(accountEnv(cwd)).filter(([, v]) => v !== undefined),
      ) as Record<string, string>;

      // On Windows, claude is a .cmd script — must spawn via cmd.exe
      const [shell, args] = process.platform === "win32"
        ? ["cmd.exe", ["/c", "claude"]]
        : ["claude", []];

      const proc = ptyModule.spawn(shell, args, {
        name: "xterm-color",
        cols: 220,
        rows: 30,
        cwd,
        env,
      });

      let output = "";
      let usageSent = false;
      let done = false;

      proc.onData((data) => {
        if (done) { return; }
        output += data;
        // Once Claude's welcome screen appears, send /usage
        if (!usageSent && (output.includes("Claude Code") || output.includes("Welcome"))) {
          usageSent = true;
          setTimeout(() => { proc.write("/usage\r"); }, 300);
        }
        // Once we see a percentage in the post-usage output, we're done
        if (usageSent) {
          const stripped = output.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
          const match = stripped.match(/(\d+)%/);
          if (match) {
            done = true;
            try { proc.kill(); } catch { /* ignore */ }
          }
        }
      });

      const killTimer = setTimeout(() => {
        if (!done) {
          done = true;
          try { proc.kill(); } catch { /* ignore */ }
        }
      }, 8000);

      proc.onExit(() => {
        clearTimeout(killTimer);
        const stripped = output.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
        const { usage } = parseEmailAndUsageFromOutput(stripped);
        resolve(usage);
      });
    });
  }

  function createClaudeTerminal(name: string, accountPath: string): vscode.Terminal {
    const terminal = vscode.window.createTerminal({
      name: `Claude (${name})`,
      cwd: accountPath,
      env: accountEnv(accountPath),
    });
    terminal.show();
    return terminal;
  }

  // Track terminals to refresh login status when they close
  const terminalAccountMap = new Map<vscode.Terminal, string>();

  class Provider implements vscode.TreeDataProvider<string> {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    refresh() {
      this._onDidChangeTreeData.fire();
    }

    getTreeItem(name: string): vscode.TreeItem {
      const accounts = getAccounts();
      const acc = accounts.find((a) => a.name === name);

      const item = new vscode.TreeItem(name);

      let desc = "Not logged in";
      let icon = "circle-outline";
      let iconColor: vscode.ThemeColor | undefined;

      if (acc?.expectedEmail) {
        desc = acc.expectedEmail;
        // Default to green; usage % refines the color once captured from terminal
        iconColor = new vscode.ThemeColor("testing.iconPassed");
        if (acc.usage) {
          desc += ` (${acc.usage})`;
          const pct = parseInt(acc.usage, 10);
          if (pct >= 90) {
            iconColor = new vscode.ThemeColor("errorForeground");
          } else if (pct >= 70) {
            iconColor = new vscode.ThemeColor("problemsWarningIcon.foreground");
          }
        }
        icon = "circle-filled";
      }

      item.description = desc;
      item.tooltip = desc;
      item.iconPath = new vscode.ThemeIcon(icon, iconColor);
      item.command = {
        command: "claudeProfiles.openFromSidebar",
        title: "Open",
        arguments: [name],
      };
      item.contextValue = "account";

      return item;
    }

    getChildren(): Thenable<string[]> {
      return Promise.resolve(getAccounts().map((a) => a.name));
    }
  }

  const provider = new Provider();
  vscode.window.registerTreeDataProvider("claudeProfilesView", provider);

  context.subscriptions.push(
    vscode.window.onDidCloseTerminal(async (closedTerminal) => {
      const name = terminalAccountMap.get(closedTerminal);
      if (!name) { return; }
      terminalAccountMap.delete(closedTerminal);

      const accounts = getAccounts();
      const acc = accounts.find((a) => a.name === name);
      if (!acc) { return; }

      const email = await getEmail(getAccountPath(name));
      if (email) {
        acc.expectedEmail = email;
        await context.globalState.update("accounts", accounts);
        await context.globalState.update("active_account", name);
        updateStatusBar();
        provider.refresh();
      }
    }),
  );

  const addAccount = vscode.commands.registerCommand(
    "claudeProfiles.addAccount",
    async () => {
      const name = await vscode.window.showInputBox({ prompt: "Account name" });
      if (!name) { return; }

      const accounts = getAccounts();
      fs.mkdirSync(getAccountPath(name), { recursive: true });
      accounts.push({ name });
      await context.globalState.update("accounts", accounts);
      provider.refresh();
    },
  );

  const renameAccount = vscode.commands.registerCommand(
    "claudeProfiles.renameAccount",
    async (name: string) => {
      const accounts = getAccounts();
      const acc = accounts.find((a) => a.name === name);
      if (!acc) { return; }

      const newName = await vscode.window.showInputBox({
        value: name,
        prompt: "Rename account",
      });
      if (!newName) { return; }

      fs.renameSync(getAccountPath(name), getAccountPath(newName));
      acc.name = newName;
      await context.globalState.update("accounts", accounts);
      provider.refresh();
    },
  );

  const deleteAccount = vscode.commands.registerCommand(
    "claudeProfiles.deleteAccount",
    async (name: string) => {
      const confirm = await vscode.window.showWarningMessage(
        `Delete ${name}?`,
        "Yes",
      );
      if (confirm !== "Yes") { return; }

      fs.rmSync(getAccountPath(name), { recursive: true, force: true });
      await context.globalState.update(
        "accounts",
        getAccounts().filter((a) => a.name !== name),
      );
      provider.refresh();
    },
  );

  const open = vscode.commands.registerCommand(
    "claudeProfiles.openFromSidebar",
    async (name: string) => {
      const accounts = getAccounts();
      const acc = accounts.find((a) => a.name === name);
      if (!acc) { return; }

      const accountPath = getAccountPath(name);
      const email = await getEmail(accountPath);

      if (email) {
        acc.expectedEmail = email;
        await context.globalState.update("accounts", accounts);
        await context.globalState.update("active_account", name);
        updateStatusBar();
        provider.refresh();
      }

      if (!email) {
        openIncognito();
        const terminal = createClaudeTerminal(name, accountPath);
        terminalAccountMap.set(terminal, name);
        terminal.sendText("claude");
        terminal.sendText("/logout");
        return;
      }

      const terminal = createClaudeTerminal(name, accountPath);
      terminalAccountMap.set(terminal, name);
      terminal.sendText("claude");

      // Fetch usage in background via PTY; update sidebar when it arrives
      getUsageViaPty(accountPath).then(async (usage) => {
        if (!usage) { return; }
        const latest = getAccounts();
        const latestAcc = latest.find((a) => a.name === name);
        if (!latestAcc) { return; }
        latestAcc.usage = usage;
        await context.globalState.update("accounts", latest);
        provider.refresh();
      });
    },
  );

  const refreshAccounts = vscode.commands.registerCommand(
    "claudeProfiles.refresh",
    async () => {
      const accounts = getAccounts();

      // Refresh email instantly from .claude.json
      let emailChanged = false;
      for (const acc of accounts) {
        const email = await getEmail(getAccountPath(acc.name));
        if (email !== (acc.expectedEmail ?? null)) {
          acc.expectedEmail = email || undefined;
          acc.usage = undefined; // reset usage so it re-fetches
          emailChanged = true;
        }
      }
      if (emailChanged) {
        await context.globalState.update("accounts", accounts);
      }
      provider.refresh();

      // Fetch usage for all accounts in parallel via PTY
      const loggedIn = accounts.filter((a) => a.expectedEmail);
      await Promise.all(
        loggedIn.map(async (acc) => {
          const usage = await getUsageViaPty(getAccountPath(acc.name));
          if (!usage) { return; }
          const latest = getAccounts();
          const latestAcc = latest.find((a) => a.name === acc.name);
          if (!latestAcc) { return; }
          latestAcc.usage = usage;
          await context.globalState.update("accounts", latest);
          provider.refresh();
        }),
      );
    },
  );

  context.subscriptions.push(addAccount, renameAccount, deleteAccount, open, refreshAccounts, statusBar);
}

export function deactivate() {}
