# Rho

An autonomous coding agent built on [pi](https://github.com/badlogic/pi-mono) + [agent-loop](https://github.com/jnesfield-bot/agent-loop). RL-inspired heartbeat engine, Rainbow-prioritized memory, tri-store cognition, production-rule policy, and a full interactive TUI.

> **📄 Paper**: See [`paper/rho.tex`](paper/rho.tex) ([PDF](paper/rho.pdf)) — *"Rho: A Cognitive Architecture for Autonomous LLM Agents with Reinforcement Learning–Inspired Memory and Policy"* by J. Nesfield & Claude.

## What This Is

Rho = **pi coding agent** + **agent-loop framework**. It gives you:

- **Interactive TUI**: Full pi experience — bash, read, write, edit tools — with the heartbeat loop running underneath
- **Heartbeat loop**: Observe → Evaluate → Select → Act → Record (every action is one heartbeat)
- **Rainbow-inspired replay**: Priority = novelty × usefulness (arXiv:1710.02298). Multi-step chaining, importance sampling, outcome distributions.
- **Tri-store memory**: Episodic/semantic/procedural with write, read, manage (merge/reflect/forget)
- **Policy engine**: Codified production rules — safety blocks, escalation, impasse detection
- **Skills**: memory, policy, code-search, arxiv-research, skill-sequencer, replay-buffer
- **Blackboard**: Zoned observation canvas with lens filtering — the agent sees a structured board, not raw state

## Quick Start

```bash
git clone https://github.com/jnesfield-bot/rho.git
cd rho
docker build -t rho .
docker run -it -e ANTHROPIC_API_KEY=sk-ant-... rho
```

Or without Docker:

```bash
git clone https://github.com/jnesfield-bot/rho.git
cd rho && npm install
ANTHROPIC_API_KEY=sk-ant-... npx tsx src/main.ts [work-directory]
```

## Architecture

Same as agent-loop but with pi's TUI and extension system providing the interactive layer:

```
┌─────────────────────────────────────────────────────────┐
│  pi TUI (interactive)                                    │
│  ┌─────────────────────────────────────────────────────┐│
│  │  Rho Extension (src/extension.ts)                   ││
│  │  ┌───────────────────────────────────────────────┐  ││
│  │  │  HEARTBEAT LOOP (agent-loop)                  │  ││
│  │  │  Observe → Evaluate → Select → Act → Record   │  ││
│  │  │  + Rainbow replay + Tri-store memory + Policy │  ││
│  │  └───────────────────────────────────────────────┘  ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

## Key Differences from agent-loop

| Feature | agent-loop | rho |
|---------|-----------|-----|
| TUI | No | Full pi interactive TUI |
| Extension | No | Pi extension with heartbeat tools |
| Entrypoint | `npx tsx src/main.ts` | `pi` (Docker) or `npx tsx` |
| Use case | Embed in any system | Autonomous coding agent |

## Testing

```bash
# Automated tests (all skills + memory + policy + replay)
bash test-all.sh

# Interactive TUI tests (13 prompts in tests/rho-prompts.md)
docker run -it -e ANTHROPIC_API_KEY=sk-ant-... rho
# Then try prompts from tests/rho-prompts.md
```

## References

See the [paper](paper/rho.pdf) for full references and architecture details.

Key papers: Rainbow (1710.02298), CoALA (2309.02427), Memory Survey (2404.13501), Glyph (2510.17800), DQN (1312.5602), Options Framework (Sutton 1999), Learning by Cheating (1912.12294), Latent Context Compilation (2602.21221), C3 (2511.15244), IC-Former (2406.13618).

## License

MIT
