/**
 * Orchestrator — runs pipeline steps with dependency-aware ordering and
 * per-step assignment tracking.
 *
 * Ported from SEO Office's orchestrator pattern. For SeoFlow, this is
 * a simplified in-process engine (no SSE, no job queue — CLI-only).
 */
import fs from 'node:fs';
import path from 'node:path';
import { appendLog, writeBrain } from '../brain';
import { SkipStepError, requireIntegration } from '../degradation';
import { extractDataBlock, writeDataSidecar, type ReviewData, isReviewData, type TechnicalData, isTechnicalData } from '../structured-output';
import type {
  Assignment,
  AssignmentStatus,
  PipelineState,
  Phase,
  StepDefinition,
} from './types';
import { ALL_STEPS, generateId } from './types';

const STATE_PATH = () => path.join(process.cwd(), '.seoflow', 'data', 'pipeline-state.json');

// ─── State persistence ────────────────────────────────────────────────────────

function loadState(): PipelineState {
  const p = STATE_PATH();
  if (!fs.existsSync(p)) {
    return {
      version: 1,
      lastUpdated: new Date().toISOString(),
      assignments: [],
      currentPhase: 'intake',
      status: 'idle',
    };
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as PipelineState;
  } catch {
    return {
      version: 1,
      lastUpdated: new Date().toISOString(),
      assignments: [],
      currentPhase: 'intake',
      status: 'idle',
    };
  }
}

function saveState(state: PipelineState): void {
  const p = STATE_PATH();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  state.lastUpdated = new Date().toISOString();
  fs.writeFileSync(p, JSON.stringify(state, null, 2));
}

// ─── Assignment management ───────────────────────────────────────────────────

export function createAssignment(slug: string, step: StepDefinition): Assignment {
  return {
    id: generateId(),
    slug,
    stepId: step.id,
    stepName: step.name,
    status: 'proposed',
    proposedAt: new Date().toISOString(),
  };
}

function updateAssignment(state: PipelineState, id: string, updates: Partial<Assignment>): void {
  const idx = state.assignments.findIndex((a) => a.id === id);
  if (idx !== -1) {
    state.assignments[idx] = { ...state.assignments[idx], ...updates };
    saveState(state);
  }
}

/** Get the latest assignment for a given slug + step */
function findAssignment(state: PipelineState, slug: string, stepId: string): Assignment | undefined {
  return state.assignments
    .filter((a) => a.slug === slug && a.stepId === stepId)
    .pop();
}

// ─── Dependency resolution ──────────────────────────────────────────────────

function getDependenciesMet(state: PipelineState, step: StepDefinition, slug: string): boolean {
  if (step.dependsOn.length === 0) return true;
  return step.dependsOn.every((depId) => {
    const dep = state.assignments.find((a) => a.slug === slug && a.stepId === depId);
    return dep?.status === 'succeeded' || dep?.status === 'skipped';
  });
}

function getIntegrationsAvailable(step: StepDefinition): boolean {
  if (step.requiresIntegrations.length === 0) return true;
  for (const req of step.requiresIntegrations) {
    try {
      requireIntegration(req as any);
    } catch {
      return false;
    }
  }
  return true;
}

function getPhaseSteps(phase: Phase): StepDefinition[] {
  return ALL_STEPS.filter((s) => s.phase === phase);
}

function getNextPhase(current: Phase): Phase | null {
  const phases: Phase[] = ['intake', 'diagnostic', 'discovery', 'synthesis', 'final'];
  const idx = phases.indexOf(current);
  return idx < phases.length - 1 ? phases[idx + 1] : null;
}

// ─── Execution ────────────────────────────────────────────────────────────────

export type StepRunner = (slug: string) => Promise<{
  success: boolean;
  changes?: string[];
  data?: Record<string, unknown>;
  error?: string;
}>;

const stepRunners = new Map<string, StepRunner>();

/** Register a step runner — called from pipeline/steps.ts */
export function registerStepRunner(stepId: string, runner: StepRunner): void {
  stepRunners.set(stepId, runner);
}

