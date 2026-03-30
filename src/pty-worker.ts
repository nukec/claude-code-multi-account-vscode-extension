/**
 * Standalone PTY worker — spawned as a hidden child process by the extension.
 * Receives accountPath via argv[2], runs claude, sends /usage, prints result to stdout.
 * Using a separate process keeps conpty from stealing focus in VS Code.
 */
import type * as NodePty from "node-pty";

const accountPath = process.argv[2];
if (!accountPath) { process.exit(1); }

const env: Record<string, string> = Object.fromEntries(
  Object.entries({
    ...process.env,
    HOME: accountPath,
    USERPROFILE: accountPath,
    XDG_CONFIG_HOME: accountPath,
    APPDATA: `${accountPath}\\AppData\\Roaming`,
    LOCALAPPDATA: `${accountPath}\\AppData\\Local`,
  }).filter(([, v]) => v !== undefined),
) as Record<string, string>;

let ptyModule: typeof NodePty;
try {
  ptyModule = require("node-pty");
} catch {
  process.exit(1);
}

const [shell, args] = process.platform === "win32"
  ? ["cmd.exe", ["/c", "claude"]]
  : ["claude", []];

const proc = ptyModule.spawn(shell, args, {
  name: "xterm-color",
  cols: 220,
  rows: 30,
  cwd: accountPath,
  env,
});

let output = "";
let usageSent = false;
let done = false;

proc.onData((data) => {
  if (done) { return; }
  output += data;
  if (!usageSent && (output.includes("Claude Code") || output.includes("Welcome"))) {
    usageSent = true;
    setTimeout(() => { proc.write("/usage\r"); }, 300);
  }
  if (usageSent) {
    const stripped = output.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
    const match = stripped.match(/(\d+)%/);
    if (match) {
      done = true;
      process.stdout.write(match[1] + "%");
      try { proc.kill(); } catch { /* ignore */ }
    }
  }
});

setTimeout(() => {
  if (!done) {
    done = true;
    try { proc.kill(); } catch { /* ignore */ }
    process.exit(1);
  }
}, 10000);

proc.onExit(() => { process.exit(0); });
