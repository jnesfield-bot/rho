/**
 * Integration test: run the full heartbeat loop with a real LLM.
 *
 * Proves the assembly works — observe, evaluate, select, act, record —
 * not just the individual parts.
 *
 * Requires ANTHROPIC_API_KEY. Exit code 0 = pass, 1 = fail, 2 = skip.
 */

import { SingleAgent } from "../src/single-agent.js";
import type { LoopEvent } from "../src/types.js";
import { existsSync, readFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.log(JSON.stringify({ skip: true, reason: "ANTHROPIC_API_KEY not set" }));
  process.exit(2);
}

// ── Test config ─────────────────────────────────────────

const WORK_DIR = `/tmp/rho-integration-test-${Date.now()}`;
const REPLAY_DIR = join(WORK_DIR, "replay");
const OUTPUT_FILE = "/tmp/rho-test-output.txt";

// Clean up any prior run
if (existsSync(OUTPUT_FILE)) rmSync(OUTPUT_FILE);
if (existsSync(WORK_DIR)) rmSync(WORK_DIR, { recursive: true });

// ── Collect events ──────────────────────────────────────

const events: LoopEvent[] = [];

// ── Create and run agent ────────────────────────────────

const agent = new SingleAgent({
  agentId: "integration-test",
  workDir: WORK_DIR,
  heartbeatIntervalMs: 0,
  maxHeartbeats: 5,
  persistState: true,
  apiKey,
  model: "claude-sonnet-4-20250514",
  replayBufferDir: REPLAY_DIR,
  policyPath: join(process.cwd(), "policies", "worker-default.json"),
  task: {
    taskId: "test-001",
    description: "Create a file called /tmp/rho-test-output.txt containing exactly the text 'hello world' (no quotes). Use the write primitive. Then mark the task complete.",
    successCriteria: [
      "/tmp/rho-test-output.txt exists",
      "File contains 'hello world'",
    ],
    constraints: ["Complete within 5 heartbeats"],
    context: {},
    priority: 1,
    maxHeartbeats: 5,
  },
});

agent.subscribe((event) => events.push(event));

// ── Run with timeout ────────────────────────────────────

const timeout = setTimeout(() => {
  console.log(JSON.stringify({ error: "Timed out after 120s" }));
  process.exit(1);
}, 120_000);

try {
  await agent.run();
} catch (err: any) {
  console.log(JSON.stringify({ error: `Agent threw: ${err.message}` }));
  process.exit(1);
} finally {
  clearTimeout(timeout);
}

// ── Verify results ──────────────────────────────────────

const results: Record<string, { pass: boolean; detail: string }> = {};

// 1. File was created with correct content
if (existsSync(OUTPUT_FILE)) {
  const content = readFileSync(OUTPUT_FILE, "utf-8").trim();
  if (content === "hello world") {
    results["file_created"] = { pass: true, detail: "File exists with correct content" };
  } else {
    results["file_created"] = { pass: false, detail: `Wrong content: '${content.substring(0, 100)}'` };
  }
} else {
  results["file_created"] = { pass: false, detail: "File does not exist" };
}

// 2. Replay buffer has transitions
const replayIndexPath = join(REPLAY_DIR, "index.json");
if (existsSync(replayIndexPath)) {
  const replayIndex = JSON.parse(readFileSync(replayIndexPath, "utf-8"));
  const count = replayIndex.transitions?.length ?? 0;
  results["replay_buffer"] = {
    pass: count >= 1,
    detail: `${count} transition(s) recorded`,
  };
} else {
  results["replay_buffer"] = { pass: false, detail: "No replay index found" };
}

// 3. Episodic memory has entries
const episodicPath = join(WORK_DIR, "tri-memory", "episodic", "episode-index.json");
if (existsSync(episodicPath)) {
  const episodic = JSON.parse(readFileSync(episodicPath, "utf-8"));
  results["episodic_memory"] = {
    pass: episodic.length >= 1,
    detail: `${episodic.length} episodic entries`,
  };
} else {
  results["episodic_memory"] = { pass: false, detail: "No episodic index found" };
}

// 4. Policy engine was consulted (select_complete events with policyLog)
const selectEvents = events.filter(e => e.type === "select_complete") as Array<any>;
const withPolicyLog = selectEvents.filter(e => e.policyLog && e.policyLog.length > 0);
results["policy_consulted"] = {
  pass: withPolicyLog.length >= 1,
  detail: `${selectEvents.length} select events, ${withPolicyLog.length} with policy log`,
};

// 5. Heartbeat count sanity
const heartbeatStarts = events.filter(e => e.type === "heartbeat_start").length;
results["heartbeats_ran"] = {
  pass: heartbeatStarts >= 1 && heartbeatStarts <= 5,
  detail: `${heartbeatStarts} heartbeats executed`,
};

// ── Output ──────────────────────────────────────────────

const allPassed = Object.values(results).every(r => r.pass);

console.log(JSON.stringify({ allPassed, results, heartbeats: heartbeatStarts }, null, 2));

// ── Cleanup ─────────────────────────────────────────────

if (existsSync(OUTPUT_FILE)) rmSync(OUTPUT_FILE);
if (existsSync(WORK_DIR)) rmSync(WORK_DIR, { recursive: true });

process.exit(allPassed ? 0 : 1);
