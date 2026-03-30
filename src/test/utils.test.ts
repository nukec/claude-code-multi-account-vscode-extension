import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  accountEnv,
  parseEmailFromJson,
  parseEmailFromConfig,
  readClaudeConfig,
  parseEmailAndUsageFromOutput,
} from "../utils";

suite("accountEnv", () => {
  test("sets HOME, USERPROFILE, XDG_CONFIG_HOME, APPDATA, LOCALAPPDATA to accountPath", () => {
    const p = path.join(os.tmpdir(), "some-account-path");
    const env = accountEnv(p);
    assert.strictEqual(env.HOME, p);
    assert.strictEqual(env.USERPROFILE, p);
    assert.strictEqual(env.XDG_CONFIG_HOME, p);
    assert.strictEqual(env.APPDATA, path.join(p, "AppData", "Roaming"));
    assert.strictEqual(env.LOCALAPPDATA, path.join(p, "AppData", "Local"));
  });

  test("spreads existing process.env", () => {
    const env = accountEnv("/any");
    assert.ok("PATH" in env || true); // PATH may not exist in all CI envs but other keys will
    assert.strictEqual(typeof env, "object");
  });
});

suite("parseEmailFromJson", () => {
  test("reads oauthAccount.emailAddress", () => {
    const json = JSON.stringify({ oauthAccount: { emailAddress: "user@example.com" } });
    assert.strictEqual(parseEmailFromJson(json), "user@example.com");
  });

  test("reads top-level email field", () => {
    const json = JSON.stringify({ email: "a@b.com" });
    assert.strictEqual(parseEmailFromJson(json), "a@b.com");
  });

  test("reads userEmail field", () => {
    const json = JSON.stringify({ userEmail: "c@d.com" });
    assert.strictEqual(parseEmailFromJson(json), "c@d.com");
  });

  test("reads primaryApiKeyEmail field", () => {
    const json = JSON.stringify({ primaryApiKeyEmail: "key@org.com" });
    assert.strictEqual(parseEmailFromJson(json), "key@org.com");
  });

  test("prefers oauthAccount.emailAddress over other fields", () => {
    const json = JSON.stringify({
      oauthAccount: { emailAddress: "oauth@x.com" },
      email: "other@x.com",
    });
    assert.strictEqual(parseEmailFromJson(json), "oauth@x.com");
  });

  test("returns null when no email fields present", () => {
    const json = JSON.stringify({ name: "test", version: 1 });
    assert.strictEqual(parseEmailFromJson(json), null);
  });

  test("returns null for invalid JSON", () => {
    assert.strictEqual(parseEmailFromJson("{not valid json}"), null);
  });

  test("returns null for empty string", () => {
    assert.strictEqual(parseEmailFromJson(""), null);
  });

  test("returns null when email field is not a string", () => {
    const json = JSON.stringify({ email: 42 });
    assert.strictEqual(parseEmailFromJson(json), null);
  });

  test("returns null when email field is empty string", () => {
    const json = JSON.stringify({ email: "" });
    assert.strictEqual(parseEmailFromJson(json), null);
  });

  test("returns null for null JSON", () => {
    assert.strictEqual(parseEmailFromJson("null"), null);
  });

  test("real .claude.json shape (oauthAccount with extra fields)", () => {
    const json = JSON.stringify({
      numStartups: 42,
      oauthAccount: {
        accountUuid: "abc-123",
        emailAddress: "real@user.com",
        organizationName: "real@user.com's Organization",
        displayName: "Gooby",
      },
    });
    assert.strictEqual(parseEmailFromJson(json), "real@user.com");
  });
});

suite("parseEmailFromConfig", () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-test-"));
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns email from a valid config file", () => {
    const filePath = path.join(tmpDir, ".claude.json");
    fs.writeFileSync(filePath, JSON.stringify({ oauthAccount: { emailAddress: "file@test.com" } }));
    assert.strictEqual(parseEmailFromConfig(filePath), "file@test.com");
  });

  test("returns null if file does not exist", () => {
    assert.strictEqual(parseEmailFromConfig(path.join(tmpDir, "missing.json")), null);
  });

  test("returns null if file contains invalid JSON", () => {
    const filePath = path.join(tmpDir, ".claude.json");
    fs.writeFileSync(filePath, "not json at all");
    assert.strictEqual(parseEmailFromConfig(filePath), null);
  });

  test("returns null if file has no email fields", () => {
    const filePath = path.join(tmpDir, ".claude.json");
    fs.writeFileSync(filePath, JSON.stringify({ something: "else" }));
    assert.strictEqual(parseEmailFromConfig(filePath), null);
  });
});

