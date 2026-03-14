/**
 * Pi Extension — Agent Loop
 *
 * Integrates the heartbeat loop into pi's interactive TUI.
 * User input becomes a task brief. The loop runs Observe → Evaluate → Select → Act
 * using pi's own tools and LLM, with full visibility in the TUI.
 *
 * Commands:
 *   /loop <task>    — Run a task through the heartbeat loop
 *   /loop-status    — Show current loop state
 *   /loop-stop      — Stop a running loop
 *   /loop-memory    — Show/edit agent memory
 *   /loop-policy    — View, add, remove, enable/disable policy rules
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";

// ── Policy Types ─────────────────────────────────────────

interface PolicyRule {
  id: string;
  description?: string;
  priority: number;
  precondition: {
    type: string;
    field?: string;
    pattern?: string;
    count?: number;
    threshold?: number;
    actionType?: string;
    withinMs?: number;
  };
  effect: string;
  message?: string;
  action?: any;
  skillName?: string;
  boostValue?: number;
}

interface Policy {
  version: number;
  name: string;
  rules: PolicyRule[];
  impasse?: any;
  defaults?: any;
}

interface LoopState {
  running: boolean;
  heartbeat: number;
  maxHeartbeats: number;
  task: string | null;
  memory: Record<string, string>;
  lastAction: { type: string; description: string; success: boolean } | null;
  history: Array<{ heartbeat: number; action: string; value: number; success: boolean; output: string }>;
  abortController: AbortController | null;
  policy: Policy | null;
  recentActions: Array<{ type: string; timestamp: number }>;
  consecutiveFailures: number;
}

const state: LoopState = {
  running: false,
  heartbeat: 0,
  maxHeartbeats: 15,
  task: null,
  memory: {},
  lastAction: null,
  history: [],
  abortController: null,
  policy: null,
  recentActions: [],
  consecutiveFailures: 0,
};

// ── Policy Engine ────────────────────────────────────────

/**
 * Load policy from standard locations.
 * Searches: CWD/policy.json, CWD/../policies/worker-default.json
 */
function loadPolicy(cwd: string): Policy | null {
  const paths = [
    join(cwd, "policy.json"),
    join(cwd, "policies", "worker-default.json"),
    join(cwd, "..", "policies", "worker-default.json"),
  ];

  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const policy = JSON.parse(readFileSync(p, "utf-8"));
        if (policy?.rules && Array.isArray(policy.rules)) {
          return policy as Policy;
        }
      } catch { /* skip invalid */ }
    }
  }
  return null;
}

/**
 * Get a nested field from an object using dot notation.
 * e.g., getNestedField({ params: { command: "ls" } }, "params.command") => "ls"
 */
function getNestedField(obj: any, fieldPath: string): any {
  return fieldPath.split(".").reduce((o, k) => o?.[k], obj);
}

/**
 * Check if a policy rule's precondition matches against the current action and state.
 */
function matchPrecondition(
  rule: PolicyRule,
  action: { action_type: string; params?: Record<string, unknown>; description?: string } | null,
  taskDescription: string,
): boolean {
  const pre = rule.precondition;
  if (!pre) return false;

  switch (pre.type) {
    case "always":
      return true;

    case "action_match": {
      if (!action) return false;
      // Build a pseudo-action object that mirrors the structure SingleAgent uses
      // so field paths like "params.command" work correctly
      const actionObj = {
        kind: "primitive",
        type: action.action_type,
        params: action.params ?? {},
        description: action.description ?? "",
      };
      const val = String(getNestedField(actionObj, pre.field ?? "") ?? "");
      if (!val) return false;
      try {
        return new RegExp(pre.pattern ?? "", "i").test(val);
      } catch {
        return false;
      }
    }

    case "task_match": {
      try {
        return new RegExp(pre.pattern ?? "", "i").test(taskDescription);
      } catch {
        return false;
      }
    }

    case "consecutive_failures":
      return state.consecutiveFailures >= (pre.count ?? 3);

    case "value_below": {
      // Not directly applicable in extension mode — skip
      return false;
    }

    case "rapid_actions": {
      const now = Date.now();
      const windowMs = pre.withinMs ?? 5000;
      const recent = state.recentActions.filter(
        (a) => a.type === pre.actionType && (now - a.timestamp) < windowMs,
      );
      return recent.length >= (pre.count ?? 5);
    }

    default:
      return false;
  }
}

/**
 * Check the selected action against all policy rules.
 * Returns null if allowed, or a { rule, message } if blocked/overridden.
 */
