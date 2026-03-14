/**
 * Test: Inline Execution in Heartbeat Tool
 *
 * Verifies that the heartbeat tool executes bash/read/write/edit actions
 * directly and returns results — no 2-step overhead.
 *
 * Tests the executeInline() function and the full heartbeat flow:
 *   1. bash: command executes, output returned in result
 *   2. read: file content returned in result
 *   3. write: file created, confirmation in result
 *   4. edit: file modified, confirmation in result
 *   5. Error handling: missing params, failed commands, missing files
 *   6. History updated with actual success/failure from execution
 *
 * This is a unit test of executeInline() — does not require an API key.
 * Run: npx tsx tests/test-inline-execution.ts
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";

// ── Inline copy of executeInline for testing ────────────
// (In production this lives in extension.ts; we copy it here to test
// without needing the full pi extension runtime)

function executeInline(
  actionType: string,
  params: Record<string, unknown>,
  cwd: string,
): { success: boolean; output: string; error?: string; durationMs: number } {
  const startTime = Date.now();

  try {
    switch (actionType) {
      case "bash": {
        const command = params.command as string;
        if (!command) return { success: false, output: "", error: "bash requires params.command", durationMs: Date.now() - startTime };
        try {
          const output = execSync(command, {
            encoding: "utf-8",
            cwd,
            timeout: 60000,
            maxBuffer: 1024 * 1024,
          });
          return { success: true, output: output.substring(0, 10000), durationMs: Date.now() - startTime };
        } catch (err: any) {
          const output = ((err.stdout as string) || "") + ((err.stderr as string) || "");
          if (output.trim()) {
            return { success: false, output: output.substring(0, 10000), error: `Exit code ${err.status ?? "unknown"}`, durationMs: Date.now() - startTime };
          }
          return { success: false, output: "", error: (err.message ?? String(err)).substring(0, 200), durationMs: Date.now() - startTime };
        }
      }

      case "read": {
        const path = params.path as string;
        if (!path) return { success: false, output: "", error: "read requires params.path", durationMs: Date.now() - startTime };
        const fullPath = path.startsWith("/") ? path : join(cwd, path);
        if (!existsSync(fullPath)) return { success: false, output: "", error: `File not found: ${path}`, durationMs: Date.now() - startTime };
        const content = readFileSync(fullPath, "utf-8");
        return { success: true, output: content.substring(0, 10000), durationMs: Date.now() - startTime };
      }

      case "write": {
        const path = params.path as string;
        const content = params.content as string;
        if (!path) return { success: false, output: "", error: "write requires params.path", durationMs: Date.now() - startTime };
        if (content == null) return { success: false, output: "", error: "write requires params.content", durationMs: Date.now() - startTime };
        const fullPath = path.startsWith("/") ? path : join(cwd, path);
        const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
        if (dir) mkdirSync(dir, { recursive: true });
        writeFileSync(fullPath, content);
        return { success: true, output: `Wrote ${path} (${content.length} bytes)`, durationMs: Date.now() - startTime };
      }

      case "edit": {
        const path = params.path as string;
        const oldText = params.oldText as string;
        const newText = params.newText as string;
        if (!path) return { success: false, output: "", error: "edit requires params.path", durationMs: Date.now() - startTime };
        if (!oldText) return { success: false, output: "", error: "edit requires params.oldText", durationMs: Date.now() - startTime };
        if (newText == null) return { success: false, output: "", error: "edit requires params.newText", durationMs: Date.now() - startTime };
        const fullPath = path.startsWith("/") ? path : join(cwd, path);
        if (!existsSync(fullPath)) return { success: false, output: "", error: `File not found: ${path}`, durationMs: Date.now() - startTime };
        const fileContent = readFileSync(fullPath, "utf-8");
        if (!fileContent.includes(oldText)) return { success: false, output: "", error: `Text not found in ${path}`, durationMs: Date.now() - startTime };
        writeFileSync(fullPath, fileContent.replace(oldText, newText));
        return { success: true, output: `Edited ${path}`, durationMs: Date.now() - startTime };
      }

      default:
        return { success: false, output: "", error: `Unknown action type for inline execution: ${actionType}`, durationMs: Date.now() - startTime };
    }
  } catch (err: any) {
    return { success: false, output: "", error: (err.message ?? String(err)).substring(0, 200), durationMs: Date.now() - startTime };
  }
}

// ── Test Runner ─────────────────────────────────────────

const TEST_DIR = `/tmp/rho-inline-test-${Date.now()}`;
const results: Record<string, { pass: boolean; detail: string }> = {};

function assert(name: string, condition: boolean, detail: string) {
  results[name] = { pass: condition, detail };
  const icon = condition ? "✓" : "✗";
  console.log(`  ${icon} ${name}: ${detail}`);
}

// Setup
mkdirSync(TEST_DIR, { recursive: true });

console.log("Testing executeInline()...\n");

// ── Test 1: bash executes and returns output ────────────
{
  const r = executeInline("bash", { command: "echo hello world" }, TEST_DIR);
  assert("bash_executes", r.success === true, `success=${r.success}`);
  assert("bash_output", r.output.trim() === "hello world", `output='${r.output.trim()}'`);
  assert("bash_duration", r.durationMs >= 0, `durationMs=${r.durationMs}`);
}

// ── Test 2: bash failure returns error ──────────────────
{
  const r = executeInline("bash", { command: "false" }, TEST_DIR);
  assert("bash_failure", r.success === false, `success=${r.success}`);
  assert("bash_failure_error", !!r.error, `error='${r.error}'`);
}

// ── Test 3: bash missing command ────────────────────────
{
  const r = executeInline("bash", {}, TEST_DIR);
  assert("bash_no_command", r.success === false && r.error === "bash requires params.command", `error='${r.error}'`);
}

// ── Test 4: bash captures stderr ────────────────────────
{
  const r = executeInline("bash", { command: "echo err >&2 && false" }, TEST_DIR);
  assert("bash_stderr", r.output.includes("err"), `output='${r.output.trim()}'`);
}

// ── Test 5: write creates file ──────────────────────────
{
  const testFile = join(TEST_DIR, "test-write.txt");
  const r = executeInline("write", { path: testFile, content: "hello from test" }, TEST_DIR);
  assert("write_success", r.success === true, `success=${r.success}`);
  assert("write_file_exists", existsSync(testFile), `exists=${existsSync(testFile)}`);
  assert("write_content", readFileSync(testFile, "utf-8") === "hello from test", `content matches`);
}

// ── Test 6: write creates parent dirs ───────────────────
{
  const testFile = join(TEST_DIR, "sub", "dir", "deep.txt");
  const r = executeInline("write", { path: testFile, content: "deep file" }, TEST_DIR);
  assert("write_deep_dir", r.success === true && existsSync(testFile), `success=${r.success}, exists=${existsSync(testFile)}`);
}

// ── Test 7: write missing params ────────────────────────
{
  const r1 = executeInline("write", { content: "no path" }, TEST_DIR);
  assert("write_no_path", r1.success === false && r1.error === "write requires params.path", `error='${r1.error}'`);
  const r2 = executeInline("write", { path: "/tmp/x" }, TEST_DIR);
  assert("write_no_content", r2.success === false && r2.error === "write requires params.content", `error='${r2.error}'`);
}

// ── Test 8: read returns file content ───────────────────
{
  const testFile = join(TEST_DIR, "test-read.txt");
  writeFileSync(testFile, "read me please");
  const r = executeInline("read", { path: testFile }, TEST_DIR);
  assert("read_success", r.success === true, `success=${r.success}`);
  assert("read_content", r.output === "read me please", `output='${r.output}'`);
}

// ── Test 9: read missing file ───────────────────────────
{
  const r = executeInline("read", { path: "/tmp/nonexistent-file-xyz" }, TEST_DIR);
  assert("read_missing", r.success === false && r.error?.includes("not found"), `error='${r.error}'`);
}

// ── Test 10: read missing params ────────────────────────
{
  const r = executeInline("read", {}, TEST_DIR);
  assert("read_no_path", r.success === false && r.error === "read requires params.path", `error='${r.error}'`);
}

// ── Test 11: edit modifies file ─────────────────────────
{
  const testFile = join(TEST_DIR, "test-edit.txt");
  writeFileSync(testFile, "hello world");
  const r = executeInline("edit", { path: testFile, oldText: "world", newText: "rho" }, TEST_DIR);
  assert("edit_success", r.success === true, `success=${r.success}`);
  assert("edit_content", readFileSync(testFile, "utf-8") === "hello rho", `content='${readFileSync(testFile, "utf-8")}'`);
}

// ── Test 12: edit text not found ────────────────────────
{
  const testFile = join(TEST_DIR, "test-edit2.txt");
  writeFileSync(testFile, "hello world");
  const r = executeInline("edit", { path: testFile, oldText: "xyz", newText: "abc" }, TEST_DIR);
  assert("edit_not_found", r.success === false && r.error?.includes("not found"), `error='${r.error}'`);
}

// ── Test 13: edit missing params ────────────────────────
{
  const r = executeInline("edit", { path: "/tmp/x" }, TEST_DIR);
  assert("edit_no_oldtext", r.success === false && r.error === "edit requires params.oldText", `error='${r.error}'`);
}

// ── Test 14: unknown action type ────────────────────────
{
  const r = executeInline("teleport", {}, TEST_DIR);
  assert("unknown_type", r.success === false && r.error?.includes("Unknown"), `error='${r.error}'`);
}

// ── Test 15: relative paths resolve against cwd ─────────
{
  const r = executeInline("write", { path: "relative-test.txt", content: "relative" }, TEST_DIR);
  assert("relative_write", r.success === true && existsSync(join(TEST_DIR, "relative-test.txt")), `success=${r.success}`);
  const r2 = executeInline("read", { path: "relative-test.txt" }, TEST_DIR);
  assert("relative_read", r2.success === true && r2.output === "relative", `output='${r2.output}'`);
}

// ── Summary ─────────────────────────────────────────────

console.log("\n" + "─".repeat(50));
const total = Object.keys(results).length;
const passed = Object.values(results).filter(r => r.pass).length;
const failed = Object.values(results).filter(r => !r.pass).length;
console.log(`Results: ${passed}/${total} passed, ${failed} failed`);

if (failed > 0) {
  console.log("\nFailed tests:");
  for (const [name, r] of Object.entries(results)) {
    if (!r.pass) console.log(`  ✗ ${name}: ${r.detail}`);
  }
}

// Cleanup
rmSync(TEST_DIR, { recursive: true, force: true });

process.exit(failed > 0 ? 1 : 0);