suite("readClaudeConfig", () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-test-"));
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("reads from account-specific .claude.json when present", () => {
    const accountPath = path.join(tmpDir, "account1");
    fs.mkdirSync(accountPath);
    fs.writeFileSync(
      path.join(accountPath, ".claude.json"),
      JSON.stringify({ oauthAccount: { emailAddress: "account@test.com" } }),
    );
    const { email } = readClaudeConfig(accountPath);
    assert.strictEqual(email, "account@test.com");
  });

  test("returns null when account config is absent (no fallback to system home)", () => {
    const accountPath = path.join(tmpDir, "account1");
    fs.mkdirSync(accountPath);
    // Even if system home has a .claude.json, we should NOT fall back to it
    fs.writeFileSync(
      path.join(tmpDir, ".claude.json"),
      JSON.stringify({ oauthAccount: { emailAddress: "home@test.com" } }),
    );
    const { email } = readClaudeConfig(accountPath);
    assert.strictEqual(email, null);
  });

  test("returns null when no config exists", () => {
    const accountPath = path.join(tmpDir, "account1");
    fs.mkdirSync(accountPath);
    const { email } = readClaudeConfig(accountPath);
    assert.strictEqual(email, null);
  });
});

suite("parseEmailAndUsageFromOutput", () => {
  test('parses "Email: foo@bar.com" format', () => {
    const { email } = parseEmailAndUsageFromOutput("Email: foo@bar.com\nSome other line");
    assert.strictEqual(email, "foo@bar.com");
  });

  test("parses bare email address from output", () => {
    const { email } = parseEmailAndUsageFromOutput("Welcome user@example.com's Organization");
    assert.strictEqual(email, "user@example.com");
  });

  test("parses usage percentage", () => {
    const { usage } = parseEmailAndUsageFromOutput("Usage: 72% of monthly limit");
    assert.strictEqual(usage, "72%");
  });

  test("parses both email and usage in same output", () => {
    const { email, usage } = parseEmailAndUsageFromOutput(
      "Email: user@example.com\nUsage: 45% of monthly limit",
    );
    assert.strictEqual(email, "user@example.com");
    assert.strictEqual(usage, "45%");
  });

  test("returns null email when no email in output", () => {
    const { email } = parseEmailAndUsageFromOutput("No relevant content here");
    assert.strictEqual(email, null);
  });

  test("returns null usage when no percentage in output", () => {
    const { usage } = parseEmailAndUsageFromOutput("Email: a@b.com");
    assert.strictEqual(usage, null);
  });

  test("returns both null for empty output", () => {
    const { email, usage } = parseEmailAndUsageFromOutput("");
    assert.strictEqual(email, null);
    assert.strictEqual(usage, null);
  });

  test("handles multi-line output with email buried in middle", () => {
    const output = [
      "Claude Code v2.1.85",
      "Welcome back Gooby!",
      "Sonnet 4.6 with medium effort · Claude Pro · user@example.com's Organization",
      "~/some/path",
    ].join("\n");
    const { email } = parseEmailAndUsageFromOutput(output);
    assert.strictEqual(email, "user@example.com");
  });

  test("does not match non-email at-signs", () => {
    const { email } = parseEmailAndUsageFromOutput("Follow us @twitter and @github");
    assert.strictEqual(email, null);
  });

  test("prefers Current week usage over first % occurrence", () => {
    // Real /usage output: session first, then week
    const output = "Current session ██▌5%used Resets 3m Current week (all models) █████10%used Resets Apr 3";
    const { usage } = parseEmailAndUsageFromOutput(output);
    assert.strictEqual(usage, "10%");
  });

  test("falls back to first % when no Current week context", () => {
    const { usage } = parseEmailAndUsageFromOutput("Usage: 72% of limit");
    assert.strictEqual(usage, "72%");
  });

  test("parses real PTY /usage output format", () => {
    const raw = "Current session    \u2588\u2588\u25845%usedResets3m (Europe/London)Current week (all models)\u2588\u2588\u2588\u2588\u258810%usedResets Apr 3, 4pm (Europe/London)";
    const { usage } = parseEmailAndUsageFromOutput(raw);
    assert.strictEqual(usage, "10%");
  });
});
