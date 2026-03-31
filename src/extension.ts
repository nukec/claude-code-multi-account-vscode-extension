import { exec } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
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

  // Run claude directly in a hidden shell integration terminal, send /usage, read output stream.
  // No node-pty needed — claude runs in VS Code's own terminal which has a real console.
  function getUsageViaPty(cwd: string): Promise<string | null> {
    return new Promise((resolve) => {
      let done = false;

      const terminal = vscode.window.createTerminal({
        name: `__claude_usage__`,
        cwd,
        env: accountEnv(cwd),
        // hideFromUser: true, // disabled to test if shell integration fires without it
      });

      const shellListener = vscode.window.onDidChangeTerminalShellIntegration(async ({ terminal: t, shellIntegration }) => {
        if (t !== terminal) { return; }
        shellListener.dispose();
        console.log("[usage] shell integration fired");

        const execution = shellIntegration.executeCommand("echo /usage | claude");
        let output = "";

        for await (const chunk of execution.read()) {
          output += chunk;
          const stripped = output.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
          const match =
            stripped.match(/[Cc]urrent week[^%]*?(\d+)%/) ||
            stripped.match(/[Uu]sage[^%]*?(\d+)%/) ||
            stripped.match(/[Ll]imit[^%]*?(\d+)%/);
          if (match && !done) {
            done = true;
            terminal.sendText("/exit");
            terminal.dispose();
            resolve(match[1] + "%");
            return;
          }
        }

        if (!done) {
          done = true;
          console.log("[usage] no match, tail:", JSON.stringify(output.slice(-300)));
          try { terminal.dispose(); } catch { /* ignore */ }
          resolve(null);
        }
      });

      setTimeout(() => {
        if (!done) {
          done = true;
          shellListener.dispose();
          try { terminal.dispose(); } catch { /* ignore */ }
          console.log("[usage] timeout");
          resolve(null);
        }
      }, 20000);
    });
  }

  /**
   * Creates a per-account launch-claude.cmd wrapper that sets the isolated env
   * vars only for the claude process. The terminal itself keeps the real HOME
   * so git, SSH, npm etc. all work normally.
   */
  function ensureWrapper(accountPath: string): string {
    const wrapperPath = path.join(accountPath, "launch-claude.cmd");
    const appData = path.join(accountPath, "AppData", "Roaming");
    const localAppData = path.join(accountPath, "AppData", "Local");
    const script = [
      "@echo off",
      "setlocal",
      `set HOME=${accountPath}`,
      `set USERPROFILE=${accountPath}`,
      `set XDG_CONFIG_HOME=${accountPath}`,
      `set APPDATA=${appData}`,
      `set LOCALAPPDATA=${localAppData}`,
      "claude %*",
      "endlocal",
    ].join("\r\n");
    fs.writeFileSync(wrapperPath, script);
    return wrapperPath;
  }

  function createClaudeTerminal(name: string, accountPath: string): vscode.Terminal {
    const workspaceCwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const terminal = vscode.window.createTerminal({
      name: `Claude (${name})`,
      cwd: workspaceCwd ?? accountPath,
      // No env override here — isolation is handled by launch-claude.cmd wrapper
    });
    terminal.show(true); // preserveFocus: keep sidebar focused so next click works immediately
    return terminal;
  }

  // Track terminals to refresh login status when they close
  const terminalAccountMap = new Map<vscode.Terminal, string>();

  // ---------------------------------------------------------------------------
  // TEST SCAFFOLD: hardcoded 2-row tree to verify click events work end-to-end.
  // Real account rendering is commented out below; restore when click is confirmed.
  // ---------------------------------------------------------------------------
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
      item.contextValue = "account";
      item.command = {
        command: "claudeProfiles.openFromSidebar",
        title: "Open",
        arguments: [name],
      };

      return item;
    }

    getChildren(): Thenable<string[]> {
      return Promise.resolve(getAccounts().map((a) => a.name));
    }
  }

  // ---------------------------------------------------------------------------
  // ORIGINAL getTreeItem logic (kept for reference, restore later):
  //
  // getTreeItem(name: string): vscode.TreeItem {
  //   const accounts = getAccounts();
  //   const acc = accounts.find((a) => a.name === name);
  //   const item = new vscode.TreeItem(name);
  //   let desc = "Not logged in";
  //   let icon = "circle-outline";
  //   let iconColor: vscode.ThemeColor | undefined;
  //   if (acc?.expectedEmail) {
  //     desc = acc.expectedEmail;
  //     iconColor = new vscode.ThemeColor("testing.iconPassed");
  //     if (acc.usage) {
  //       desc += ` (${acc.usage})`;
  //       const pct = parseInt(acc.usage, 10);
  //       if (pct >= 90) { iconColor = new vscode.ThemeColor("errorForeground"); }
  //       else if (pct >= 70) { iconColor = new vscode.ThemeColor("problemsWarningIcon.foreground"); }
  //     }
  //     icon = "circle-filled";
  //   }
  //   item.description = desc;
  //   item.tooltip = desc;
  //   item.iconPath = new vscode.ThemeIcon(icon, iconColor);
  //   item.contextValue = "account";
  //   item.command = { command: "claudeProfiles.openFromSidebar", title: "Open", arguments: [name] };
  //   return item;
  // }
  //
  // getChildren(): Thenable<string[]> {
  //   return Promise.resolve(getAccounts().map((a) => a.name));
  // }
  // ---------------------------------------------------------------------------

  const provider = new Provider();
  const treeView = vscode.window.createTreeView("claudeProfilesView", {
    treeDataProvider: provider,
  });

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
      console.log("[open] CALLED with name =", name);
      const accountPath = getAccountPath(name);
      console.log("[open] accountPath =", accountPath);

      const mode = await vscode.window.showQuickPick(
        [
          { label: "Normal", description: "claude", flag: "" },
          { label: "Skip Permissions", description: "claude --dangerously-skip-permissions", flag: " --dangerously-skip-permissions" },
        ],
        { placeHolder: "How do you want to start Claude?" },
      );
      if (!mode) { return; }

      const wrapperPath = ensureWrapper(accountPath);
      const workspaceCwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const terminal = vscode.window.createTerminal({
        name: `Claude (${name})`,
        cwd: workspaceCwd ?? accountPath,
        // No env override — wrapper script scopes isolation to claude only
      });
      terminal.show(true);
      terminal.sendText(`"${wrapperPath}"${mode.flag}`);

      const email = await getEmail(accountPath);
      console.log("[open] email =", email);

      const accounts = getAccounts();
      const acc = accounts.find((a) => a.name === name);
      if (acc && email) {
        acc.expectedEmail = email;
        await context.globalState.update("accounts", accounts);
        await context.globalState.update("active_account", name);
        updateStatusBar();
        provider.refresh();
      }

      getUsageViaPty(accountPath).then(async (usage) => {
        console.log("[open] PTY usage =", usage);
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

  // ---------------------------------------------------------------------------
  // ORIGINAL openFromSidebar (commented out during click-event test):
  //
  // const open = vscode.commands.registerCommand(
  //   "claudeProfiles.openFromSidebar",
  //   async (name: string) => {
  //     const accounts = getAccounts();
  //     const acc = accounts.find((a) => a.name === name);
  //     if (!acc) { return; }
  //     const accountPath = getAccountPath(name);
  //     const email = await getEmail(accountPath);
  //     if (email) {
  //       acc.expectedEmail = email;
  //       await context.globalState.update("accounts", accounts);
  //       await context.globalState.update("active_account", name);
  //       updateStatusBar();
  //     }
  //     if (!email) {
  //       openIncognito();
  //       const terminal = createClaudeTerminal(name, accountPath);
  //       terminalAccountMap.set(terminal, name);
  //       terminal.sendText("claude");
  //       terminal.sendText("/logout");
  //       return;
  //     }
  //     const terminal = createClaudeTerminal(name, accountPath);
  //     terminalAccountMap.set(terminal, name);
  //     terminal.sendText("claude");
  //     getUsageViaPty(accountPath).then(async (usage) => {
  //       if (!usage) { return; }
  //       const latest = getAccounts();
  //       const latestAcc = latest.find((a) => a.name === name);
  //       if (!latestAcc) { return; }
  //       latestAcc.usage = usage;
  //       await context.globalState.update("accounts", latest);
  //       provider.refresh();
  //     });
  //   },
  // );
  // ---------------------------------------------------------------------------

  const refreshAccounts = vscode.commands.registerCommand(
    "claudeProfiles.refresh",
    async () => {
      const accounts = getAccounts();
      console.log("[claude-profiles] refresh: accounts =", JSON.stringify(accounts));

      // Refresh email instantly from .claude.json
      let emailChanged = false;
      for (const acc of accounts) {
        const accountPath = getAccountPath(acc.name);
        const email = await getEmail(accountPath);
        console.log(`[claude-profiles] refresh: acc=${acc.name} path=${accountPath} email=${email} prev=${acc.expectedEmail}`);
        if (email !== (acc.expectedEmail ?? null)) {
          acc.expectedEmail = email || undefined;
          acc.usage = undefined; // reset usage so it re-fetches
          emailChanged = true;
        }
      }
      console.log("[claude-profiles] refresh: emailChanged =", emailChanged);
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

  context.subscriptions.push(addAccount, renameAccount, deleteAccount, open, refreshAccounts, statusBar, treeView);
}

export function deactivate() {}