/** Check if a phase is complete (all its steps have run) */
function isPhaseComplete(state: PipelineState, phase: Phase): boolean {
  const phaseSteps = getPhaseSteps(phase);
  return phaseSteps.every((step) => {
    return state.assignments.some(
      (a) => a.stepId === step.id && (a.status === 'succeeded' || a.status === 'failed' || a.status === 'skipped'),
    );
  });
}

/**
 * Run the pipeline for one or more slugs.
 */
export async function runPipeline(slugs: string[], dryRun = false): Promise<{
  succeeded: number;
  failed: number;
  skipped: number;
  totalChanges: number;
  errors: string[];
}> {
  const state = loadState();
  state.status = 'running';
  saveState(state);

  let totalSucceeded = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let totalChanges = 0;
  const errors: string[] = [];

  // Resolve all steps in dependency order
  const resolvedSteps = resolveDependencyOrder();

  const started = Date.now();
  appendLog({
    type: 'run',
    summary: `Pipeline started for ${slugs.length} post(s)`,
    detail: `Slugs: ${slugs.join(', ')}`,
  });

  for (const slug of slugs) {
    // Create proposed assignments
    for (const step of resolvedSteps) {
      const existing = findAssignment(state, slug, step.id);
      if (!existing) {
        const assignment = createAssignment(slug, step);
        state.assignments.push(assignment);
        saveState(state);
      }
    }

    // Run each step in dependency order
    for (const step of resolvedSteps) {
      const assignment = findAssignment(state, slug, step.id);
      if (!assignment) continue;

      // Skip if dependencies not met
      if (!getDependenciesMet(state, step, slug)) {
        updateAssignment(state, assignment.id, { status: 'skipped', error: `Dependency not met: ${step.dependsOn.filter((d) => !state.assignments.find((a) => a.slug === slug && a.stepId === d && a.status === 'succeeded')).join(', ')}` });
        totalSkipped++;
        appendLog({ type: 'step', summary: `Skipped ${step.name} for ${slug} (dependency not met)`, slug, step: step.id });
        continue;
      }

      // Skip if required integrations missing
      if (!dryRun && !getIntegrationsAvailable(step)) {
        updateAssignment(state, assignment.id, { status: 'skipped', error: 'Required integration not available' });
        totalSkipped++;
        appendLog({ type: 'step', summary: `Skipped ${step.name} for ${slug} (missing integration)`, slug, step: step.id });
        continue;
      }

      if (dryRun) {
        console.log(`  [DRY-RUN] Would run ${step.name} on ${slug}`);
        updateAssignment(state, assignment.id, { status: 'proposed' });
        continue;
      }

      // Run the step
      const runner = stepRunners.get(step.id);
      if (!runner) {
        updateAssignment(state, assignment.id, { status: 'failed', error: 'No runner registered' });
        totalFailed++;
        errors.push(`${step.name} on ${slug}: no runner registered`);
        appendLog({ type: 'error', summary: `No runner for ${step.name} on ${slug}`, slug, step: step.id });
        continue;
      }

      updateAssignment(state, assignment.id, { status: 'running', startedAt: new Date().toISOString() });

      try {
        console.log(`  📝 ${step.name} on ${slug}...`);
        const result = await runner(slug);

        if (result.success) {
          const changeCount = result.changes?.length || 0;
          updateAssignment(state, assignment.id, {
            status: 'succeeded',
            finishedAt: new Date().toISOString(),
            changes: result.changes,
            changeCount,
            data: result.data,
          });
          totalSucceeded++;
          totalChanges += changeCount;
          appendLog({ type: 'change', summary: `${step.name}: ${changeCount} changes on ${slug}`, slug, step: step.id, changeCount });

          // Write data sidecar if we have structured data
          if (result.data) {
            const sidecarPath = path.join(process.cwd(), '.seoflow', 'data', `${slug}-${step.id}.data.json`);
            fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
            fs.writeFileSync(sidecarPath, JSON.stringify(result.data, null, 2));
          }
        } else {
          updateAssignment(state, assignment.id, {
            status: 'failed',
            finishedAt: new Date().toISOString(),
            error: result.error || 'Unknown error',
          });
          totalFailed++;
          errors.push(`${step.name} on ${slug}: ${result.error || 'Unknown'}`);
          appendLog({ type: 'error', summary: `${step.name} failed on ${slug}: ${result.error || 'Unknown'}`, slug, step: step.id });
        }
      } catch (e) {
        if (e instanceof SkipStepError) {
          updateAssignment(state, assignment.id, { status: 'skipped', error: e.message });
          totalSkipped++;
          appendLog({ type: 'step', summary: `Skipped ${step.name} on ${slug}: ${e.message}`, slug, step: step.id });
        } else {
          const msg = e instanceof Error ? e.message : String(e);
          updateAssignment(state, assignment.id, { status: 'failed', finishedAt: new Date().toISOString(), error: msg });
          totalFailed++;
          errors.push(`${step.name} on ${slug}: ${msg}`);
          appendLog({ type: 'error', summary: `${step.name} error on ${slug}: ${msg}`, slug, step: step.id });
        }
      }
    }
  }

  // Update phase
  const currentPhase = state.currentPhase;
  for (const phase of ['intake', 'diagnostic', 'discovery', 'synthesis', 'final'] as Phase[]) {
    if (isPhaseComplete(state, phase)) {
      state.currentPhase = phase;
    }
  }

  // Final status
  const allComplete = isPhaseComplete(state, 'final');
  state.status = allComplete ? 'completed' : (totalFailed > 0 ? 'failed' : 'completed');

  const duration = Date.now() - started;

  // Write to brain
  writeBrain({ lastRun: { timestamp: new Date().toISOString(), duration, postsProcessed: slugs.length, errors: totalFailed, totalChanges } });

  saveState(state);

  return { succeeded: totalSucceeded, failed: totalFailed, skipped: totalSkipped, totalChanges, errors };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveDependencyOrder(): StepDefinition[] {
  const visited = new Set<string>();
  const result: StepDefinition[] = [];
  const stepMap = new Map(ALL_STEPS.map((s) => [s.id, s]));

  function visit(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);
    const step = stepMap.get(id);
    if (!step) return;
    for (const dep of step.dependsOn) {
      visit(dep);
    }
    result.push(step);
  }

  for (const step of ALL_STEPS) {
    visit(step.id);
  }
  return result;
}

