# SeoFlow <> SEO Office Integration Plan

> **Status:** In progress — created on 2026-07-04
> **Goal:** Port architectural and reliability improvements from SEO Office into SeoFlow while keeping SeoFlow lightweight and portable.

## Current State

| Dimension | SeoFlow | SEO Office |
|-----------|---------|------------|
| **Type** | Portable Node.js CLI pipeline | Next.js 16 desktop app with 3D UI |
| **Scope** | Single content site | Multi-client agency OS |
| **UI** | CLI only (TTY output) | 3D office (R3F), dashboard, vault browser |
| **Specialists** | 1 generalized 11-step pipeline | 25 single-purpose specialists |
| **Orchestration** | Sequential hardcoded steps | Phase-gated job queue with state machine |
| **Brain** | `.seoflow/data/` (JSON files) | Per-client vault + SQLite index + `hot.md`/`log.md` |
| **LLM providers** | Gemini + OpenRouter (hardcoded) | Anthropic SDK, Claude CLI, Codex CLI, Gemini CLI, OpenAI |
| **Structured output** | Plain text parsing | Zod schemas + JSON sidecars + severity charts |
| **Integration degradation** | Fails when API key missing | Gracefully skips with "degradation" envelope |
| **Reports** | Markdown text | Markdown + HTML + inline severity charts |
| **Assignments** | None — all-or-nothing pipeline | Proposed → Queued → Running → Succeeded/Failed |
| **Next-action** | None | `next-action.ts` state machine suggests what's next |
| **Provider abstraction** | Hardcoded per-client | `selectProvider()` via `src/lib/integrations/providers/` |

## Guiding Principles

1. **Keep SeoFlow portable** — it must still work as a drop-in npm package for any content site.
2. **No UI bloat** — port architecture, not the 3D office. Stay CLI-first.
3. **Opt-in complexity** — new features should be configurable; default experience stays simple.
4. **Port the good parts** — orchestrator, brain, provider abstraction, structured output, degradation.
5. **Leave the rest** — 3D office, multi-tenancy, agency features are out of scope for SeoFlow.

## Phased Implementation

### Phase 1: Foundation (Provider Abstraction + Structured Output)

**Goal:** Make SeoFlow work with any LLM provider, not just Gemini/OpenRouter.

- [x] **1.1 Create `lib/providers/`** — Port SEO Office's provider abstraction
  - `base.ts` — common interface (`chat()`, `stream()`, `name`, `id`)
  - `gemini.ts` — existing Gemini adapter
  - `openrouter.ts` — existing OpenRouter adapter
  - `anthropic.ts` — Anthropic SDK (new)
  - `claude-cli.ts` — Claude CLI bridge via `child_process`
  - `gemini-cli.ts` — Gemini CLI bridge
  - `codex-cli.ts` — Codex CLI bridge
  - `index.ts` — `selectProvider()` with priority fallback chain

- [x] **1.2 Add Zod for structured output**
  - Add `zod` to dependencies
  - Create `lib/structured-output.ts` — `applyStructuredOutput({ rawText, expectedKind, zodSchema })`
  - Port severity chart generation (not chart, just JSON data)

- [x] **1.3 Integrate structured output into pipeline**
  - Each step returns both `body` (markdown) and `data` (JSON)
  - `lib/schema.ts` gains Zod schemas: `AuditData`, `MetaFixData`, `LinkData`, etc.
  - Steps emit structured findings → downstream steps can read them

### Phase 2: Brain (Working Memory + Audit Trail)

**Goal:** Give SeoFlow persistent working memory so it knows what happened last run.

- [x] **2.1 Create `lib/brain/`**
  - `hot.md` — working memory (~500 words, overwritten per session). Tracks: last run date, posts touched, issues found, next actions.
  - `log.md` — append-only audit trail. Every decision + rationale. New entries only, never edit.
  - `types.ts` — `brain_schema: seoflow-brain.v1` frontmatter fields

- [x] **2.2 Brain API**
  - `loadBrain()` — reads `.seoflow/data/hot.md` + `.seoflow/data/log.md`
  - `updateHot(content)` — overwrites hot.md (session-scoped)
  - `appendLog(entry)` — appends to log.md with timestamp
  - `getLastRunFor(slug)` — query log.md for a post's last audit date

- [x] **2.3 Hook brain into pipeline**
  - `run.ts` writes to `hot.md` at start: "Run started at X, targeting Y posts"
  - Each step appends to `log.md`: what changed and why
  - `seoflow status` reads hot.md + log.md to show state

### Phase 3: Orchestrator (State Machine + Assignments)

**Goal:** Replace the hardcoded sequential pipeline with a state machine that knows what's next.

- [x] **3.1 Assignment system**
  - `lib/assignment.ts` — `Assignment` type: `{ id, slug, step, status, proposedAt, startedAt, finishedAt, error }`
  - `.seoflow/data/assignments.json` — persists assignment state
  - Status: `proposed` → `queued` → `running` → `succeeded` | `failed`

- [x] **3.2 Step definitions**
  - Convert each step from a hardcoded function to a registered step object
  - Each step: `id`, `name`, `inputSchema` (Zod), `dependencies` (array of step IDs), `execute()`
  - Steps: `keyword-research`, `fix-frontmatter`, `inject-links`, `inject-images`, `neuron-analysis`, `content-audit`, `seo-review`, `schema-validation`, `quality-audit`, `technical-audit`, `fact-check`, `report-export`

