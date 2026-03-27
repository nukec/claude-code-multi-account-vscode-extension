import * as fs from "fs";
import * as path from "path";

/** Returns env vars that isolate a Claude account to its own folder. */
export function accountEnv(accountPath: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: accountPath,
    USERPROFILE: accountPath, // Windows: os.homedir() reads USERPROFILE, not HOME
    XDG_CONFIG_HOME: accountPath,
  };
}

/** Extracts email from a parsed .claude.json object. Tries known field locations. */
export function parseEmailFromJson(json: string): string | null {
  let config: unknown;
  try {
    config = JSON.parse(json);
  } catch {
    return null;
  }
  if (!config || typeof config !== "object") { return null; }
  const c = config as Record<string, unknown>;
  const email =
    (c.oauthAccount as Record<string, unknown> | undefined)?.emailAddress ||
    c.primaryApiKeyEmail ||
    c.userEmail ||
    c.email ||
    null;
  return typeof email === "string" && email.length > 0 ? email : null;
}

/** Reads a .claude.json file and returns the stored email, or null. */
export function parseEmailFromConfig(filePath: string): string | null {
  if (!fs.existsSync(filePath)) { return null; }
  try {
    return parseEmailFromJson(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Reads .claude.json from the account-isolated folder first,
 * then falls back to the real system home (for accounts logged in before isolation).
 */
export function readClaudeConfig(
  accountPath: string,
  systemHome: string = process.env.USERPROFILE || process.env.HOME || "",
): { email: string | null } {
  const email =
    parseEmailFromConfig(path.join(accountPath, ".claude.json")) ||
    parseEmailFromConfig(path.join(systemHome, ".claude.json"));
  return { email };
}

/** Parses email and usage % from the text output of `claude /usage`. */
export function parseEmailAndUsageFromOutput(output: string): {
  email: string | null;
  usage: string | null;
} {
  const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;
  const emailMatch =
    output.match(new RegExp(`Email:\\s*(${EMAIL_RE.source})`)) ||
    output.match(EMAIL_RE);

  // Prefer "Current week" usage (billing period) over session usage
  const usageMatch =
    output.match(/[Cc]urrent week[^%]*?(\d+)%/) ||
    output.match(/(\d+)%/);

  return {
    email: emailMatch ? (emailMatch[1] ?? emailMatch[0]).trim() : null,
    usage: usageMatch ? usageMatch[1] + "%" : null,
  };
}
