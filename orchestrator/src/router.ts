import OpenAI from "openai";
import type { Tier, Task } from "./types";
import { CONCURRENCY_LIMITS, TIER_MODELS } from "./types";

export class Semaphore {
  private permits: number;
  private queue: (() => void)[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next?.();
    } else {
      this.permits++;
    }
  }

  async withPermit<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

const semaphores: Record<Tier, Semaphore> = {
  fast: new Semaphore(CONCURRENCY_LIMITS.fast),
  deep: new Semaphore(CONCURRENCY_LIMITS.deep),
  reviewer: new Semaphore(CONCURRENCY_LIMITS.reviewer),
};

export function getSemaphore(tier: Tier): Semaphore {
  return semaphores[tier];
}

export function createClient(baseURL?: string): OpenAI {
  return new OpenAI({
    baseURL: baseURL || process.env.LITELLM_URL || "http://localhost:4000/v1",
    apiKey: process.env.LITELLM_API_KEY || "dev-key",
  });
}

export function getModelForTier(tier: Tier): string {
  return TIER_MODELS[tier];
}

export function selectInitialTier(task: Pick<Task, "filesOwned" | "description">): Tier {
  const fileCount = task.filesOwned.length;
  const descriptionLength = task.description.length;

  if (fileCount > 5 || descriptionLength > 1000) {
    return "deep";
  }

  return "fast";
}
