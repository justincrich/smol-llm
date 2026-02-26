import type { VerifyResult } from "./types";

export interface VerifyConfig {
  commands?: string[];
  timeout?: number;
}

const DEFAULT_COMMANDS = ["bun run typecheck", "bun run lint", "bun run build"];
const DEFAULT_TIMEOUT = 60_000;

export async function runVerification(
  workspacePath: string,
  config: VerifyConfig = {}
): Promise<VerifyResult> {
  const commands = config.commands || DEFAULT_COMMANDS;
  const timeout = config.timeout || DEFAULT_TIMEOUT;
  const errors: string[] = [];
  const logs: string[] = [];

  for (const command of commands) {
    const [cmd, ...args] = command.split(" ");

    try {
      const proc = Bun.spawn([cmd, ...args], {
        cwd: workspacePath,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, CI: "true" },
      });

      const timeoutId = setTimeout(() => {
        proc.kill();
      }, timeout);

      const exitCode = await proc.exited;
      clearTimeout(timeoutId);

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      logs.push(`[${command}]\n${stdout}${stderr}`);

      if (exitCode !== 0) {
        const errorOutput = stderr || stdout;
        const parsedErrors = parseErrors(errorOutput, command);
        errors.push(...parsedErrors);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Command "${command}" failed: ${message}`);
    }
  }

  return {
    success: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
    logs: logs.join("\n\n"),
  };
}

function parseErrors(output: string, command: string): string[] {
  const errors: string[] = [];
  const lines = output.split("\n");

  if (command.includes("typecheck") || command.includes("tsc")) {
    const tsErrors = lines.filter(
      (line) => line.includes("error TS") || line.includes(": error:")
    );
    errors.push(...tsErrors.slice(0, 10));
  } else if (command.includes("lint") || command.includes("eslint")) {
    const lintErrors = lines.filter(
      (line) => line.includes("error") || line.includes("warning")
    );
    errors.push(...lintErrors.slice(0, 10));
  } else if (command.includes("build")) {
    const buildErrors = lines.filter(
      (line) =>
        line.toLowerCase().includes("error") ||
        line.toLowerCase().includes("failed")
    );
    errors.push(...buildErrors.slice(0, 10));
  } else {
    if (output.trim()) {
      errors.push(`${command}: ${output.slice(0, 500)}`);
    }
  }

  return errors.length > 0 ? errors : [`${command} failed with non-zero exit code`];
}

export async function checkWorkspaceHealth(
  workspacePath: string
): Promise<{ valid: boolean; reason?: string }> {
  const packageJson = Bun.file(`${workspacePath}/package.json`);

  if (!(await packageJson.exists())) {
    return { valid: false, reason: "No package.json found" };
  }

  try {
    const pkg = await packageJson.json();
    if (!pkg.scripts) {
      return { valid: false, reason: "No scripts defined in package.json" };
    }
    return { valid: true };
  } catch {
    return { valid: false, reason: "Invalid package.json" };
  }
}
