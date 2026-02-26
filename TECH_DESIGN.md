# 🧠 Local Coding Swarm (Single-Machine Cluster)
## Technical Specification (MacBook Pro + Ollama + LiteLLM + Pino-Pretty Observability)

---

# 1. Overview

This document specifies a **modular, observable, single-machine local coding swarm** architecture designed to run on:

- MacBook Pro (M1 Max, 64GB unified memory)
- macOS
- Ollama (host)
- LiteLLM Proxy (Docker)
- Node.js (TypeScript) orchestrator
- Next.js workspace
- Pino + pino-pretty for simple, clean observability

This system simulates a multi-node coding cluster while running entirely on one machine.

The goal is:

- Modular
- Deterministic
- Test-driven
- Easy to observe
- Easy to extend to real multi-node later
- No heavy observability stack (no Grafana, no Prometheus)

---

# 2. System Architecture

```
IDE / CLI
     |
     v
+------------------------+
| LiteLLM Proxy :4000    |
| (Router)               |
+-----------+------------+
            |
   +--------+-----------------------------+
   |                                      |
   v                                      v
Ollama (host)                        Ollama (host)
fast model                            deep model
reviewer model

            |
            v
+------------------------+
| Orchestrator Service   |
| - task splitter        |
| - escalation policy    |
| - concurrency control  |
| - verification loop    |
| - structured logging   |
+-----------+------------+
            |
            v
+------------------------+
| Tool Runner            |
| - apply patch          |
| - lint                 |
| - typecheck            |
| - build                |
| - tests                |
+------------------------+
            |
            v
Next.js Workspace
```

---

# 3. Goals

1. Cascading model routing (fast → deep → reviewer)
2. Deterministic retry + escalation
3. Patch-based editing (no full rewrites)
4. Hard verification gates
5. Structured logs readable in real time via `pino-pretty`
6. Zero external observability infrastructure

---

# 4. Directory Structure

```
local-swarm/
  compose.yaml
  litellm/
    config.yaml
  orchestrator/
    src/
      index.ts
      router.ts
      executor.ts
      verifier.ts
      policy.ts
      telemetry.ts
    package.json
  workspace/
    nextjs-app/
  scripts/
    lint.sh
    typecheck.sh
    build.sh
    test.sh
  logs/
    swarm.log
```

---

# 5. LiteLLM Proxy (Router Layer)

## compose.yaml

```yaml
services:
  litellm:
    image: ghcr.io/berriai/litellm:main
    container_name: litellm-proxy
    ports:
      - "4000:4000"
    environment:
      - LITELLM_MASTER_KEY=dev-key
      - LITELLM_LOG=INFO
    volumes:
      - ./litellm/config.yaml:/app/config.yaml:ro
    command: ["--config", "/app/config.yaml", "--port", "4000"]
```

## litellm/config.yaml

```yaml
model_list:
  - model_name: fast-coder
    litellm_params:
      model: openai/qwen2.5-coder:7b-instruct
      api_base: http://host.docker.internal:11434/v1
      api_key: ollama

  - model_name: deep-coder
    litellm_params:
      model: openai/qwen2.5-coder:14b-instruct
      api_base: http://host.docker.internal:11434/v1
      api_key: ollama

  - model_name: reviewer
    litellm_params:
      model: openai/qwen2.5:7b-instruct
      api_base: http://host.docker.internal:11434/v1
      api_key: ollama
```

---

# 6. Orchestrator Service

Language: Node.js (TypeScript)

Install dependencies:

```bash
npm install pino pino-pretty openai
```

Run in development:

```bash
node dist/index.js | pino-pretty
```

Run in production mode (write JSON to file):

```bash
node dist/index.js >> logs/swarm.log
```

---

# 7. Logging & Observability (Pino + Pino-Pretty)

## 7.1 Telemetry Module (telemetry.ts)

