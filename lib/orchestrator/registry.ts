/**
 * SeoFlow — Orchestrator Registry
 *
 * Central registry of all pipeline steps/specialists. Each step declares:
 * - What it needs (dependencies on other steps)
 * - What it produces (for dependency resolution)
 * - Whether it's parallel-safe
 *
 * The orchestrator uses this to determine optimal execution order
 * with parallel dispatch where possible.
 */
import type { StepInput, StepOutput } from '../types';

/** Step execution mode */
export type StepExecutionMode = 'sequential' | 'parallel';

/** Step dependency declaration */
export interface StepDependency {
  stepId: string;
  /** This step requires the output of stepId */
  requires: string[];
  /** This step is blocked until stepId completes */
  blocks?: string[];
}

/** Registration entry for a step/specialist */
export interface StepRegistration {
  id: string;
  name: string;
  description: string;
  category: 'meta' | 'content' | 'technical' | 'strategy' | 'research' | 'reporting';
  /** Step functions that take StepInput and return StepOutput */
  executor: (input: StepInput, deps?: Record<string, StepOutput>) => Promise<StepOutput>;
  dependencies: string[];
  mode: StepExecutionMode;
  /** Estimated cost/weight for scheduling decisions */
  weight: number; // 1-10, higher = heavier
  /** Can run without AI keys */
  noAiRequired?: boolean;
}

/** Execution plan — ordered groups of steps */
export interface ExecutionPlan {
  phases: ExecutionPhase[];
}

export interface ExecutionPhase {
  /** Parallel-safe steps in this phase */
  steps: StepRegistration[];
  /** Sequential steps in this phase (each waits for previous) */
  sequential: StepRegistration[];
}

const registry = new Map<string, StepRegistration>();

export function registerStep(step: StepRegistration): void {
  registry.set(step.id, step);
}

export function getStep(id: string): StepRegistration | undefined {
  return registry.get(id);
}

export function getAllSteps(): StepRegistration[] {
  return Array.from(registry.values());
}

/** Build an execution plan from the registry with topological ordering */
export function buildExecutionPlan(stepFilter?: string[]): ExecutionPlan {
  let steps = getAllSteps();

  if (stepFilter && stepFilter.length > 0) {
    steps = steps.filter(s => stepFilter.includes(s.id));
  }

  // Build dependency graph
  const deps = new Map<string, Set<string>>();
  for (const step of steps) {
    deps.set(step.id, new Set(step.dependencies));
  }

  // Topological sort (Kahn's algorithm)
  const inDegree = new Map<string, number>();
  for (const [id, depSet] of deps) {
    inDegree.set(id, 0);
  }
  for (const [, depSet] of deps) {
    for (const dep of depSet) {
      inDegree.set(dep, (inDegree.get(dep) || 0) + 1);
    }
  }

  const phases: ExecutionPhase[] = [];
  let queue: string[] = [];

  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const processed = new Set<string>();

  while (queue.length > 0 || processed.size < steps.length) {
    if (queue.length === 0) {
      // Circular dependency — run remaining sequentially
      const remaining = steps.filter(s => !processed.has(s.id));
      const stepRegs = remaining.map(r => {
        const reg = registry.get(r.id);
        if (!reg) throw new Error(`Step ${r.id} not registered`);
        return reg;
      });
      if (stepRegs.length > 0) {
        phases.push({ steps: [], sequential: stepRegs });
      }
      break;
    }

    const phase: ExecutionPhase = { steps: [], sequential: [] };

    for (const stepId of queue) {
      const reg = registry.get(stepId);
      if (!reg) continue;
      processed.add(stepId);

      if (reg.mode === 'parallel') {
        phase.steps.push(reg);
      } else {
        phase.sequential.push(reg);
      }
    }

    // Calculate next queue
    const nextQueue: string[] = [];
    for (const [id, depSet] of deps) {
      if (processed.has(id)) continue;
      for (const d of depSet) {
        if (processed.has(d)) {
          depSet.delete(d);
        }
      }
      if (depSet.size === 0 && !processed.has(id)) {
        nextQueue.push(id);
      }
    }

    if (queue.length > 0) {
      phases.push(phase);
    }
    queue = nextQueue;
  }

  return { phases };
}

/**
 * Summarize the plan for display
 */
export function planSummary(plan: ExecutionPlan): string[] {
  const lines: string[] = [];
  plan.phases.forEach((phase, i) => {
    const parallel = phase.steps.map(s => s.id).join(', ');
    const sequential = phase.sequential.map(s => s.id).join(' → ');
    const parts: string[] = [];
    if (parallel) parts.push(`⟳ ${parallel}`);
    if (sequential) parts.push(`→ ${sequential}`);
    lines.push(`  Phase ${i + 1}: ${parts.join(' | ')}`);
  });
  return lines;
}
