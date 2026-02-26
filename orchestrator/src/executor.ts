import type OpenAI from "openai";
import type { Task, ModelResponse, PatchResult } from "./types";
import { MAX_PATCH_LINES } from "./types";
import { getModelForTier, getSemaphore } from "./router";
import { createTaskLogger } from "./telemetry";

export function buildPrompt(
  task: Task,
  fileContents: Map<string, string>,
  errors?: string[]
): string {
  let prompt = `You are a coding assistant. Complete the following task:

## Task
${task.description}

## Files to modify
${task.filesOwned.join(", ")}

## Current file contents
`;

  for (const [path, content] of fileContents) {
    prompt += `\n### ${path}\n\`\`\`\n${content}\n\`\`\`\n`;
  }

  if (errors && errors.length > 0) {
    prompt += `\n## Previous errors to fix\n`;
    for (const error of errors) {
      prompt += `- ${error}\n`;
    }
  }

  prompt += `
## Instructions
1. Analyze the task and current code
2. Generate a unified diff patch to implement the changes
3. Output ONLY the patch in unified diff format, wrapped in \`\`\`diff and \`\`\` markers
4. Ensure the patch is minimal and focused on the task

## Output format
\`\`\`diff
--- a/path/to/file
+++ b/path/to/file
@@ -line,count +line,count @@
 context line
-removed line
+added line
 context line
\`\`\`
`;

  return prompt;
}

export async function callModel(
  client: OpenAI,
  task: Task,
  prompt: string
): Promise<ModelResponse> {
  const log = createTaskLogger(task);
  const model = getModelForTier(task.tier);
  const semaphore = getSemaphore(task.tier);

  log.info("model_call_start", { model });

  return semaphore.withPermit(async () => {
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 4096,
    });

    const content = response.choices[0]?.message?.content || "";
    const tokensUsed = response.usage?.total_tokens || 0;

    log.info("model_call_complete", { model, tokensUsed });

    return {
      content,
      model,
      tokensUsed,
    };
  });
}

export function parsePatch(response: string): PatchResult {
  const diffMatch = response.match(/```diff\n([\s\S]*?)```/);

  if (!diffMatch) {
    return {
      success: false,
      error: "No diff block found in response",
    };
  }

  const patch = diffMatch[1].trim();
  const lines = patch.split("\n");
  const changeLines = lines.filter(
    (l) => l.startsWith("+") || l.startsWith("-")
  ).filter(
    (l) => !l.startsWith("+++") && !l.startsWith("---")
  );

  if (changeLines.length > MAX_PATCH_LINES) {
    return {
      success: false,
      error: `Patch too large: ${changeLines.length} lines (max ${MAX_PATCH_LINES})`,
      linesChanged: changeLines.length,
    };
  }

  return {
    success: true,
    patch,
    linesChanged: changeLines.length,
  };
}

export async function applyPatch(
  patch: string,
  workspacePath: string
): Promise<{ success: boolean; error?: string }> {
  const proc = Bun.spawn(["patch", "-p1", "--forward", "--no-backup-if-mismatch"], {
    cwd: workspacePath,
    stdin: new Response(patch),
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    return {
      success: false,
      error: `Patch failed: ${stderr}`,
    };
  }

  return { success: true };
}

export async function readFiles(
  paths: string[],
  workspacePath: string
): Promise<Map<string, string>> {
  const contents = new Map<string, string>();

  for (const path of paths) {
    const fullPath = `${workspacePath}/${path}`;
    try {
      const file = Bun.file(fullPath);
      if (await file.exists()) {
        contents.set(path, await file.text());
      } else {
        contents.set(path, "// File does not exist yet");
      }
    } catch {
      contents.set(path, "// Error reading file");
    }
  }

  return contents;
}
