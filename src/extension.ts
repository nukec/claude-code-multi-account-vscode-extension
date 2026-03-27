import { exec } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

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

  function runClaudeUsage(cwd: string): Promise<string> {
    return new Promise((resolve) => {
      exec("claude /usage", { cwd }, (err, stdout) => {
        if (err) return resolve("");
        resolve(stdout);
      });
    });
  }

  async function getEmailAndUsage(cwd: string) {
    const output = await runClaudeUsage(cwd);

    const emailMatch = output.match(/Email:\s*(.+)/);
    const usageMatch = output.match(/(\d+)%/);

    return {
      email: emailMatch ? emailMatch[1].trim() : null,
      usage: usageMatch ? usageMatch[1] + "%" : null,
    };
  }

  class Provider implements vscode.TreeDataProvider<string> {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    refresh() {
      this._onDidChangeTreeData.fire();
    }

    getTreeItem(name: string): vscode.TreeItem {
      const accounts =
        context.globalState.get<ClaudeAccount[]>("accounts") || [];

      const acc = accounts.find((a) => a.name === name);
      const active = context.globalState.get<string>("active_account");

      const item = new vscode.TreeItem(name);

      let desc = "Not logged in";
      let icon = "circle-outline";

      if (acc?.expectedEmail) {
        desc = acc.expectedEmail;

        if (acc.usage) {
          desc += ` (${acc.usage})`;
        }

        icon = "circle-filled";
      }

      item.description = desc;
      item.tooltip = desc;
      item.iconPath = new vscode.ThemeIcon(icon);

      item.command = {
        command: "claudeProfiles.openFromSidebar",
        title: "Open",
        arguments: [name],
      };

      item.contextValue = "account";

      return item;
    }

    getChildren(): Thenable<string[]> {
      const accounts =
        context.globalState.get<ClaudeAccount[]>("accounts") || [];
      return Promise.resolve(accounts.map((a) => a.name));
    }
  }

  const provider = new Provider();
  vscode.window.registerTreeDataProvider("claudeProfilesView", provider);

  const addAccount = vscode.commands.registerCommand(
    "claudeProfiles.addAccount",
    async () => {
      const name = await vscode.window.showInputBox({ prompt: "Account name" });
      if (!name) return;

      const accounts =
        context.globalState.get<ClaudeAccount[]>("accounts") || [];

      const accountPath = path.join(profilesRoot, name);
      fs.mkdirSync(accountPath, { recursive: true });

      accounts.push({ name });
      await context.globalState.update("accounts", accounts);

      provider.refresh();
    },
  );

  const renameAccount = vscode.commands.registerCommand(
    "claudeProfiles.renameAccount",
    async (name: string) => {
      const accounts =
        context.globalState.get<ClaudeAccount[]>("accounts") || [];

      const acc = accounts.find((a) => a.name === name);
      if (!acc) return;

      const newName = await vscode.window.showInputBox({
        value: name,
        prompt: "Rename account",
      });

      if (!newName) return;

      fs.renameSync(
        path.join(profilesRoot, name),
        path.join(profilesRoot, newName),
      );

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

      if (confirm !== "Yes") return;

      let accounts = context.globalState.get<ClaudeAccount[]>("accounts") || [];

      fs.rmSync(path.join(profilesRoot, name), {
        recursive: true,
        force: true,
      });

      accounts = accounts.filter((a) => a.name !== name);

      await context.globalState.update("accounts", accounts);

      provider.refresh();
    },
  );

  const open = vscode.commands.registerCommand(
    "claudeProfiles.openFromSidebar",
    async (name: string) => {
      const accounts =
        context.globalState.get<ClaudeAccount[]>("accounts") || [];

      const acc = accounts.find((a) => a.name === name);
      if (!acc) return;

      const accountPath = path.join(profilesRoot, name);

      // 🔥 ALWAYS detect email + usage
      const { email, usage } = await getEmailAndUsage(accountPath);

      if (email) {
        acc.expectedEmail = email;
        acc.usage = usage || undefined;

        await context.globalState.update("accounts", accounts);
        provider.refresh();
      }

      // 🔥 If not logged in → login flow
      if (!email) {
        openIncognito();

        const terminal = vscode.window.createTerminal({
          name: `Claude (${name})`,
          cwd: accountPath,
          env: {
            HOME: accountPath,
            XDG_CONFIG_HOME: accountPath,
          },
        });

        terminal.show();
        terminal.sendText("claude logout");
        terminal.sendText("claude");

        return;
      }

      await context.globalState.update("active_account", name);
      updateStatusBar();

      const terminal = vscode.window.createTerminal({
        name: `Claude (${name})`,
        cwd: accountPath,
        env: {
          HOME: accountPath,
          XDG_CONFIG_HOME: accountPath,
        },
      });

      terminal.show();
      terminal.sendText("claude");
    },
  );

  context.subscriptions.push(
    addAccount,
    renameAccount,
    deleteAccount,
    open,
    statusBar,
  );
}

export function deactivate() {}
