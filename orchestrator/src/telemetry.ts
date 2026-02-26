import pino from "pino";
import type { Tier, Task } from "./types";

export type LogEvent =
  | "task_created"
  | "model_call_start"
  | "model_call_complete"
  | "patch_applied"
  | "patch_rejected"
  | "verification_start"
  | "verification_pass"
  | "verification_fail"
  | "escalation"
  | "task_complete"
  | "task_abort";

interface LogContext {
  taskId: string;
  tier: Tier;
  event: LogEvent;
  attempt: number;
}

const isDev = process.env.NODE_ENV !== "production";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  ...(isDev && {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
      },
    },
  }),
});

export function createTaskLogger(task: Task) {
  return {
    info(event: LogEvent, extra?: Record<string, unknown>) {
      logger.info({
        taskId: task.id,
        tier: task.tier,
        event,
        attempt: task.attempt,
        ...extra,
      } satisfies LogContext & Record<string, unknown>);
    },
    error(event: LogEvent, error: unknown, extra?: Record<string, unknown>) {
      logger.error({
        taskId: task.id,
        tier: task.tier,
        event,
        attempt: task.attempt,
        error: error instanceof Error ? error.message : String(error),
        ...extra,
      });
    },
    warn(event: LogEvent, extra?: Record<string, unknown>) {
      logger.warn({
        taskId: task.id,
        tier: task.tier,
        event,
        attempt: task.attempt,
        ...extra,
      });
    },
  };
}

export function logStartup(config: { litellmUrl: string; workspace: string }) {
  logger.info({ event: "orchestrator_start", ...config });
}

export function logShutdown(reason: string) {
  logger.info({ event: "orchestrator_shutdown", reason });
}