function checkPolicy(
  action: { action_type: string; params?: Record<string, unknown>; description?: string },
): { effect: string; rule: PolicyRule; message: string } | null {
  if (!state.policy?.rules) return null;

  const rules = [...state.policy.rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  const taskDescription = state.task ?? "";

  for (const rule of rules) {
    if ((rule as any)._disabled) continue;
    if (!matchPrecondition(rule, action, taskDescription)) continue;

    if (rule.effect === "block") {
      return {
        effect: "block",
        rule,
        message: rule.message ?? `Blocked by policy rule: ${rule.id}`,
      };
    }

    if (rule.effect === "escalate") {
      return {
        effect: "escalate",
        rule,
        message: rule.message ?? `Escalation triggered by rule: ${rule.id}`,
      };
    }

    if (rule.effect === "override" && rule.action) {
      return {
        effect: "override",
        rule,
        message: rule.message ?? `Action overridden by rule: ${rule.id}`,
      };
    }

    // "log" effect — don't block, just continue
    // "boost" / "filter" — not applicable to single-action check
  }

  return null;
}

/**
 * Execute a primitive action inline within the heartbeat tool.
 * Eliminates the 2-step overhead where heartbeat records a decision
 * and then the LLM has to make a separate pi tool call to execute.
 *
 * Now: one heartbeat = one complete Observe → Evaluate → Select → Act cycle.
 * This matches SingleAgent.executePrimitive() — same execution model in both modes.
 */
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
          // execSync throws on non-zero exit — capture stdout/stderr
          const output = ((err.stdout as string) || "") + ((err.stderr as string) || "");
          if (output.trim()) {
            // Command produced output but exited non-zero (e.g., grep with no matches)
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
        writeFileSync(fullPath, fileContent.replaceAll(oldText, newText));
        return { success: true, output: `Edited ${path}`, durationMs: Date.now() - startTime };
      }

      default:
        return { success: false, output: "", error: `Unknown action type for inline execution: ${actionType}`, durationMs: Date.now() - startTime };
    }
  } catch (err: any) {
    return { success: false, output: "", error: (err.message ?? String(err)).substring(0, 200), durationMs: Date.now() - startTime };
  }
}

/**
 * Deterministic action selection with full policy gating.
 * Mirrors SingleAgent.applyPolicyRules() — the LLM proposes, this function decides.
 *
 * Flow (matches the paper's Evaluate → Select contract):
 *   1. First pass: apply boost and filter rules across ALL candidates
 *   2. Sort by value (highest first — greedy after boosts)
 *   3. Second pass: check each candidate top-down for block/override/escalate
 *   4. Return the first surviving candidate
 *
 * The LLM NEVER selects. It only proposes and scores. This function decides.
 */

type Candidate = {
  action_type: string;
  description: string;
  value: number;
  reasoning: string;
  params?: Record<string, unknown>;
};

interface SelectionResult {
  selected: Candidate | null;
  effect: "selected" | "all_blocked" | "escalated" | "overridden";
  log: Array<{ rule: string; effect: string; message?: string; target?: string }>;
  message?: string;
  rule?: PolicyRule;
  overrideAction?: any;
}

function selectAction(candidates: Candidate[]): SelectionResult {
  if (!candidates.length) {
    return { selected: null, effect: "all_blocked", log: [], message: "No candidates provided" };
  }

  if (!state.policy?.rules) {
    // No policy — greedy select by value
    const sorted = [...candidates].sort((a, b) => b.value - a.value);
    return { selected: sorted[0], effect: "selected", log: [] };
  }

  // Clone candidates so we can mutate value scores during boost
  let pool = candidates.map(c => ({ ...c }));
  const log: SelectionResult["log"] = [];
  const rules = [...state.policy.rules]
    .filter((r: any) => !(r as any)._disabled)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  const taskDescription = state.task ?? "";

  // ── First pass: boost and filter across all candidates ──
  for (const rule of rules) {
    if (rule.effect === "boost" && matchPrecondition(rule, null, taskDescription)) {
      for (const c of pool) {
        const isMatch = (rule as any).skillName
          ? c.action_type === `skill:${(rule as any).skillName}`
          : ((rule as any).actionType && c.action_type === (rule as any).actionType);
        if (isMatch) {
          c.value += (rule as any).boostValue ?? 0.1;
          log.push({ rule: rule.id, effect: "boost", target: c.description?.substring(0, 30) });
        }
      }
    }

    if (rule.effect === "filter" && matchPrecondition(rule, null, taskDescription)) {
      const before = pool.length;
      pool = pool.filter(c => {
        if ((rule as any).actionType && c.action_type === (rule as any).actionType) return false;
        return true;
      });
      if (pool.length < before) {
        log.push({ rule: rule.id, effect: "filter", message: `Removed ${before - pool.length} candidates` });
      }
    }
  }

  // Sort by value after boosts (highest first = greedy selection)
  pool.sort((a, b) => b.value - a.value);

  // ── Second pass: check each candidate top-down for block/override/escalate ──
  for (const candidate of pool) {
    let blocked = false;

    for (const rule of rules) {
      if (!matchPrecondition(rule, candidate, taskDescription)) continue;

      if (rule.effect === "block") {
        log.push({ rule: rule.id, effect: "block", target: candidate.description?.substring(0, 30), message: rule.message });
        blocked = true;
        break;
      }

      if (rule.effect === "override" && rule.action) {
        log.push({ rule: rule.id, effect: "override", message: rule.message });
        return { selected: null, effect: "overridden", log, overrideAction: rule.action, rule, message: rule.message };
      }

      if (rule.effect === "escalate") {
        log.push({ rule: rule.id, effect: "escalate", message: rule.message });
        return { selected: null, effect: "escalated", log, rule, message: rule.message ?? `Escalation: ${rule.id}` };
      }

      if (rule.effect === "log") {
        log.push({ rule: rule.id, effect: "log", message: rule.message });
      }
    }

    if (!blocked) {
      return { selected: candidate, effect: "selected", log };
    }
  }

  // All candidates blocked
  log.push({ rule: "policy", effect: "all_blocked", message: "Every candidate was blocked by policy" });
  return { selected: null, effect: "all_blocked", log, message: "All proposed actions were blocked by policy" };
}

