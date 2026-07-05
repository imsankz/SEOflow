/**
 * SeoFlow — Orchestrator Dispatch
 *
 * Executes pipeline steps according to the execution plan,
 * running independent steps in parallel and sequential steps in order.
 */
import type { StepInput, StepOutput } from '../types';
import { buildExecutionPlan, registerStep, type ExecutionPlan, type StepRegistration } from './registry';

export interface DispatchResult {
  slug: string;
  stepResults: Record<string, StepOutput>;
  changes: number;
  errors: string[];
  duration: number;
}

/** Register all pipeline steps into the registry */
export function registerStaticSteps(
  stepMap: Record<string, (input: StepInput, deps?: Record<string, StepOutput>) => Promise<StepOutput>>,
): void {
  for (const [id, executor] of Object.entries(stepMap)) {
    registerStep({
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      description: `Pipeline step: ${id}`,
      category: inferCategory(id),
      executor,
      dependencies: getDependencies(id),
      mode: inferMode(id),
      weight: inferWeight(id),
      noAiRequired: inferNoAi(id),
    });
  }
}

function inferCategory(id: string): StepRegistration['category'] {
  const cats: Record<string, StepRegistration['category']> = {
    keywords: 'research',
    meta: 'meta',
    links: 'content',
    images: 'content',
    neuron: 'content',
    content: 'content',
    review: 'strategy',
    schema: 'technical',
    technical: 'technical',
    quality: 'strategy',
    factcheck: 'strategy',
    report: 'reporting',
  };
  return cats[id] || 'content';
}

function getDependencies(id: string): string[] {
  const deps: Record<string, string[]> = {
    keywords: [],
    meta: ['keywords'],
    links: ['meta'],
    images: ['meta'],
    neuron: ['keywords'],
    content: ['neuron', 'images'],
    review: ['content'],
    schema: ['meta'],
    technical: [],
    quality: ['technical', 'schema'],
    factcheck: ['content'],
    report: ['technical', 'quality', 'review', 'schema'],
  };
  return deps[id] || [];
}

function inferMode(id: string): 'sequential' | 'parallel' {
  // Steps that don't depend on each other can run in parallel
  const parallelSafe = ['technical', 'schema', 'images', 'links', 'keywords'];
  return parallelSafe.includes(id) ? 'parallel' : 'sequential';
}

function inferWeight(id: string): number {
  const weights: Record<string, number> = {
    keywords: 3,
    meta: 1,
    links: 2,
    images: 4,
    neuron: 5,
    content: 8,
    review: 6,
    schema: 3,
    technical: 4,
    quality: 5,
    factcheck: 5,
    report: 2,
  };
  return weights[id] || 3;
}

function inferNoAi(id: string): boolean {
  return ['meta', 'links', 'images', 'technical', 'report'].includes(id);
}

/**
 * Execute steps for a single post using the plan.
 * Parallel-safe steps run concurrently; sequential steps wait.
 */
export async function executePost(
  input: StepInput,
  stepFilter?: string[],
  dryRun?: boolean,
): Promise<DispatchResult> {
  const start = Date.now();
  const stepResults: Record<string, StepOutput> = {};
  const errors: string[] = [];
  let totalChanges = 0;

  const plan = buildExecutionPlan(stepFilter);

  for (const phase of plan.phases) {
    // Run parallel steps concurrently
    if (phase.steps.length > 0) {
      const promises = phase.steps.map(async (step) => {
        try {
          const deps = getDepResults(step, stepResults);
          const result = await step.executor(input, deps);
          stepResults[step.id] = result;
          totalChanges += result.changes.length;
          if (dryRun) {
            console.log(`     [dry-run] ${step.id}: ${result.changes.map(c => c.slice(0, 60)).join(', ')}`);
          }
        } catch (err) {
          errors.push(`${step.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
      await Promise.all(promises);
    }

    // Run sequential steps one by one
    for (const step of phase.sequential) {
      try {
        const deps = getDepResults(step, stepResults);
        const result = await step.executor(input, deps);
        stepResults[step.id] = result;
        totalChanges += result.changes.length;
        if (dryRun) {
          console.log(`     [dry-run] ${step.id}: ${result.changes.map(c => c.slice(0, 60)).join(', ')}`);
        }
      } catch (err) {
        errors.push(`${step.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return {
    slug: input.slug,
    stepResults,
    changes: totalChanges,
    errors,
    duration: Date.now() - start,
  };
}

/** Collect dependency results for a step */
function getDepResults(
  step: StepRegistration,
  results: Record<string, StepOutput>,
): Record<string, StepOutput> {
  const deps: Record<string, StepOutput> = {};
  for (const depId of step.dependencies) {
    if (results[depId]) {
      deps[depId] = results[depId];
    }
  }
  return deps;
}

/**
 * Execute across multiple posts, reporting progress.
 */
export async function executePipeline(
  posts: Array<{
    slug: string;
    input: StepInput;
  }>,
  stepFilter?: string[],
  dryRun?: boolean,
): Promise<DispatchResult[]> {
  const results: DispatchResult[] = [];

  for (const post of posts) {
    console.log(`\n  📄 ${post.slug}`);
    const result = await executePost(post.input, stepFilter, dryRun);
    results.push(result);

    if (result.errors.length > 0) {
      for (const err of result.errors) {
        console.log(`     ❌ ${err}`);
      }
    }
    console.log(`     ✓ ${result.changes} changes in ${(result.duration / 1000).toFixed(1)}s`);
  }

  return results;
}
