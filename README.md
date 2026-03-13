# Rho (ρ)

**An autonomous cognitive coding agent built on [pi](https://github.com/badlogic/pi-mono).** RL-inspired heartbeat engine, Rainbow-prioritized memory, tri-store cognition, production-rule policy, and a full interactive TUI.

> ρ comes after π — this is pi with structure, memory, and a decision loop.

> **📄 Paper**: See [`paper/rho.tex`](paper/rho.tex) ([PDF](paper/rho.pdf)) — *"Rho: A Cognitive Architecture for Autonomous LLM Agents with Reinforcement Learning–Inspired Memory and Policy"* by J. Nesfield & Claude.

---

## What Rho Is

Rho is a **cognitive architecture** layered on top of pi. Where pi is a reactive coding agent — you ask, it does — Rho adds structured decision-making, persistent memory, safety constraints, and self-monitoring. Think of it as pi that can *plan*, *remember*, *learn from mistakes*, and *know when it's stuck*.

### How Rho Differs from Pi

| | **Pi** | **Rho** |
|---|--------|---------|
| **Decision model** | Reactive: user asks → LLM responds → tools execute | Structured heartbeat loop: Observe → Evaluate → Select → Act → Record |
| **Memory** | Context window only — forgets between sessions | Tri-store cognitive memory: episodic (what happened), semantic (what I know), procedural (how to do things) |
| **Action selection** | LLM decides everything in one generation step | LLM *proposes and scores* candidates; a deterministic policy engine *selects* |
| **Safety** | Trusts the LLM's judgment | Production-rule policy with priority tiers: safety rules block dangerous actions *before* execution |
| **Self-awareness** | None — no concept of being stuck | Impasse detection: tracks consecutive failures, repeated actions, no-progress heartbeats → escalates |
| **Learning** | Stateless between conversations | Replay buffer records every transition; procedural rules gain/lose confidence via Bayesian updates |
| **Observation** | Raw tool outputs fed back to LLM | Blackboard: structured, zoned observation surface with lens-based filtering (inspired by Glyph) |
| **Multi-step tasks** | LLM chains tool calls freely | Skills (Options framework): named, reusable multi-step sequences with per-step tracking |
| **Auditability** | Conversation transcript | Full heartbeat trace: every candidate action scored, policy rules that fired, memory writes, board snapshots |
| **Research capability** | None built-in | arXiv skill: search papers, download LaTeX source, extract algorithms, implement them |
| **Code search** | `grep` / `find` via bash | Multi-stream semantic code search (TF-IDF + identity + component matching) across git repos |

**In short**: Pi is a great interactive coding assistant. Rho is an autonomous agent that can be given a task and work through it methodically — observing its environment, scoring options, applying safety rules, executing actions, recording what happened, and learning from the results.

---

## What Rho Can Do

### 🔄 Heartbeat Loop — Structured Autonomous Execution
Every action follows a disciplined five-phase cycle:
1. **Observe** — Populate the blackboard from workspace state, all three memory stores, and the last action result
2. **Evaluate** — LLM proposes 1–5 candidate actions, each with a value score (0.0–1.0) and reasoning
3. **Select** — Policy engine checks safety rules, boosts/filters candidates, detects impasses, then picks the best surviving action
4. **Act** — Execute a primitive (bash, read, write, edit, grep, find) or a multi-step skill
5. **Record** — Write to tri-store memory, append replay buffer, update impasse tracking

### 🧠 Tri-Store Cognitive Memory
Three memory stores modeled after human cognition, each with **write**, **read**, and **manage** operations:

- **Episodic** — "What happened." Timestamped transitions from every heartbeat. Enables: "When did I last try this? What went wrong?"
- **Semantic** — "What I know." Entities, facts, and relationships extracted from experience. A lightweight knowledge graph.
- **Procedural** — "How to do things." Learned rules with Bayesian confidence scores. Feeds directly into the policy engine.

Memory management includes **merging** (deduplicate), **reflection** (episodic → semantic → procedural promotion), and **forgetting** (Ebbinghaus-inspired decay with importance weighting). Each store has a configurable budget — when exceeded, compaction runs automatically.

### 🎯 Production-Rule Policy Engine
Codified rules that constrain the LLM's decisions — like guardrails with teeth:

| Priority Tier | Purpose | Examples |
|---------------|---------|---------|
| 1000+ | **Safety** | Block `rm -rf /`, block `sudo`, block env dumps |
| 500–999 | **Lifecycle** | Escalate after 3 failures, auto-complete when criteria met |
| 100–499 | **Behavioral** | Rate-limit rapid bash loops, prefer structured search over raw grep |
| 1–99 | **Preference** | Boost arxiv-research for paper tasks, boost code-search for function-finding |

Rules support: **block**, **override**, **boost**, **filter**, **escalate**, and **log** effects. The policy is JSON — readable, editable, versionable. An executive agent can inject policy rules into workers.

### 📋 Blackboard — Structured Observation Surface
The agent doesn't see raw state — it sees a **zoned canvas** rendered through a **lens**:

```
╔════════════════════════════════════════════════════════════════════════╗
║  HEADER                                                              ║
║  Agent: agent-001  Heartbeat: #7  Time: 05:12:33                     ║
╠──────────────────────────────────────────────────────────────════════╣
║  TASK                                                                ║
║  Implement DQN from arXiv:1312.5602                                  ║
║  Criteria:                                                           ║
║    ☐ Extract algorithm from paper                                    ║
║    ☐ Implement Q-network                                             ║
╠──────────────────────────────────────────────────────────────════════╣
║  LAST ACTION                                                         ║
║  ✓ bash: node extract-algorithms.mjs /tmp/dqn-src                    ║
║    OK (230ms)                                                        ║
║    │ Found 1 algorithm: "Deep Q-learning with Experience Replay"     ║
╠──────────────────────────────────────────────────────────────════════╣
║  EPISODIC (recent)                                                   ║
║  SEMANTIC (knowledge)                                                ║
║  PROCEDURAL (rules)                                                  ║
║  WORKING MEMORY (3)                                                  ║
║  SKILLS (7 available)                                                ║
╚════════════════════════════════════════════════════════════════════════╝
```

**Lenses** control what each agent role sees:
- **Executive** — Everything: children, inputs, policy, all memory
- **Worker** — Task, action, memory, workspace, skills (no children/inputs)
- **Monitor** — Task, children, inputs (oversight only)
- **Minimal** — Just task + last action

Follows Glyph's density principles: tight spacing, high data-ink ratio, hierarchy through indentation.

### 🔬 Skills — Temporally Extended Actions
Skills are the **Options framework** from RL (Sutton, Precup & Singh 1999) applied to LLM agents. Each skill is a self-contained capability with a `SKILL.md` definition and executable scripts:

| Skill | What It Does |
|-------|-------------|
| **arxiv-research** | Search arXiv, download LaTeX source, extract algorithms/pseudocode, implement them |
| **code-search** | Multi-stream semantic search across git repos (TF-IDF + identity + component matching) |
| **memory** | Tri-store cognitive memory operations: read, write, manage (merge/reflect/forget) |
| **policy** | Production-rule policy evaluation, validation, and self-modification |
| **replay-buffer** | Record transitions, query by time/type/success/tag, random sampling, episode replay |
| **blackboard** | Render observation board, lens filtering, zone management |
| **skill-sequencer** | Compile skills into deterministic, replayable, editable JSON sequences |

When the agent selects a skill, it plans and executes the full sequence of primitive steps within a single heartbeat — maintaining the one-action-per-heartbeat invariant at the macro level.

### 🌈 Rainbow-Inspired Replay
Experience replay prioritized by **novelty × usefulness × recency** (arXiv:1710.02298):

- **Novelty** = action rarity + prediction surprise (the TD-error analog)
- **Usefulness** = failure indicator + rare action bonus + base learning potential
- **Multi-step chaining** — sampled transitions include ±3 temporal neighbors (like Rainbow's n-step returns)
- **Importance sampling correction** — compensates for non-uniform sampling bias
- **Outcome distributions** — procedural rules track success/failure sliding windows, not just mean confidence (distributional RL insight)

### 🚨 Impasse Detection & Escalation
The agent knows when it's stuck:
- **Consecutive failures** ≥ 3 → escalate to parent
- **Repeated identical actions** ≥ 3 → break the loop
- **No progress** for N heartbeats → request guidance
- **Low confidence** — top candidate value below threshold → ask for help

Escalation is healthy, not failure. A worker that knows its limits is better than one that flails.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  pi TUI (interactive)                                        │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  Rho Extension (src/extension.ts)                       ││
│  │  ┌───────────────────────────────────────────────────┐  ││
│  │  │  HEARTBEAT LOOP                                   │  ││
│  │  │                                                   │  ││
│  │  │  OBSERVE ──────> EVALUATE ──────> SELECT          │  ││
│  │  │  [Blackboard]    [LLM scores     [Policy rules    │  ││
│  │  │  [+3 memory       candidates]     + greedy]       │  ││
│  │  │  stores]              │                │          │  ││
│  │  │       │               │                │          │  ││
│  │  │       └── RECORD <────┴──── ACT <──────┘          │  ││
│  │  │           [tri-store]       [primitive or skill]   │  ││
│  │  │           [+ replay]                              │  ││
│  │  └───────────────────────────────────────────────────┘  ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

**Key design principle**: The LLM participates *only* in the Evaluate phase. Observation is structured code (blackboard). Selection is deterministic code (policy rules, then greedy). Recording is automatic (memory writes, replay buffer). This makes Rho **auditable**, **safe**, and **debuggable**.

---

## Quick Start

### Docker (recommended)

```bash
git clone https://github.com/jnesfield-bot/rho.git
cd rho
docker build -t rho .
docker run -it -e ANTHROPIC_API_KEY=sk-ant-... rho
```

### Without Docker

```bash
git clone https://github.com/jnesfield-bot/rho.git
cd rho && npm install
ANTHROPIC_API_KEY=sk-ant-... npx tsx src/main.ts [work-directory]
```

### Interactive TUI Commands

Once running in the pi TUI:

| Command | Description |
|---------|-------------|
| `/loop <task>` | Run a task through the heartbeat loop |
| `/loop-status` | Show current loop state (heartbeat, task, memory, history) |
| `/loop-stop` | Stop a running loop |
| `/loop-memory` | Show agent working memory |
| `/loop-config max-heartbeats <n>` | Set max heartbeats (1–100) |

---

## Project Structure

```
rho/
├── src/
│   ├── types.ts          # Core types: State, Action, ScoredAction, TaskBrief, SkillExecution, etc.
│   ├── agent-loop.ts     # Abstract base class — the heartbeat lifecycle
│   ├── single-agent.ts   # Concrete agent: blackboard + LLM eval + policy select + execution
│   ├── blackboard.ts     # Zoned observation canvas with lens filtering
│   ├── extension.ts      # Pi extension: /loop commands, heartbeat tool, TUI integration
│   ├── main.ts           # Standalone demo runner with formatted event logging
│   └── index.ts          # Public API exports
├── skills/
│   ├── arxiv-research/   # Search papers, download source, extract algorithms
│   ├── code-search/      # Multi-stream semantic search across git repos
│   ├── memory/           # Tri-store cognitive memory operations
│   ├── policy/           # Production-rule policy system
│   ├── replay-buffer/    # Multimodal experience replay
│   ├── blackboard/       # Observation board rendering
│   └── skill-sequencer/  # Compile skills into deterministic sequences
├── policies/
│   └── worker-default.json  # Default worker policy (safety + lifecycle + preferences)
├── sequences/
│   └── implement-dqn.json   # Example: compiled DQN implementation sequence
├── paper/
│   ├── rho.tex              # Full academic paper
│   └── rho.pdf              # Compiled PDF
├── tests/
│   └── rho-prompts.md       # Interactive TUI test prompts
├── test-all.sh              # Automated test suite
├── test-quick.sh            # Quick test suite
├── Dockerfile               # Containerized deployment
└── package.json
```

---

## Evolution — How Rho Got Here

Rho was built iteratively across 20 commits, each adding a layer of cognitive capability:

| Phase | What Was Added | Key Insight |
|-------|---------------|-------------|
| **v0.1** — Heartbeat | `AgentLoop` base class, `SingleAgent`, four-phase cycle | Separate evaluation from selection — the LLM proposes, code decides |
| **v0.2** — TUI | Pi extension with `/loop` commands, heartbeat tool | The loop should live inside pi's interactive TUI, not replace it |
| **v0.3** — Docker | Containerized deployment, `run.sh` | Isolation for autonomous operation |
| **v0.4** — Skills | arXiv research, skill-sequencer, Options framework | Temporally extended actions — one heartbeat at the macro level, many steps underneath |
| **v0.5** — Blackboard | Zoned observation canvas, lens filtering, Glyph-inspired density | The agent needs a *structured* view of the world, not raw state dumps |
| **v0.6** — Replay Buffer | Multimodal transition recording, indexing, querying | Record everything — the raw material for learning |
| **v0.7** — Policy | Production-rule engine, safety blocks, escalation, impasse detection | The LLM should be constrained by codified rules, not trusted blindly |
| **v0.8** — Code Search | Multi-stream semantic search across repos (RepoRift-inspired) | `grep` is not enough — you need name/docstring/body/component matching |
| **v0.9** — Tri-Store Memory | Episodic, semantic, procedural stores with write/read/manage | Memory is the learning mechanism when you can't do gradient updates |
| **v1.0** — Rainbow Priority | Novelty × usefulness scoring, multi-step chaining, outcome distributions | Not all experiences are equally useful — prioritize by learning potential |
| **v1.1** — Self-Repair | Blackboard visibility fix, semantic `accessCount` tracking on read, real TD-error priority scoring from transition files | The architecture had gaps between design intent and implementation — the agent identified and patched them |
| **v1.2** — Automatic Maintenance | `maintenanceInterval` config, in-process compact/reflect every N heartbeats, budget enforcement | Memory management can't be manual — it must run on schedule as part of the heartbeat lifecycle |
| **v1.3** — Semantic Extraction | Lightweight regex extraction of file paths, symbols, and error patterns from bash/read output into semantic entities | Semantic memory was a dead store — now every successful action deposits knowledge automatically |
| **v1.4** — Skill Safety | `checkPolicyBlock()` enforces safety rules on skill sub-steps before execution | Skills bypassed the policy engine entirely — a skill plan could include `rm -rf /` unchecked |
| **v1.5** — Integration Test | Full heartbeat loop test: file creation, replay buffer, episodic memory, policy consultation verified end-to-end | Testing parts in isolation doesn't prove the assembly works — you need one test that runs the whole loop |
| **v1.6** — Research-Driven Roadmap | arXiv literature review → prioritized improvement list drawn from 5 papers | The agent can use its own arXiv skill to identify architectural improvements from current research |
| **v1.7** — Policy & Event Fixes | Fixed 2 dead policy rules (`condition` → `precondition`), double `select_complete` emit, 5 missing event handlers, incomplete public exports | Dead rules are silent failures — integration tests pass but safety rules never fire. Always verify the runtime path matches the schema. |

---

## Self-Evolution: An Experiment in Research-Driven Self-Improvement

Rho's v1.1–v1.7 changes were produced in sessions where the agent was pointed at its own codebase and asked to review, fix, and improve itself. The process demonstrates a concrete **self-evolution loop**:

```
  ┌─────────────────────────────────────────────────────────┐
  │                SELF-EVOLUTION LOOP                       │
  │                                                         │
  │  1. REVIEW — Read own source, tests, paper, git history │
  │       ↓                                                 │
  │  2. IDENTIFY — Find gaps between design intent and      │
  │     implementation (e.g., "accessCount never bumped",   │
  │     "skills bypass policy", "semantic store never       │
  │     written to")                                        │
  │       ↓                                                 │
  │  3. FIX — Surgical edits with verification tests        │
  │       ↓                                                 │
  │  4. RESEARCH — Use arXiv skill to find relevant papers  │
  │     on hallucination, long-horizon agents, memory       │
  │       ↓                                                 │
  │  5. PLAN — Map paper findings to concrete code changes  │
  │       ↓                                                 │
  │  6. COMMIT — Push changes, update documentation         │
  │       └──────────────→ (repeat)                         │
  └─────────────────────────────────────────────────────────┘
```

### What Happened

With minimal human guidance ("review yourself", "fix this gap", "look up papers and propose improvements"), the agent:

1. **Found and fixed 6 implementation bugs/gaps** (v1.1–v1.5) — visibility tags, missing side effects, bypassed safety checks, dead code paths, missing maintenance triggers
2. **Searched arXiv** for 5 papers across hallucination detection and agent long-task management
3. **Produced a prioritized 10-item roadmap** mapping paper findings to specific code changes
4. **Found and fixed 5 additional issues** (v1.7) — 2 policy rules using wrong field name (`condition` instead of `precondition`, silently never firing), double event emission in select phase, 5 event types with no log handlers, incomplete public API exports

### The 5 Papers Reviewed

| Paper | Key Finding for Rho |
|-------|-------------------|
| **A Survey of Hallucination in Large Foundation Models** (2309.05922) | Self-consistency checks and knowledge grounding reduce hallucinated actions — Rho should validate evaluate() outputs against known workspace state |
| **ToolBeHonest** (2406.20015) | Tool-using LLMs fail most at *solvability detection* — Rho should pre-check task feasibility before burning heartbeats |
| **Agent Planning with World Knowledge Model** (2405.14205) | Global prior knowledge + dynamic state deltas prevent blind trial-and-error — Rho's blackboard should show *what changed*, not just *what exists* |
| **Task Memory Engine (TME)** (2504.08525) | Hierarchical task trees with per-node state enable richer queries than flat episode lists — Rho's episodic memory should be tree-structured |
| **Memory in the Age of AI Agents** (2512.13564) | LLM-guided memory consolidation outperforms frequency counting — Rho's reflect should use the LLM, not just regex/stats |

### Resulting Improvement Roadmap (Priority Order)

1. **Validate skill names in parseEvaluateResponse()** — reject hallucinated skill references (from ToolBeHonest)
2. **Add DELTA zone to blackboard** — show what changed since last heartbeat (from WKM)
3. **Solvability pre-check** — one LLM call before the loop to catch impossible tasks (from ToolBeHonest)
4. **Ground evaluate prompt with semantic entities** — inject known facts as hallucination anchors (from Hallucination Survey)
5. **LLM-guided memory consolidation** — replace frequency-counting reflect with actual LLM summarization (from Memory Survey)
6. **Reward-weighted reflection** — weight episodic→procedural promotion by outcome success (from Memory Survey)
7. **Hierarchical task memory tree** — replace flat episodic index with parent-linked tree nodes (from TME)
8. **Multi-sample evaluation** — call evaluate() multiple times on uncertain heartbeats, intersect results (from Hallucination Survey)
9. **Cheap world model for outcome prediction** — use a small/fast model to predict action outcomes before committing (from WKM)
10. **Plan caching / step deduplication** — reuse successful skill steps across sessions (from TME + Memory Survey)

### Why This Matters

This is not hypothetical. The agent literally:
- Used `skills/arxiv-research/scripts/search.mjs` to query arXiv
- Analyzed abstracts and selected papers by relevance to its own architecture
- Cross-referenced paper findings against its own source code
- Produced actionable code-level recommendations

**The arXiv skill exists so Rho can research improvements to itself.** The self-evolution loop is the intended use case — an agent that reads papers, identifies applicable techniques, and implements them, with a human providing direction and review.

---

## Testing

```bash
# Automated tests (skills, memory, policy, replay, blackboard)
bash test-all.sh

# Quick test suite
bash test-quick.sh

# Interactive TUI tests (13 prompts in tests/rho-prompts.md)
docker run -it -e ANTHROPIC_API_KEY=sk-ant-... rho
# Then try prompts from tests/rho-prompts.md
```

---

## Theoretical Foundations

Rho draws on three research traditions:

### Reinforcement Learning
- **DQN** (1312.5602) — Experience replay for stabilizing learning
- **Rainbow** (1710.02298) — Prioritized replay, multi-step returns, distributional RL
- **Options Framework** (Sutton 1999) — Temporally extended actions with initiation/termination
- **Learning by Cheating** (1912.12294) — Privileged executive trains constrained workers

### Cognitive Science
- **Tulving** (1972) — Episodic/semantic/procedural memory distinction
- **Ebbinghaus** (1885) — Forgetting curve, retention decay
- **Generative Agents** (Park 2023) — Reflection + importance + recency scoring

### Production Systems
- **Soar** (Laird 2012) — Propose–evaluate–select decision cycle, impasse/escalation
- **CoALA** (2309.02427) — Cognitive architectures for language agents
- **Glyph** (2510.17800) — Information-dense rendering, spatial layout optimization

### Hallucination & Reliability
- **Hallucination Survey** (2309.05922) — Taxonomy of hallucination types, self-consistency mitigation
- **ToolBeHonest** (2406.20015) — Multi-level hallucination benchmark for tool-augmented LLMs

### Agent Memory & Long-Horizon Planning
- **WKM** (2405.14205) — World Knowledge Models providing global prior + dynamic state knowledge
- **TME** (2504.08525) — Hierarchical Task Memory Trees for multi-step state tracking
- **Memory in the Age of AI Agents** (2512.13564) — Comprehensive survey: forms, functions, dynamics of agent memory

Additional references: Memory Survey (2404.13501), MACLA (2512.18950), MemGPT (2310.08560), RepoRift (2408.11058), Latent Context Compilation (2602.21221), C3 (2511.15244), IC-Former (2406.13618), LLM-MAS (2412.17481).

---

## Future Work

See the [research-driven roadmap](#resulting-improvement-roadmap-priority-order) above for the full prioritized list. Key themes:

- **Hallucination resistance** — Solvability pre-checks, semantic grounding in evaluate prompts, multi-sample consistency (from 2309.05922, 2406.20015)
- **Richer observation** — Blackboard DELTA zones showing what changed, not just what exists (from 2405.14205)
- **Structured task memory** — Hierarchical tree replacing flat episodic index, with per-node state tracking (from 2504.08525)
- **LLM-guided memory management** — Replace frequency-counting reflection with actual LLM consolidation (from 2512.13564)
- **Executive Agent** — Multi-agent hierarchy inspired by Learning by Cheating (1912.12294). Executive agents face the user, interpret commands, spawn/monitor workers, and synthesize results. Small action space (~10 actions: `spawn_worker`, `spawn_executive`, `message_user`, `send_to_agent`, `wait_for_agents`, `collect_results`, `terminate_agent`, `think`, `done`). Workers carry the rich operational action space (browser, code, test, shell). Recursive `spawn_executive` enables hierarchies, swarms, and adversarial executive pairs. Blackboard lens system already supports per-role visibility filtering.
- **World model** — Cheap model predicting action outcomes before committing (from 2405.14205)
- **Benchmark Evaluation** — SWE-bench, WebArena
- **Distillation Pipeline** — Worker execution traces → smaller/cheaper models for well-understood tasks

---

## License

MIT
