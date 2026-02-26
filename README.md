# smol-coder

A local coding swarm orchestrator that routes coding tasks through Ollama models via LiteLLM, with automatic escalation and verification loops.

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) runtime
- [Docker](https://www.docker.com/) for LiteLLM proxy
- [Ollama](https://ollama.ai/) with models pulled

```bash
# Pull required models
ollama pull qwen2.5-coder:7b-instruct   # fast-coder tier
ollama pull qwen2.5-coder:14b-instruct  # deep-coder tier
ollama pull qwen2.5:7b-instruct         # reviewer tier
```

### Setup

```bash
# 1. Start Ollama
ollama serve

# 2. Start LiteLLM proxy
docker compose up -d

# 3. Verify LiteLLM is running
curl http://localhost:4000/health

# 4. Install orchestrator dependencies
cd orchestrator && bun install
```

### Run

```bash
# Via stdin
echo '{"description": "Add a Button component", "filesOwned": ["src/Button.tsx"]}' | \
  bun run src/index.ts --workspace /path/to/your/project

# Via file
bun run src/index.ts --workspace /path/to/project --file task.json

# With pretty logs
echo '{"description": "Fix login bug", "filesOwned": ["src/auth.ts"]}' | \
  bun run src/index.ts --workspace /path/to/project | bunx pino-pretty
```

---

## Task Input Format

```json
{
  "description": "Describe what you want done",
  "filesOwned": ["src/file1.ts", "src/file2.ts"]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `description` | string | Natural language description of the coding task |
| `filesOwned` | string[] | Paths to files the model can read and modify |

---

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Orchestrator  │────▶│    LiteLLM      │────▶│     Ollama      │
│   (Bun/TS)      │     │    (Docker)     │     │     (Host)      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                                              │
        │                                              ▼
        │                                    ┌─────────────────┐
        │                                    │  qwen2.5-coder  │
        │                                    │  7b / 14b       │
        ▼                                    └─────────────────┘
┌─────────────────┐
│   Workspace     │
│   (your code)   │
└─────────────────┘
```

---

## Model Tiers & Escalation

The orchestrator uses three model tiers with automatic escalation:

| Tier | Model | Concurrency | Use Case |
|------|-------|-------------|----------|
| `fast` | qwen2.5-coder:7b-instruct | 4 | Simple changes, quick fixes |
| `deep` | qwen2.5-coder:14b-instruct | 1 | Complex logic, multi-file changes |
| `reviewer` | qwen2.5:7b-instruct | 2 | Final review, edge cases |

### Escalation Rules

- 2 failures at current tier → escalate to next tier
- Maximum 5 total attempts across all tiers
- Tasks with >5 files or >1000 char descriptions start at `deep` tier

---

## Verification

After each patch, the orchestrator runs verification commands:

1. `bun run typecheck` - TypeScript compilation
2. `bun run lint` - Linting rules
3. `bun run build` - Build process

If verification fails, errors are fed back to the model for the next attempt.

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LITELLM_URL` | `http://localhost:4000/v1` | LiteLLM proxy URL |
| `LITELLM_API_KEY` | `dev-key` | API key for LiteLLM |
| `LOG_LEVEL` | `info` | Pino log level |
| `NODE_ENV` | - | Set to `production` for JSON logs |

### LiteLLM Configuration

Edit `litellm/config.yaml` to customize model routing:

```yaml
model_list:
  - model_name: fast-coder
    litellm_params:
      model: ollama/qwen2.5-coder:7b-instruct
      api_base: http://host.docker.internal:11434
```

---

## Log Events

| Event | Description |
|-------|-------------|
| `task_created` | New task initialized |
| `model_call_start` | LLM request started |
| `model_call_complete` | LLM response received |
| `patch_applied` | Diff successfully applied |
| `patch_rejected` | Diff rejected (parse error or too large) |
| `verification_start` | Running verification commands |
| `verification_pass` | All checks passed |
| `verification_fail` | One or more checks failed |
| `escalation` | Moving to higher tier |
| `task_complete` | Task finished successfully |
| `task_abort` | Max attempts reached |

---

## Limits

| Limit | Value |
|-------|-------|
| Max patch size | 300 lines |
| Max attempts per tier | 2 |
| Max total attempts | 5 |
| Verification timeout | 60 seconds |

---

## Project Structure

```
smol-coder/
├── compose.yaml              # LiteLLM Docker config
├── litellm/
│   └── config.yaml           # Model routing
├── orchestrator/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts          # CLI entry point
│       ├── types.ts          # Type definitions
│       ├── telemetry.ts      # Pino logger
│       ├── router.ts         # Model selection + semaphores
│       ├── executor.ts       # LLM calls + patch handling
│       ├── verifier.ts       # Build verification
│       └── policy.ts         # Escalation rules
└── logs/                     # Log output directory
```

---

## Troubleshooting

### LiteLLM not connecting to Ollama

Ensure Ollama is running and accessible:
```bash
curl http://localhost:11434/api/tags
```

On Docker Desktop, the container uses `host.docker.internal` to reach the host.

### Patches not applying

The orchestrator uses `patch -p1`. Ensure your workspace is a git repository or has the expected file structure.

### Model not found

Pull the required models:
```bash
ollama pull qwen2.5-coder:7b-instruct
ollama pull qwen2.5-coder:14b-instruct
ollama pull qwen2.5:7b-instruct
```

---

## Development

```bash
cd orchestrator

# Type check
bun run typecheck

# Run with pretty logs
bun run dev
```

---

## Design Philosophy

This system is grounded in three key ideas from small-model research:

1. **Cascading** reduces cost dramatically while preserving quality by escalating only when needed
2. **Verification-aware execution** (tests/build loops) enables targeted repair instead of blind rewriting
3. **Right-sized tasks** work reliably with small models

### Ideal Task Characteristics

A good task:
- Modifies ≤ 3 files
- Changes ≤ 200 lines
- Is independently verifiable
- Has clear input/output boundaries

### What This Avoids

- No agent negotiation layers
- No custom distributed protocol
- No Kubernetes
- No research infrastructure

Just: model servers, one router, clear escalation, verification gates, and concurrency limits.
