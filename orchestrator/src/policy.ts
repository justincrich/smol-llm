import type { Task, Tier } from "./types";
import { MAX_ATTEMPTS_PER_TIER, MAX_TOTAL_ATTEMPTS } from "./types";

const TIER_ORDER: Tier[] = ["fast", "deep", "reviewer"];

export function getNextTier(currentTier: Tier): Tier | null {
  const currentIndex = TIER_ORDER.indexOf(currentTier);
  if (currentIndex === -1 || currentIndex >= TIER_ORDER.length - 1) {
    return null;
  }
  return TIER_ORDER[currentIndex + 1];
}

export function shouldEscalate(task: Task, _errors: string[]): boolean {
  const tierAttempts = task.tierAttempts[task.tier] || 0;

  if (tierAttempts >= MAX_ATTEMPTS_PER_TIER) {
    const nextTier = getNextTier(task.tier);
    return nextTier !== null;
  }

  return false;
}

export function shouldAbort(task: Task): boolean {
  if (task.attempt >= MAX_TOTAL_ATTEMPTS) {
    return true;
  }

  const tierAttempts = task.tierAttempts[task.tier] || 0;
  if (tierAttempts >= MAX_ATTEMPTS_PER_TIER) {
    const nextTier = getNextTier(task.tier);
    if (nextTier === null) {
      return true;
    }
  }

  return false;
}

export function escalateTask(task: Task): Task {
  const nextTier = getNextTier(task.tier);
  if (!nextTier) {
    throw new Error(`Cannot escalate from tier: ${task.tier}`);
  }

  return {
    ...task,
    tier: nextTier,
    attempt: task.attempt + 1,
    tierAttempts: {
      ...task.tierAttempts,
      [nextTier]: 0,
    },
  };
}

export function incrementAttempt(task: Task): Task {
  return {
    ...task,
    attempt: task.attempt + 1,
    tierAttempts: {
      ...task.tierAttempts,
      [task.tier]: (task.tierAttempts[task.tier] || 0) + 1,
    },
  };
}