/**
 * Format a human-readable policy summary for inclusion in the loop prompt.
 * Groups rules by tier so the LLM understands what's enforced.
 */
function formatPolicySummary(policy: Policy): string {
  const lines: string[] = [];
  lines.push(`Policy "${policy.name}" (${policy.rules.length} rules):`);

  const tiers: [string, number, number][] = [
    ["🚫 SAFETY (will block your action)", 1000, Infinity],
    ["⚠️ LIFECYCLE (escalation/completion)", 500, 999],
    ["📋 BEHAVIORAL (rate limits, rewrites)", 100, 499],
    ["💡 PREFERENCE (skill boosts)", 1, 99],
  ];

  for (const [label, min, max] of tiers) {
    const inTier = policy.rules.filter(
      (r) => !((r as any)._disabled) && (r.priority ?? 0) >= min && (r.priority ?? 0) <= max,
    );
    if (inTier.length === 0) continue;
    lines.push(`\n${label}:`);
    for (const r of inTier) {
      lines.push(`  - ${r.id}: ${r.description ?? r.message ?? r.effect}`);
    }
  }

  const disabled = policy.rules.filter((r) => (r as any)._disabled);
  if (disabled.length > 0) {
    lines.push(`\n⏸️ DISABLED: ${disabled.map((r) => r.id).join(", ")}`);
  }

  lines.push("\nNote: Blocked actions will be rejected. Choose alternatives when a rule applies.");
  lines.push("The user can adjust policy via /loop-policy or by asking in chat.");
  return lines.join("\n");
}

