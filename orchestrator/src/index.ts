#!/usr/bin/env bun
import type { Task, TaskInput } from "./types";
import { createClient, selectInitialTier } from "./router";
import { buildPrompt, callModel, parsePatch, applyPatch, readFiles } from "./executor";
import { runVerification, checkWorkspaceHealth } from "./verifier";
import { shouldEscalate, shouldAbort, escalateTask, incrementAttempt } from "./policy";
import { createTaskLogger, logStartup, logShutdown, logger } from "./telemetry";

function parseArgs(): { workspace: string; file?: string } {
  const args = process.argv.slice(2);
  let workspace = process.cwd();
  let file: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--workspace" && args[i + 1]) {
      workspace = args[i + 1];
      i++;
    } else if (args[i] === "--file" && args[i + 1]) {
      file = args[i + 1];
      i++;
    }
  }

  return { workspace, file };
}

async function readTaskInput(file?: string): Promise<TaskInput> {
  let input: string;

  if (file) {
    input = await Bun.file(file).text();
  } else {
    const chunks: Uint8Array[] = [];
    const reader = Bun.stdin.stream().getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    input = new TextDecoder().decode(Buffer.concat(chunks));
  }

  return JSON.parse(input) as TaskInput;
}

function createTask(input: TaskInput): Task {
  const tier = selectInitialTier(input);
  return {
    id: crypto.randomUUID(),
    description: input.description,
    filesOwned: input.filesOwned,
    tier,
    attempt: 0,
    maxAttempts: 5,
    tierAttempts: { fast: 0, deep: 0, reviewer: 0 },
  };
}

async function runOrchestrator(
  taskInput: TaskInput,
  workspace: string
): Promise<{ success: boolean; task: Task }> {
  const client = createClient();
  let task = createTask(taskInput);
  const log = createTaskLogger(task);

  log.info("task_created", {
    description: task.description.slice(0, 100),
    files: task.filesOwned,
  });

  let errors: string[] = [];

  while (!shouldAbort(task)) {
    task = incrementAttempt(task);
    const taskLog = createTaskLogger(task);

    const fileContents = await readFiles(task.filesOwned, workspace);
    const prompt = buildPrompt(task, fileContents, errors.length > 0 ? errors : undefined);

    let response;
    try {
      response = await callModel(client, task, prompt);
    } catch (error) {
      taskLog.error("model_call_complete", error);
      errors = [`Model call failed: ${error instanceof Error ? error.message : String(error)}`];
      continue;
    }

    const patchResult = parsePatch(response.content);

    if (!patchResult.success || !patchResult.patch) {
      taskLog.warn("patch_rejected", { reason: patchResult.error });
      errors = [patchResult.error || "Failed to parse patch"];

      if (shouldEscalate(task, errors)) {
        task = escalateTask(task);
        taskLog.info("escalation", { newTier: task.tier });
      }
      continue;
    }

    taskLog.info("patch_applied", { linesChanged: patchResult.linesChanged });

    const applyResult = await applyPatch(patchResult.patch, workspace);

    if (!applyResult.success) {
      taskLog.warn("patch_rejected", { reason: applyResult.error });
      errors = [applyResult.error || "Failed to apply patch"];

      if (shouldEscalate(task, errors)) {
        task = escalateTask(task);
        taskLog.info("escalation", { newTier: task.tier });
      }
      continue;
    }

    taskLog.info("verification_start");
    const verifyResult = await runVerification(workspace);

    if (verifyResult.success) {
      taskLog.info("verification_pass");
      taskLog.info("task_complete", {
        totalAttempts: task.attempt,
        finalTier: task.tier,
      });
      return { success: true, task };
    }

    taskLog.warn("verification_fail", {
      errorCount: verifyResult.errors?.length || 0,
    });

    errors = verifyResult.errors || ["Verification failed"];

    if (shouldEscalate(task, errors)) {
      task = escalateTask(task);
      taskLog.info("escalation", { newTier: task.tier });
    }
  }

  const taskLog = createTaskLogger(task);
  taskLog.error("task_abort", new Error("Max attempts reached"), {
    totalAttempts: task.attempt,
    finalTier: task.tier,
    lastErrors: errors,
  });

  return { success: false, task };
}

async function main() {
  const { workspace, file } = parseArgs();

  logStartup({
    litellmUrl: process.env.LITELLM_URL || "http://localhost:4000/v1",
    workspace,
  });

  const health = await checkWorkspaceHealth(workspace);
  if (!health.valid) {
    logger.error({ event: "workspace_invalid", reason: health.reason });
    process.exit(1);
  }

  let taskInput: TaskInput;
  try {
    taskInput = await readTaskInput(file);
  } catch (error) {
    logger.error({
      event: "task_input_error",
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }

  const handleShutdown = (signal: string) => {
    logShutdown(signal);
    process.exit(0);
  };

  process.on("SIGINT", () => handleShutdown("SIGINT"));
  process.on("SIGTERM", () => handleShutdown("SIGTERM"));

  const result = await runOrchestrator(taskInput, workspace);

  if (result.success) {
    logger.info({
      event: "orchestrator_complete",
      success: true,
      taskId: result.task.id,
    });
    process.exit(0);
  } else {
    logger.error({
      event: "orchestrator_complete",
      success: false,
      taskId: result.task.id,
    });
    process.exit(1);
  }
}

main().catch((error) => {
  logger.fatal({ event: "orchestrator_crash", error: String(error) });
  process.exit(1);
});