/** Print pipeline status */
export function printPipelineStatus(): void {
  const state = loadState();

  console.log('\n📊 Pipeline Status');
  console.log(`   Status: ${state.status}`);
  console.log(`   Current phase: ${state.currentPhase}`);
  console.log(`   Total assignments: ${state.assignments.length}`);
  console.log('');

  // Group by phase
  const phases: Phase[] = ['intake', 'diagnostic', 'discovery', 'synthesis', 'final'];
  for (const phase of phases) {
    const phaseSteps = getPhaseSteps(phase);
    const phaseAssignments = state.assignments.filter((a) => phaseSteps.some((s) => s.id === a.stepId));
    if (phaseAssignments.length === 0) continue;

    const succeeded = phaseAssignments.filter((a) => a.status === 'succeeded').length;
    const failed = phaseAssignments.filter((a) => a.status === 'failed').length;
    const skipped = phaseAssignments.filter((a) => a.status === 'skipped').length;
    const pending = phaseAssignments.filter((a) => a.status === 'proposed' || a.status === 'queued').length;

    console.log(`   📁 ${phase.toUpperCase()}: ${succeeded} done, ${failed} failed, ${skipped} skipped, ${pending} pending`);

    // Show last few assignments per phase
    const recent = phaseAssignments.slice(-3);
    for (const a of recent) {
      const icon = a.status === 'succeeded' ? '✅' : a.status === 'failed' ? '❌' : a.status === 'skipped' ? '⏭' : '⏳';
      console.log(`     ${icon} ${a.stepName} on ${a.slug} — ${a.status}${a.changes?.length ? ` (${a.changes.length} changes)` : ''}`);
    }
  }
}