export default function (pi: ExtensionAPI) {

  // ── Status widget ──────────────────────────────────────

  function updateStatus(ctx: { ui: ExtensionContext["ui"] }) {
    if (state.running) {
      ctx.ui.setStatus("agent-loop", `🔄 Loop #${state.heartbeat}/${state.maxHeartbeats}`);
    } else {
      ctx.ui.setStatus("agent-loop", undefined);
    }
  }

  // ── The Heartbeat Loop Tool ────────────────────────────
  //
  // Registered as a tool the LLM calls. Each invocation is one heartbeat.
  // The LLM is told to call this tool repeatedly to drive the loop.
  // This keeps everything inside pi's normal turn flow — full TUI visibility.

  pi.registerTool({
    name: "heartbeat",
    label: "Agent Loop Heartbeat",
    description: [
      "Execute one heartbeat of the agent loop. Call this repeatedly to drive the Observe → Evaluate → Select → Act cycle.",
      "You propose and score candidate actions (Evaluate). The POLICY ENGINE selects which action to execute (Select). You do NOT choose — propose honestly and let the policy decide.",
      "The heartbeat tool executes the selected action directly and returns the result. Call heartbeat again to continue.",
    ].join(" "),
    promptSnippet: "Drive the agent loop: observe state, propose scored actions, policy selects, action executes inline, returns result",
    promptGuidelines: [
      "When running a /loop task, call heartbeat repeatedly until complete or max heartbeats reached.",
      "Each heartbeat: observe the current state, then propose 1-5 candidate actions with honest value scores.",
      "You do NOT select which action to take. The deterministic policy engine evaluates all candidates, applies safety rules (block/boost/filter/escalate/override), and selects the best surviving candidate.",
      "Propose ALL reasonable actions — even ones you think policy might block. The policy engine handles filtering. Your job is honest evaluation, not self-censoring.",
      "Always include your reasoning for each candidate's score.",
      "For update_memory, you MUST include params: { key: \"...\", value: \"...\" }.",
      "Users can ask about or change policy rules in natural language. Help them understand what's blocked and why.",
      "Use /loop-policy show to display current rules when a user asks about the policy.",
    ],
    parameters: Type.Object({
      observation: Type.String({ description: "What you observe about the current state" }),
      candidates: Type.Array(
        Type.Object({
          action_type: Type.String({ description: "bash, read, write, edit, update_memory, complete, wait" }),
          description: Type.String({ description: "What this action does" }),
          value: Type.Number({ description: "Score 0.0-1.0, higher = better" }),
          reasoning: Type.String({ description: "Why this score" }),
          params: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Action parameters" })),
        }),
        { description: "1-5 candidate actions with scores" }
      ),
    }),

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      if (!state.running) {
        return {
          content: [{ type: "text", text: "Loop is not running. Use /loop <task> to start." }],
          details: { state: "stopped" },
        };
      }

      if (!params.candidates?.length) {
        return {
          content: [{ type: "text", text: "No candidates provided. Propose at least one action." }],
          details: { state: "error" },
        };
      }

      state.heartbeat++;
      updateStatus(ctx);

      // ── EVALUATE phase complete: LLM proposed candidates ──
      // ── SELECT phase: deterministic policy-gated selection ──
      // The LLM proposed and scored. Now the policy engine decides.
      const selection = selectAction(params.candidates);

      // Build candidate summary showing what was proposed
      const candidateSummary = params.candidates
        .map((c) => `  [${c.value.toFixed(2)}] ${c.action_type}: ${c.description}`)
        .join("\n");

      const policyLogStr = selection.log.length > 0
        ? "\n\nPolicy log:\n" + selection.log.map(l => `  📋 ${l.effect}: ${l.rule} ${l.message ?? ""}`).join("\n")
        : "";

      // ── Handle escalation (policy fires before any candidate is selected) ──
      if (selection.effect === "escalated") {
        state.history.push({
          heartbeat: state.heartbeat,
          action: `ESCALATED: ${selection.message}`,
          value: 0,
          success: false,
          output: `Policy escalation: ${selection.message}`,
        });
        state.lastAction = { type: "escalate", description: selection.message ?? "Policy escalation", success: false };
        state.consecutiveFailures++;
        return {
          content: [{ type: "text", text: `⚠️ Heartbeat #${state.heartbeat}: Policy ESCALATION\n\nRule: ${selection.rule?.id} (priority ${selection.rule?.priority})\nMessage: ${selection.message}\n\nCandidates proposed:\n${candidateSummary}${policyLogStr}\n\nThe policy engine escalated before any action could be selected. Propose different approaches.\n\n${state.maxHeartbeats - state.heartbeat} heartbeats remaining.` }],
          details: { state: "escalated", heartbeat: state.heartbeat, rule: selection.rule?.id, message: selection.message, policyLog: selection.log },
        };
      }

      // ── Handle all candidates blocked ──
      if (selection.effect === "all_blocked") {
        state.history.push({
          heartbeat: state.heartbeat,
          action: `ALL BLOCKED: ${selection.message}`,
          value: 0,
          success: false,
          output: selection.message ?? "All candidates blocked",
        });
        state.lastAction = { type: "blocked", description: selection.message ?? "All blocked", success: false };
        state.consecutiveFailures++;
        return {
          content: [{ type: "text", text: `🚫 Heartbeat #${state.heartbeat}: ALL candidates BLOCKED by policy\n\nCandidates proposed:\n${candidateSummary}${policyLogStr}\n\nEvery proposed action was rejected by policy rules. Propose different actions that comply with the active policy.\n\n${state.maxHeartbeats - state.heartbeat} heartbeats remaining.` }],
          details: { state: "blocked", heartbeat: state.heartbeat, policyLog: selection.log },
        };
      }

      // ── Handle policy override (policy replaces the action entirely) ──
      if (selection.effect === "overridden" && selection.overrideAction) {
        const override = selection.overrideAction;
        state.history.push({
          heartbeat: state.heartbeat,
          action: `OVERRIDE → ${override.type}: ${override.description}`,
          value: 0,
          success: true,
          output: `Policy override by ${selection.rule?.id}`,
        });

        if (override.type === "complete") {
          state.running = false;
          state.lastAction = { type: "complete", description: override.description, success: true };
          updateStatus(ctx);
          return {
            content: [{ type: "text", text: `✅ Task auto-completed by policy rule: ${selection.rule?.id}\n\nReason: ${override.description}${policyLogStr}\n\nAction history:\n${state.history.map(h => `  #${h.heartbeat} [${h.value.toFixed(2)}] ${h.action}`).join("\n")}` }],
            details: { state: "complete", history: state.history, policyLog: selection.log },
          };
        }

        if (override.type === "wait") {
          state.lastAction = { type: "wait", description: override.description, success: true };
          return {
            content: [{ type: "text", text: `⏳ Heartbeat #${state.heartbeat}: Policy override → wait\n\nRule: ${selection.rule?.id}\nReason: ${override.description}${policyLogStr}\n\n${state.maxHeartbeats - state.heartbeat} heartbeats remaining.` }],
            details: { state: "waiting", heartbeat: state.heartbeat, policyLog: selection.log },
          };
        }

        // Other override action types
        state.lastAction = { type: override.type, description: override.description, success: true };
        return {
          content: [{ type: "text", text: `🔀 Heartbeat #${state.heartbeat}: Policy OVERRIDE\n\nRule: ${selection.rule?.id}\nOverride action: ${override.type}: ${override.description}${policyLogStr}\n\n${state.maxHeartbeats - state.heartbeat} heartbeats remaining.` }],
          details: { state: "overridden", heartbeat: state.heartbeat, override, policyLog: selection.log },
        };
      }

      // ── Normal selection — policy approved this candidate ──
      const selected = selection.selected!;

      // Track action for rate-limiting rules
      state.recentActions.push({ type: selected.action_type, timestamp: Date.now() });
      if (state.recentActions.length > 50) state.recentActions.shift();

      // Record in history
      state.history.push({
        heartbeat: state.heartbeat,
        action: `${selected.action_type}: ${selected.description}`,
        value: selected.value,
        success: true,
        output: "",
      });

      // Show what the policy selected vs what was proposed
      const selectionNote = selection.log.length > 0
        ? `\n\nPolicy evaluated ${params.candidates.length} candidates (${selection.log.length} rules fired).${policyLogStr}`
        : `\n\nPolicy: no rules applied — selected highest-value candidate.`;

      onUpdate?.({
        content: [{ type: "text", text: `Heartbeat #${state.heartbeat}\n\nObservation: ${params.observation}\n\nCandidates (LLM proposed):\n${candidateSummary}\n\nPolicy selected: ${selected.action_type} [${selected.value.toFixed(2)}]${selectionNote}` }],
        details: { heartbeat: state.heartbeat, selected: selected.action_type, policyLog: selection.log },
      });

      // ── ACT: execute the policy-selected action ──

      if (selected.action_type === "complete") {
        state.running = false;
        state.lastAction = { type: "complete", description: selected.description, success: true };
        state.consecutiveFailures = 0;
        updateStatus(ctx);
        return {
          content: [{ type: "text", text: `✅ Task complete (${state.heartbeat} heartbeats).${policyLogStr}\n\nSummary: ${selected.description}\n\nAction history:\n${state.history.map(h => `  #${h.heartbeat} [${h.value.toFixed(2)}] ${h.action}`).join("\n")}` }],
          details: { state: "complete", history: state.history, policyLog: selection.log },
        };
      }

      if (selected.action_type === "wait") {
        state.lastAction = { type: "wait", description: "Waiting", success: true };
        const histEntry = state.history[state.history.length - 1];
        histEntry.output = "waited";
        return {
          content: [{ type: "text", text: `⏳ Heartbeat #${state.heartbeat}: Waiting.${policyLogStr}\n\nContinue calling heartbeat. ${state.maxHeartbeats - state.heartbeat} heartbeats remaining.` }],
          details: { state: "waiting", heartbeat: state.heartbeat, policyLog: selection.log },
        };
      }

      if (selected.action_type === "update_memory") {
        if (!selected.params?.key) {
          const histEntry = state.history[state.history.length - 1];
          histEntry.success = false;
          histEntry.output = "ERROR: update_memory requires params.key and params.value";
          state.lastAction = { type: "update_memory", description: "Missing params", success: false };
          state.consecutiveFailures++;
          return {
            content: [{ type: "text", text: `❌ Heartbeat #${state.heartbeat}: update_memory requires params with "key" and "value" fields.\n\nYou must include: { "params": { "key": "your_key", "value": "your_value" } }\n\n${state.maxHeartbeats - state.heartbeat} heartbeats remaining.` }],
            details: { state: "error", heartbeat: state.heartbeat },
          };
        }
        const key = selected.params.key as string;
        const value = selected.params?.value as string ?? selected.description;
        state.memory[key] = value;
        state.lastAction = { type: "update_memory", description: `Set ${key}`, success: true };
        state.consecutiveFailures = 0;
        const histEntry = state.history[state.history.length - 1];
        histEntry.output = `memory[${key}] = ${value}`;
        return {
          content: [{ type: "text", text: `📝 Memory updated: ${key} = ${value}${policyLogStr}\n\nCurrent memory:\n${Object.entries(state.memory).map(([k, v]) => `  ${k}: ${v}`).join("\n") || "  (empty)"}\n\nContinue calling heartbeat. ${state.maxHeartbeats - state.heartbeat} heartbeats remaining.` }],
          details: { state: "running", memory: state.memory, policyLog: selection.log },
        };
      }

      // ── Execute bash/read/write/edit inline ──
      // One heartbeat = one complete Observe → Evaluate → Select → Act cycle.
      // No 2-step overhead. The action executes here and the result is returned.
      const cwd = ctx.cwd ?? process.cwd();
      const execResult = executeInline(selected.action_type, selected.params ?? {}, cwd);

      // Update history with actual execution result
      const histEntry = state.history[state.history.length - 1];
      histEntry.success = execResult.success;
      histEntry.output = execResult.output.substring(0, 200);

      state.lastAction = { type: selected.action_type, description: selected.description, success: execResult.success };

      if (execResult.success) {
        state.consecutiveFailures = 0;
      } else {
        state.consecutiveFailures++;
      }

      const remaining = state.maxHeartbeats - state.heartbeat;
      const memoryStr = Object.keys(state.memory).length > 0
        ? `\n\nMemory:\n${Object.entries(state.memory).map(([k, v]) => `  ${k}: ${v}`).join("\n")}`
        : "";

      const icon = execResult.success ? "✓" : "✗";
      const resultSummary = execResult.error
        ? `\nResult: ${icon} FAILED (${execResult.durationMs}ms)\nError: ${execResult.error}`
        : `\nResult: ${icon} OK (${execResult.durationMs}ms)`;

      const outputStr = execResult.output
        ? `\n\nOutput:\n${execResult.output.substring(0, 5000)}`
        : "";

      return {
        content: [{ type: "text", text: `🎯 Heartbeat #${state.heartbeat}: Policy selected ${selected.action_type} (value: ${selected.value.toFixed(2)})${policyLogStr}\n\nAction: ${selected.description}${resultSummary}${outputStr}\n\nContinue calling heartbeat. ${remaining} heartbeats remaining.${memoryStr}` }],
        details: {
          state: "running",
          heartbeat: state.heartbeat,
          selected: {
            type: selected.action_type,
            description: selected.description,
            value: selected.value,
            params: selected.params,
          },
          result: {
            success: execResult.success,
            output: execResult.output.substring(0, 2000),
            error: execResult.error,
            durationMs: execResult.durationMs,
          },
          policyLog: selection.log,
        },
      };
    },

    renderCall(args, theme) {
      // renderCall fires before execute — selection hasn't happened yet.
      // Show what the LLM proposed; policy will decide in execute().
      const { Text } = await import("@mariozechner/pi-tui");
      let text = theme.fg("toolTitle", theme.bold("heartbeat "));
      text += theme.fg("accent", `#${state.heartbeat + 1}`);
      text += theme.fg("dim", ` — ${args.candidates?.length ?? 0} candidates proposed`);
      if (args.candidates && args.candidates.length > 0) {
        text += "\n";
        for (let i = 0; i < Math.min(args.candidates.length, 5); i++) {
          const c = args.candidates[i];
          const bar = "█".repeat(Math.round((c.value || 0) * 10));
          text += `\n  [${(c.value || 0).toFixed(2)}] ${bar} ${theme.fg("muted", c.action_type)}: ${theme.fg("dim", (c.description || "").slice(0, 40))}`;
        }
        text += theme.fg("dim", "\n  ⏳ Policy engine will select...");
      }
      return new Text(text, 0, 0);
    },
  });

  // ── Commands ───────────────────────────────────────────

  pi.registerCommand("loop", {
    description: "Run a task through the agent heartbeat loop (Observe → Evaluate → Select → Act)",
    handler: async (args, ctx) => {
      if (!args?.trim()) {
        ctx.ui.notify("Usage: /loop <task description>", "warning");
        return;
      }

      if (state.running) {
        ctx.ui.notify("Loop already running. Use /loop-stop first.", "warning");
        return;
      }

      // Reset state
      state.running = true;
      state.heartbeat = 0;
      state.task = args.trim();
      state.lastAction = null;
      state.history = [];
      state.abortController = new AbortController();
      state.recentActions = [];
      state.consecutiveFailures = 0;

      // Load policy from standard locations
      state.policy = loadPolicy(ctx.cwd ?? process.cwd());
      if (state.policy) {
        ctx.ui.notify(`Policy loaded: ${state.policy.name} (${state.policy.rules.length} rules)`, "info");
      }

      updateStatus(ctx);
      ctx.ui.notify(`Starting loop: ${state.task}`, "info");

      // Inject the task as a user message with loop instructions
      const prompt = `You are operating in AGENT LOOP mode. Your task:

${state.task}

## Instructions

Drive the task by calling the \`heartbeat\` tool repeatedly. Each call is one cycle of:
1. **Observe** — Describe what you see (files, state, prior results)
2. **Evaluate** — Propose 1-5 candidate actions with value scores (0.0-1.0). Be honest — propose ALL reasonable options.
3. **Select** — The POLICY ENGINE selects the action, not you. You do not choose. Propose candidates and the deterministic policy decides.
4. **Act** — The heartbeat executes the selected action inline and returns the result. No separate tool call needed.

**Important**: You propose and score. The policy engine selects. Do NOT self-censor — if an action is relevant, propose it even if you think policy might block it. The policy engine handles safety.

For \`update_memory\`, always include params: \`{ "key": "...", "value": "..." }\`.

Keep going until the policy selects "complete" or you reach ${state.maxHeartbeats} heartbeats.

## Scoring Guide
- 1.0 = Critical, do now
- 0.7-0.9 = High value, directly advances task
- 0.4-0.6 = Moderate, useful but not urgent
- 0.1-0.3 = Low value, speculative
- 0.0 = No value

## Current Memory
${Object.keys(state.memory).length > 0 ? Object.entries(state.memory).map(([k, v]) => `${k}: ${v}`).join("\n") : "(empty)"}

## Active Policy
${state.policy ? formatPolicySummary(state.policy) : "No policy loaded — all actions are allowed."}

Start by calling heartbeat with your initial observation and candidate actions.`;

      pi.sendUserMessage(prompt);
    },
  });

  pi.registerCommand("loop-stop", {
    description: "Stop the running agent loop",
    handler: async (_args, ctx) => {
      if (!state.running) {
        ctx.ui.notify("No loop running.", "info");
        return;
      }
      state.running = false;
      state.abortController?.abort();
      updateStatus(ctx);
      ctx.ui.notify(`Loop stopped after ${state.heartbeat} heartbeats.`, "info");
    },
  });

  pi.registerCommand("loop-status", {
    description: "Show agent loop status",
    handler: async (_args, ctx) => {
      const lines = [
        `Running: ${state.running}`,
        `Heartbeat: ${state.heartbeat}/${state.maxHeartbeats}`,
        `Task: ${state.task || "(none)"}`,
        `Last action: ${state.lastAction ? `${state.lastAction.type}: ${state.lastAction.description}` : "(none)"}`,
        `Memory keys: ${Object.keys(state.memory).join(", ") || "(empty)"}`,
        `History: ${state.history.length} actions`,
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  pi.registerCommand("loop-memory", {
    description: "Show agent loop memory",
    handler: async (_args, ctx) => {
      if (Object.keys(state.memory).length === 0) {
        ctx.ui.notify("Memory is empty.", "info");
        return;
      }
      const lines = Object.entries(state.memory).map(([k, v]) => `${k}: ${v}`);
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // ── Policy Command ─────────────────────────────────────
  //
  // Users can view, add, remove, enable/disable rules via chat.
  // The LLM can also suggest policy changes through normal conversation.

  pi.registerCommand("loop-policy", {
    description: "Manage policy rules. Usage: /loop-policy [show|add|remove|enable|disable|save|load|help]",
    handler: async (args, ctx) => {
      const parts = (args ?? "").trim().split(/\s+/);
      const subcmd = parts[0] || "show";

      // Ensure policy is loaded
      if (!state.policy && subcmd !== "load" && subcmd !== "help") {
        state.policy = loadPolicy(ctx.cwd ?? process.cwd());
        if (!state.policy) {
          state.policy = { version: 1, name: "session-policy", rules: [], defaults: { maxCandidates: 5, minActionValue: 0.1, explorationRate: 0 } };
          ctx.ui.notify("No policy file found. Created empty in-memory policy.\nUse /loop-policy add to create rules, or /loop-policy load <path> to load one.", "info");
          return;
        }
      }

      switch (subcmd) {
        case "show": {
          if (!state.policy || state.policy.rules.length === 0) {
            ctx.ui.notify("Policy: (no rules loaded)\n\nUse /loop-policy add <json> or /loop-policy load <path>", "info");
            return;
          }
          const lines = [
            `Policy: ${state.policy.name} (v${state.policy.version})`,
            `Rules: ${state.policy.rules.length}`,
            "",
            ...state.policy.rules.map((r: any, i: number) => {
              const disabled = r._disabled ? " [DISABLED]" : "";
              const effect = r.effect.toUpperCase();
              return `  ${i + 1}. [${r.priority}] ${effect} "${r.id}"${disabled}\n     ${r.description ?? "(no description)"}`;
            }),
            "",
            "Commands: /loop-policy [show|add|remove|enable|disable|save|load|help]",
          ];
          ctx.ui.notify(lines.join("\n"), "info");
          break;
        }

        case "add": {
          // Usage: /loop-policy add {"id":"...","priority":...,"precondition":{...},"effect":"...","message":"..."}
          const jsonStr = parts.slice(1).join(" ");
          if (!jsonStr) {
            ctx.ui.notify(
              'Usage: /loop-policy add <rule-json>\n\n' +
              'Example:\n' +
              '  /loop-policy add {"id":"block-curl","priority":1000,"precondition":{"type":"action_match","field":"params.command","pattern":"curl"},"effect":"block","message":"No curl allowed"}\n\n' +
              'Or just describe the rule you want in chat — e.g.:\n' +
              '  "Add a policy rule that blocks any wget commands"',
              "info",
            );
            return;
          }
          try {
            const rule = JSON.parse(jsonStr);
            if (!rule.id || !rule.precondition || !rule.effect) {
              ctx.ui.notify("Rule must have: id, precondition, effect", "warning");
              return;
            }
            rule.priority = rule.priority ?? 500;
            state.policy!.rules.push(rule);
            ctx.ui.notify(`✅ Rule added: [${rule.priority}] ${rule.effect.toUpperCase()} "${rule.id}"\n${rule.description ?? rule.message ?? ""}`, "info");
          } catch (e) {
            ctx.ui.notify(`Invalid JSON: ${e}\n\nTip: describe the rule in natural language and ask me to format it for you.`, "warning");
          }
          break;
        }

        case "remove": {
          const ruleId = parts[1];
          if (!ruleId) {
            ctx.ui.notify("Usage: /loop-policy remove <rule-id>\nUse /loop-policy show to see rule IDs.", "info");
            return;
          }
          const before = state.policy!.rules.length;
          state.policy!.rules = state.policy!.rules.filter((r: any) => r.id !== ruleId);
          if (state.policy!.rules.length < before) {
            ctx.ui.notify(`✅ Removed rule: ${ruleId}`, "info");
          } else {
            ctx.ui.notify(`Rule not found: ${ruleId}`, "warning");
          }
          break;
        }

        case "enable": {
          const ruleId = parts[1];
          if (!ruleId) { ctx.ui.notify("Usage: /loop-policy enable <rule-id>", "info"); return; }
          const rule = state.policy!.rules.find((r: any) => r.id === ruleId);
          if (rule) { delete (rule as any)._disabled; ctx.ui.notify(`✅ Enabled: ${ruleId}`, "info"); }
          else { ctx.ui.notify(`Rule not found: ${ruleId}`, "warning"); }
          break;
        }

        case "disable": {
          const ruleId = parts[1];
          if (!ruleId) { ctx.ui.notify("Usage: /loop-policy disable <rule-id>", "info"); return; }
          const rule = state.policy!.rules.find((r: any) => r.id === ruleId);
          if (rule) { (rule as any)._disabled = true; ctx.ui.notify(`⏸️ Disabled: ${ruleId}`, "info"); }
          else { ctx.ui.notify(`Rule not found: ${ruleId}`, "warning"); }
          break;
        }

        case "save": {
          const savePath = parts[1] || join(ctx.cwd ?? process.cwd(), "policy.json");
          try {
            // Strip internal fields before saving
            const clean = {
              ...state.policy,
              rules: state.policy!.rules.map((r: any) => {
                const { _disabled, ...rest } = r;
                return rest;
              }),
            };
            writeFileSync(savePath, JSON.stringify(clean, null, 2));
            ctx.ui.notify(`✅ Policy saved to: ${savePath}`, "info");
          } catch (e) {
            ctx.ui.notify(`Failed to save: ${e}`, "error");
          }
          break;
        }

        case "load": {
          const loadPath = parts[1];
          if (!loadPath) { ctx.ui.notify("Usage: /loop-policy load <path>", "info"); return; }
          if (!existsSync(loadPath)) { ctx.ui.notify(`File not found: ${loadPath}`, "warning"); return; }
          try {
            state.policy = JSON.parse(readFileSync(loadPath, "utf-8"));
            ctx.ui.notify(`✅ Loaded: ${state.policy!.name} (${state.policy!.rules.length} rules)`, "info");
          } catch (e) {
            ctx.ui.notify(`Failed to load: ${e}`, "error");
          }
          break;
        }

        case "help":
        default: {
          ctx.ui.notify([
            "🛡️ Agent Loop Policy — Safety & behavior rules for the heartbeat loop",
            "",
            "Commands:",
            "  /loop-policy show              — List all rules with priority and status",
            "  /loop-policy add <rule-json>   — Add a new rule",
            "  /loop-policy remove <rule-id>  — Remove a rule by ID",
            "  /loop-policy enable <rule-id>  — Re-enable a disabled rule",
            "  /loop-policy disable <rule-id> — Temporarily disable a rule",
            "  /loop-policy save [path]       — Save current policy to file",
            "  /loop-policy load <path>       — Load policy from file",
            "",
            "You can also ask in natural language:",
            '  "Show me the current safety rules"',
            '  "Add a rule that blocks any curl commands"',
            '  "Disable the no-sudo rule for this session"',
            '  "What would happen if I tried to run rm -rf?"',
            "",
            "Rule effects: block, override, boost, filter, escalate, log",
            "Priority tiers: 1000+ safety, 500-999 lifecycle, 100-499 behavioral, 1-99 preference",
          ].join("\n"), "info");
          break;
        }
      }
    },
  });

  pi.registerCommand("loop-config", {
    description: "Set loop config. Usage: /loop-config max-heartbeats <n>",
    handler: async (args, ctx) => {
      if (!args?.trim()) {
        ctx.ui.notify(`Current config:\n  max-heartbeats: ${state.maxHeartbeats}`, "info");
        return;
      }
      const parts = args.trim().split(/\s+/);
      if (parts[0] === "max-heartbeats" && parts[1]) {
        const n = parseInt(parts[1], 10);
        if (isNaN(n) || n < 1 || n > 100) {
          ctx.ui.notify("max-heartbeats must be 1-100", "warning");
          return;
        }
        state.maxHeartbeats = n;
        ctx.ui.notify(`max-heartbeats set to ${n}`, "info");
      } else {
        ctx.ui.notify("Unknown config. Available: max-heartbeats <n>", "warning");
      }
    },
  });

  // ── Lifecycle ──────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    updateStatus(ctx);

    // Load policy at startup and show summary
    state.policy = loadPolicy(ctx.cwd ?? process.cwd());

    const lines = ["🔄 Agent Loop extension loaded"];
    if (state.policy) {
      const safetyRules = state.policy.rules.filter((r: any) => (r.priority ?? 0) >= 1000);
      const lifecycleRules = state.policy.rules.filter((r: any) => (r.priority ?? 0) >= 500 && (r.priority ?? 0) < 1000);
      const otherRules = state.policy.rules.filter((r: any) => (r.priority ?? 0) < 500);
      lines.push(`🛡️ Policy: ${state.policy.name} — ${state.policy.rules.length} rules (${safetyRules.length} safety, ${lifecycleRules.length} lifecycle, ${otherRules.length} preference)`);
      if (safetyRules.length > 0) {
        lines.push(`   Safety rules active: ${safetyRules.map((r: any) => r.id).join(", ")}`);
      }
    } else {
      lines.push("⚠️ No policy loaded — all actions allowed. Use /loop-policy load <path> or /loop-policy add to set rules.");
    }
    lines.push("   Use /loop-policy to view or modify rules, or just ask in chat.");
    ctx.ui.notify(lines.join("\n"), "info");
  });

  pi.on("session_shutdown", async () => {
    state.running = false;
    state.abortController?.abort();
  });
}
