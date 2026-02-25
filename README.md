# 🧠 Local Coding Swarm (Option 2)
**Simple routing + multiple backends, production-minded, no hair loss**

---

# Overview

This document describes how to build a **local multi-model coding system** using:

- Multiple model servers (possibly on different machines)
- A single OpenAI-compatible routing layer (LiteLLM Proxy)
- Clear escalation rules
- Real build/test verification loops

It explains:

- Hardware options
- Model mixes and how they affect output
- Networking devices together
- Redundancy + quality controls
- The “right size” for tasks
- How to avoid multi-agent chaos

This approach is grounded in three key ideas from small-model research:

1. Cascading reduces cost dramatically while preserving quality by escalating only when needed.
2. Mixture-of-Agents (MoA) can outperform a single strong model by aggregating diverse proposals.
3. Verification-aware execution (tests/build loops) enables targeted repair instead of blind rewriting.

The goal is not a research lab system. The goal is:

> A local coding engine that works reliably without building your own distributed AI platform.

---

# 🏗 Architecture

## Logical Architecture

```
IDE / CLI / Automation
          |
          v
+---------------------------+
| LiteLLM Proxy (Router)    |
| - model selection         |
| - fallbacks               |
| - rate limiting           |
+-------------+-------------+
              |
   +----------+--------------------+
   |                               |
   v                               v
+--------------------+      +--------------------+
| Fast Model Server  |      | Deep Model Server  |
| (Ollama)           |      | (vLLM)             |
| 7B–14B model       |      | 14B–32B model      |
+--------------------+      +--------------------+
```

Optional:

```
+--------------------+
| Reviewer Server    |
| (7B reasoning)     |
+--------------------+
```

---

# 🖥 Hardware Options

## What Matters Most

- GPU VRAM
- Memory bandwidth
- System RAM
- Disk speed (for builds)

CPU is rarely the bottleneck.

---

## Tier 1 — Single Machine (Best Start)

Recommended:
- RTX 3090 (24GB VRAM)
- 64GB RAM
- 2TB NVMe
- 850–1000W PSU

Why:
- Can run both fast + deep models
- Lowest latency
- Simplest debugging

---

## Tier 2 — Two-Box Swarm

Box A (Fast Node)
- RTX 3060 12GB or 3090
- 32–64GB RAM
- Runs Ollama

Box B (Deep Node)
- 24GB+ GPU
- 64GB+ RAM
- Runs vLLM

Impact:
- Parallelism
- Deep model isolated from high-volume traffic

---

## Tier 3 — Three-Box Swarm

Add:

Box C (Reviewer Node)
- 12–24GB GPU
- Smaller reasoning model

Impact:
- Cleaner repair loops
- Reduced deep model usage

---

# 🤖 Model Mix & Impact

## Fast Model (7B–14B)

Role:
- UI generation
- Small components
- Boilerplate
- First-pass fixes

Traits:
- Fast
- Cheap
- May struggle with deep cross-file reasoning

Handles ~80% of tasks.

---

## Deep Model (14B–32B+)

Role:
- Multi-file refactors
- Complex TypeScript issues
- Architecture changes
- Debugging stubborn build errors

Traits:
- Slower
- Higher VRAM
- Better global reasoning

Used only when needed.

---

## Reviewer Model (Optional)

Role:
- Interpret logs
- Analyze diffs
- Suggest minimal patches

Improves quality while limiting deep model usage.

---

# 🌐 Networking Devices Together

## Simple LAN Setup

Use:
- Wired Ethernet (2.5GbE or 10GbE preferred)
- Static IP addresses
- Same subnet

Example:

Router: 192.168.1.1  
LiteLLM: 192.168.1.10  
Fast Node: 192.168.1.11  
Deep Node: 192.168.1.12  

LiteLLM routes via:

api_base: http://192.168.1.11:11434/v1/  
api_base: http://192.168.1.12:8000/v1  

Recommendations:
- Avoid WiFi for model nodes
- Use firewall rules to restrict access
- Keep machines time-synced
- Use fixed DNS names if possible

---

# 🔄 Batching Strategy

## 1) Workflow-Level Parallelism

Split tasks:

- Header
- Footer
- Pricing page
- Contact page

Dispatch concurrently to fast model.

Safe parallelism = independent file groups.

---

## 2) Backend Batching

vLLM dynamically batches requests internally.

Cap concurrency:
- Fast model: 4–8 requests
- Deep model: 1–2 requests

Prevents overload.

---

# 🧪 Quality Controls & Redundancy

## 1) Mandatory Verification Loop

Always run:

- Lint
- Typecheck
- Build
- Smoke tests

Feed failures back into model.

---

## 2) Escalation Rules

- 2 failed attempts → escalate
- 3 failed attempts → stop and report

No infinite loops.

---

## 3) Patch Size Limits

- Limit diff size
- Avoid full rewrites
- One task owns a file at a time

---

## 4) Fallback Routing

If fast model errors → automatically try deep model.

---

## 5) Optional MoA Mode

For critical tasks:

- Run 2 fast proposals
- Run 1 deep proposal
- Select best via tests

---

# 📏 Right Task Size for Small Agents

## Too Small
“Add one div.”

Not worth orchestration.

## Too Big
“Rewrite the entire app.”

Causes thrashing.

---

## Ideal Task Characteristics

A good task:

- Modifies ≤ 3 files
- Changes ≤ 200 lines
- Is independently verifiable
- Has clear input/output boundaries

Good:
- Implement Header component
- Fix failing test
- Add form validation

Bad:
- Redesign entire system
- Migrate whole repo

Heuristic:
If it can’t be validated by a specific test or build check, it’s too big.

---

# 🚫 What This Avoids

- No agent negotiation layers
- No custom distributed protocol
- No Kubernetes
- No CRDT systems
- No research infrastructure

Just:

- Model servers
- One router
- Clear escalation
- Verification gates
- Concurrency limits

---

# 🧠 Final System Summary

```
You
  ↓
IDE / CLI
  ↓
LiteLLM Router
  ↓
Fast Model (default)
  ↓ (if needed)
Deep Model (escalation)
  ↓
Verification Loop
  ↓
Done
```

---

# Core Principle

Small models work when:

- Tasks are right-sized
- Verification is mandatory
- Escalation is controlled
- Routing is explicit
- Retry loops are bounded

You do not need a research lab.

You need:
- 1 router
- 2 models
- Good rules
- Tests

That’s the right-sized local coding swarm.