```ts
import pino from "pino"

export const logger = pino({
  level: "info",
  transport: process.env.NODE_ENV === "development"
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname"
        }
      }
    : undefined
})
```

---

## 7.2 Required Log Fields

Every log entry must include:

```ts
{
  taskId: string
  tier: "fast" | "deep" | "reviewer"
  event: string
  attempt: number
  latencyMs?: number
  diffSize?: number
  status?: "success" | "fail"
}
```

---

## 7.3 Required Events

- task_created
- model_call_start
- model_call_complete
- patch_applied
- verification_start
- verification_pass
- verification_fail
- escalation
- task_complete
- task_abort

---

## 7.4 Example Log Output (pino-pretty)

```
[2026-02-25 10:22:03] INFO  task_created      taskId=abc123
[2026-02-25 10:22:04] INFO  model_call_start  tier=fast attempt=1
[2026-02-25 10:22:05] INFO  model_call_complete tier=fast latencyMs=842
[2026-02-25 10:22:05] INFO  verification_start
[2026-02-25 10:22:07] WARN  verification_fail errors=TypeScript
[2026-02-25 10:22:07] INFO  escalation from=fast to=deep
[2026-02-25 10:22:09] INFO  model_call_complete tier=deep latencyMs=1880
[2026-02-25 10:22:10] INFO  verification_pass
[2026-02-25 10:22:10] INFO  task_complete
```

This is your “live dashboard.”

---

# 8. Task Model

```ts
interface Task {
  id: string
  description: string
  filesOwned: string[]
  tier: "fast" | "deep" | "reviewer"
  attempt: number
  maxAttempts: number
}
```

---

# 9. Routing Policy

## Default Tier
All tasks start at `fast`.

## Escalation Rules

Escalate to `deep` if:

- Build fails twice
- > 3 files changed
- > 200 lines changed
- TypeScript errors persist

Escalate to `reviewer` if:

- Deep produces large diff
- Verification failures unclear
- Need minimal patch repair

Max attempts per tier: 2  
Max total attempts: 5  

---

# 10. Concurrency Limits

| Tier      | Max Concurrent |
|-----------|----------------|
| fast      | 4              |
| deep      | 1              |
| reviewer  | 2              |

Use a semaphore per tier.

---

# 11. Verification Loop

Each patch must pass:

1. eslint
2. tsc --noEmit
3. next build
4. optional smoke test

If failure:

- capture structured error summary
- feed back into next model attempt
- log verification_fail

---

# 12. Tool Runner Contract

Input:
- unified diff patch

Steps:
1. Apply patch
2. Run verification scripts
3. Return structured result

Output:

```ts
{
  success: boolean
  errors?: string[]
  logs?: string
}
```

---

# 13. Failure Handling

- No concurrent writes to same file
- Reject patch > 300 lines
- Stop after 5 total attempts
- Always log reason before abort

---

# 14. Development Workflow

Start Ollama:

```bash
ollama serve
```

Pull models:

```bash
ollama pull qwen2.5-coder:7b-instruct
ollama pull qwen2.5-coder:14b-instruct
```

Start LiteLLM:

```bash
docker compose up -d
```

Start orchestrator (dev mode):

```bash
NODE_ENV=development node dist/index.js | pino-pretty
```

---

# 15. What You See in Real Time

Using pino-pretty:

- Which tier is running
- Latency per model
- When escalation happens
- How many retries occurred
- When verification passes/fails

This replaces Grafana entirely for this phase.

---

# 16. Definition of Done

System must:

- Generate a Next.js project
- Pass build + lint + typecheck
- Escalate at least once correctly
- Log full lifecycle
- Be debuggable via live console logs

---

# 17. Non-Goals

- No Grafana
- No Prometheus
- No Jaeger
- No distributed coordination
- No Kubernetes

---

# Final Principle

Observability should be:

- Immediate
- Readable
- Structured
- Zero setup

`pino + pino-pretty` gives you that.

This system is modular, observable, deterministic, and ready for implementation.
