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

## In-Depth Example

This walkthrough demonstrates adding a new feature to an existing React project using smol-coder.

### Scenario

You have a React + TypeScript project and want to add a reusable `Card` component with title, description, and optional action button.

### Step 1: Prepare Your Workspace

Your project should have verification scripts in `package.json`:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/",
    "build": "vite build"
  }
}
```

### Step 2: Create the Task File

Create `task.json` with your task description:

```json
{
  "description": "Create a Card component in src/components/Card.tsx. The component should accept props: title (string, required), description (string, optional), and onAction (callback, optional). If onAction is provided, render a button with text 'Learn More'. Use Tailwind CSS for styling with a white background, rounded corners, and subtle shadow. Export the component as default.",
  "filesOwned": ["src/components/Card.tsx"]
}
```

**Tips for writing good task descriptions:**
- Be specific about file paths
- Specify prop types and requirements
- Mention styling approach (Tailwind, CSS modules, etc.)
- Define edge cases (what happens when optional props are missing)

### Step 3: Run the Orchestrator

```bash
cd orchestrator
bun run src/index.ts --workspace ~/Projects/my-react-app --file task.json | bunx pino-pretty
```

### Step 4: Observe the Execution

The orchestrator will emit structured logs. Here's what a successful run looks like:

```
[14:32:01] INFO: orchestrator_startup
    litellmUrl: "http://localhost:4000/v1"
    workspace: "/Users/you/Projects/my-react-app"

[14:32:01] INFO: task_created
    taskId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    tier: "fast"
    description: "Create a Card component in src/components/Card.tsx..."
    files: ["src/components/Card.tsx"]

[14:32:01] INFO: model_call_start
    taskId: "a1b2c3d4..."
    tier: "fast"
    model: "fast-coder"
    attempt: 1

[14:32:08] INFO: model_call_complete
    taskId: "a1b2c3d4..."
    tier: "fast"
    tokens: 847
    durationMs: 6892

[14:32:08] INFO: patch_applied
    taskId: "a1b2c3d4..."
    linesChanged: 42

[14:32:08] INFO: verification_start
    taskId: "a1b2c3d4..."

[14:32:12] INFO: verification_pass
    taskId: "a1b2c3d4..."

[14:32:12] INFO: task_complete
    taskId: "a1b2c3d4..."
    totalAttempts: 1
    finalTier: "fast"
```

### Step 5: Review the Generated Code

The model creates `src/components/Card.tsx`:

```tsx
interface CardProps {
  title: string;
  description?: string;
  onAction?: () => void;
}

export default function Card({ title, description, onAction }: CardProps) {
  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      {description && (
        <p className="mt-2 text-gray-600">{description}</p>
      )}
      {onAction && (
        <button
          onClick={onAction}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Learn More
        </button>
      )}
    </div>
  );
}
```

### Example: Escalation Flow

When the fast model fails, the orchestrator escalates. Here's what that looks like:

```
[14:32:01] INFO: task_created
    taskId: "x1y2z3..."
    tier: "fast"

[14:32:08] INFO: model_call_complete
    taskId: "x1y2z3..."
    attempt: 1

[14:32:08] INFO: patch_applied

[14:32:12] WARN: verification_fail
    taskId: "x1y2z3..."
    errorCount: 2
    errors: [
      "src/components/Card.tsx(15,3): error TS2322: Type 'string' is not assignable to type 'number'",
      "src/components/Card.tsx(18,5): error TS2339: Property 'onClick' does not exist"
    ]

[14:32:12] INFO: model_call_start
    taskId: "x1y2z3..."
    tier: "fast"
    attempt: 2

[14:32:19] WARN: verification_fail
    taskId: "x1y2z3..."
    errorCount: 1

[14:32:19] INFO: escalation
    taskId: "x1y2z3..."
    fromTier: "fast"
    toTier: "deep"
    reason: "2 failures at fast tier"

[14:32:19] INFO: model_call_start
    taskId: "x1y2z3..."
    tier: "deep"
    model: "deep-coder"
    attempt: 3

[14:32:35] INFO: verification_pass
    taskId: "x1y2z3..."

[14:32:35] INFO: task_complete
    taskId: "x1y2z3..."
    totalAttempts: 3
    finalTier: "deep"
```

The deep model receives the previous errors and produces a corrected patch.

### Example: Task Abort

If all attempts fail, the task aborts:

```
[14:35:42] ERROR: task_abort
    taskId: "z9y8x7..."
    totalAttempts: 5
    finalTier: "reviewer"
    lastErrors: [
      "Cannot resolve module './utils' from Card.tsx"
    ]
```

When this happens:
1. Review the error messages
2. Check if required dependencies exist
3. Simplify the task description
4. Try again with more context

### Running Multiple Tasks

For multiple independent tasks, run them in separate terminals or use a task runner:

```bash
# Terminal 1: Header component
echo '{"description": "Create Header component", "filesOwned": ["src/components/Header.tsx"]}' | \
  bun run src/index.ts --workspace ~/Projects/app

# Terminal 2: Footer component
echo '{"description": "Create Footer component", "filesOwned": ["src/components/Footer.tsx"]}' | \
  bun run src/index.ts --workspace ~/Projects/app
```

The semaphore system ensures models aren't overloaded (max 4 concurrent fast, 1 deep, 2 reviewer).

### Batch Processing with a Script

Create `tasks/batch.sh`:

```bash
#!/bin/bash
WORKSPACE="$HOME/Projects/my-app"
ORCHESTRATOR="$HOME/Projects/smol-coder/orchestrator"

tasks=(
  '{"description": "Add Card component", "filesOwned": ["src/components/Card.tsx"]}'
  '{"description": "Add Badge component", "filesOwned": ["src/components/Badge.tsx"]}'
  '{"description": "Add Avatar component", "filesOwned": ["src/components/Avatar.tsx"]}'
)

for task in "${tasks[@]}"; do
  echo "$task" | bun run "$ORCHESTRATOR/src/index.ts" --workspace "$WORKSPACE" | bunx pino-pretty
  echo "---"
done
```

### Integrating with CI/CD

Add to your GitHub Actions workflow:

```yaml
- name: Run smol-coder task
  run: |
    echo '${{ inputs.task_json }}' | \
      bun run orchestrator/src/index.ts --workspace .
  env:
    LITELLM_URL: ${{ secrets.LITELLM_URL }}
    LITELLM_API_KEY: ${{ secrets.LITELLM_API_KEY }}
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
