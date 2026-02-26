export type Tier = "fast" | "deep" | "reviewer";

export interface Task {
  id: string;
  description: string;
  filesOwned: string[];
  tier: Tier;
  attempt: number;
  maxAttempts: number;
  tierAttempts: Record<Tier, number>;
}

export interface TaskInput {
  description: string;
  filesOwned: string[];
}

export interface VerifyResult {
  success: boolean;
  errors?: string[];
  logs?: string;
}

export interface PatchResult {
  success: boolean;
  patch?: string;
  error?: string;
  linesChanged?: number;
}

export interface ModelResponse {
  content: string;
  model: string;
  tokensUsed: number;
}

export const TIER_MODELS: Record<Tier, string> = {
  fast: "fast-coder",
  deep: "deep-coder",
  reviewer: "reviewer",
};

export const CONCURRENCY_LIMITS: Record<Tier, number> = {
  fast: 4,
  deep: 1,
  reviewer: 2,
};

export const MAX_PATCH_LINES = 300;
export const MAX_ATTEMPTS_PER_TIER = 2;
export const MAX_TOTAL_ATTEMPTS = 5;
