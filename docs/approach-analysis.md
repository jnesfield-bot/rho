# Issue #4: Heartbeat 2-Step Overhead — Approach Analysis

## Problem
For bash/read/write/edit, heartbeat returns "Now execute this action using the appropriate tool."
One action = 2 LLM turns (heartbeat to decide → pi tool to execute). 
This doubles cost and breaks the "one heartbeat = one complete cycle" invariant.

## Approach A: Inline Execution via Node.js APIs
Execute bash/read/write/edit directly inside the heartbeat tool's execute() function
using Node.js child_process.execSync and fs APIs.

Pros:
- Eliminates 2-step overhead completely
- One heartbeat = one complete O→E→S→A cycle (matches paper)
- Simple implementation, matches SingleAgent.executePrimitive()
- Result returned directly in heartbeat response — LLM sees output immediately

Cons:
- execSync is blocking (but so is SingleAgent's approach)
- Doesn't use pi's tool rendering (output won't show as a separate tool call in TUI)
- Loses pi tool features (read's image support, bash's line limits)

## Approach B: Programmatic Tool Invocation via pi SDK
Call pi's registered tools (createBashTool, etc.) from within the heartbeat execute().

Pros:
- Reuses pi's full tool implementations with all features
- Output renders in TUI as expected

Cons:
- pi's extension API doesn't expose a way to invoke tools from within tools
- Would require SDK changes (not feasible without modifying pi itself)
- Tool execute signatures expect LLM context (toolCallId, signal, etc.)

## Approach C: Return Tool Call Directive
Have heartbeat return a structured response that triggers pi to auto-invoke the next tool.

Pros:
- Clean separation of concerns
- Would preserve TUI tool rendering

Cons:
- pi doesn't support tool chaining / auto-invocation from tool results
- Would require significant pi SDK changes
- Fragile coupling to pi internals

## Verdict: Approach A

Approach B and C require pi SDK changes we can't make. Approach A:
- Is what SingleAgent already does (proven pattern)
- Fully eliminates the 2-step overhead
- Returns execution results directly in the heartbeat response
- Makes "one heartbeat = one complete cycle" true in both standalone and extension modes

Trade-off: We lose pi's TUI rendering for individual tool calls. But the heartbeat
already renders via renderCall/renderResult, and the execution output is included
in the heartbeat result text. The TUI still shows everything — just within the
heartbeat tool's output rather than as separate tool calls.