- [x] **3.3 Orchestrator engine**
  - `lib/orchestrator.ts` — topological sort from dependency graph, run parallel where possible
  - Phase gates: `intake` → `diagnostic` → `discovery` → `synthesis` → `final`
  - Health scoring: track failures, compute overall pipeline health (0-100)
  - `next-action.ts` — given current state, suggest next post/step to run

- [x] **3.4 Dry-run support**
  - `--dry-run` creates assignments in `proposed` state but does not execute
  - Shows what WOULD run without running it

### Phase 4: Integration Degradation (Graceful Fallbacks)

**Goal:** SeoFlow never fails because of a missing API key — it skips that step and explains why.

- [x] **4.1 Degradation layer**
  - `lib/degradation.ts` — `checkIntegration(integration最少)` → `{ available, reason }`
  - Each step checks its required integrations before running
  - If unavailable: emit `SKIPPED (yellow)` with explanation

- [x] **4.2 Key integration checks**
  - `gemini-client.ts` — check `GEMINI_API_KEY`
  - `openrouter-client.ts` — check `OPENROUTER_API_KEY`
  - `neuronwriter.ts` — check `NEURONWRITER_API_KEY`
  - `pexels-client.ts` — check `PEXELS_API_KEY` or `UNSPLASH_API_KEY`
  - `semrush-client.ts` — check `SEMRUSH_API_KEY`
  - `ahrefs-client.ts` — check `AHREFS_API_KEY`
  - `ubersuggest-client.ts` — MCP check (always available if MCP running)
  - GSC live API — check `GOOGLE_APPLICATION_CREDENTIALS` or ADC

### Phase 5: Enhanced Reports

**Goal:** Upgrade from plain markdown to structured JSON + HTML reports.

- [ ] **5.1 HTML report generation**
  - `lib/reports/html.ts` — converts structured audit data into a single HTML file
  - Severity bar chart (JSON data, render with inline JS or simple ASCII)
  - Per-post scorecards

- [ ] **5.2 Report directory**
  - `.seoflow/reports/<timestamp>-<slug>.html`
  - `.seoflow/reports/<timestamp>-summary.html`

- [ ] **5.3 JSON data sidecars**
  - Every markdown report gets a `.data.json` sidecar with structured findings
  - Enables programmatic consumption by other tools

### Phase 6: Testing + Polish

- [ ] **6.1 Add tests for new modules**
  - Provider abstraction: mock each provider, test fallback chain
  - Brain: hot.md/log.md roundtrip, append-only invariant
  - Orchestrator: dependency graph, phase gates, failure handling
  - Degradation: test each integration check with/without env vars

- [ ] **6.2 Update CLI commands**
  - `seoflow status` — reads brain, shows assignments, next actions
  - `seoflow audit` — uses orchestrator
  - `seoflow audit <slug> --step <id>` — run one step
  - `seoflow audit --dry-run` — show what would run
  - `seoflow brain` — view hot.md / log.md

- [ ] **6.3 Documentation**
  - Update `AGENTS.md` with new architecture
  - Update `README.md` with new capabilities
  - Update `seoflow.config.template.json` with new options

## Data Model Changes

### Current (SeoFlow)
```
.seoflow/
  data/
    audit-log.json
    learning.json
    keyword-cache.json
```

### Target (SeoFlow + SEO Office brain)
```
.seoflow/
  brain/
    hot.md           # working memory (overwritten per session)
    log.md           # append-only audit trail
  data/
    audit-log.json
    learning.json
    keyword-cache.json
    assignments.json # assignment state machine
  reports/
    <timestamp>-<slug>.html
    <timestamp>-<slug>.data.json
```

## What We're NOT Porting

| Feature | Reason |
|---------|--------|
| 3D Office UI (R3F) | SeoFlow is CLI-first by design |
| Multi-tenant clients | SeoFlow targets single site owners, not agencies |
| Per-client vaults | Simplified to single `.seoflow/brain/` directory |
| Tauri desktop packaging | Out of scope for a Node.js CLI package |
| SQLite index | JSON files suffice for single-site scale |
| SSE streaming | CLI uses stdout, not HTTP |
| Anthropic prompt caching | Nice-to-have, not critical for a CLI tool |

## Implementation Order (Do This Next)

1. **Start with Phase 1.1** — Create `lib/providers/` and `selectProvider()`
2. **Then Phase 2.1** — Create `lib/brain/` with hot.md + log.md
3. **Then Phase 3.1** — Add assignment system to `.seoflow/data/assignments.json`
4. **Then Phase 3.3** — Build the orchestrator engine
5. **Then Phase 4** — Add degradation checks to every integration
6. **Finally Phase 5** — HTML reports and JSON sidecars

## Files to Create / Modify

### New files
```
lib/
  providers/
    base.ts
    gemini.ts
    openrouter.ts
    anthropic.ts
    claude-cli.ts
    gemini-cli.ts
    codex-cli.ts
    index.ts
  brain/
    index.ts
    types.ts
  orchestrator/
    index.ts
    types.ts
    next-action.ts
  assignment/
    index.ts
    types.ts
  degradation/
    index.ts
  reports/
    html.ts
  structured-output.ts
```

### Modified files
```
lib/
  ai-provider.ts        # delegate to provider abstraction
  config.ts             # add provider priority config
pipeline/
  steps.ts              # register steps with orchestrator
run.ts                  # use orchestrator instead of hardcoded flow
```

## Next Step

Begin Phase 1.1: Create `lib/providers/` directory with the provider abstraction layer. This is the foundation everything else builds on.
