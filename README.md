# SeoFlow

[![CI](https://github.com/imsankz/seoflow/actions/workflows/ci.yml/badge.svg)](https://github.com/imsankz/seoflow/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/imsankz/seoflow?label=release)](https://github.com/imsankz/seoflow/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![NPM](https://img.shields.io/npm/v/%40imsankz%2Fseoflow?label=%40imsankz%2Fseoflow)](https://www.npmjs.com/package/%40imsankz%2Fseoflow)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-green.svg)](./package.json)

**Portable, AI-powered SEO pipeline for any content site.** Drop it into any project, point it at your posts, and get automated frontmatter fixes, internal link injection, image enrichment, AI content audits, fact-checking, and a self-learning priority system that gets smarter every run.

> Built for content teams who want programmatic SEO without vendor lock-in. Works with Next.js, Hugo, Jekyll, Astro, 11ty, WordPress, or any MDX/Markdown setup.

---

## Why SeoFlow?

- **Lives in your repo, not a SaaS dashboard.** No login, no per-seat pricing, no lock-in. Your content and your secrets stay on your machine.
- **20+ AI agents across every SEO discipline.** Technical, content, schema, local, GEO, drift, backlinks, programmatic, image-gen — installed into whichever AI coding tool you already use.
- **6 LLM providers with auto-fallback.** Gemini, OpenRouter, Anthropic, Claude CLI, Codex CLI, Gemini CLI. Set one key, it just works.
- **Self-learning priority system.** Records what actually moved the needle on GSC and re-ranks the next run so you always work on the highest-leverage post.
- **Graceful degradation.** No Ahrefs key? No NeuronWriter? No Pexels? SeoFlow silently skips that step and keeps going — it never crashes because a key is missing.
- **One-command URL audit.** `npx seoflow audit https://yoursite.com` — works with zero API keys and zero configuration.

---

## Quick Start

### Try it with zero setup (URL audit)

No config, no API keys, no clone — just audit any URL:

```bash
npx @imsankz/seoflow audit https://example.com
```

You'll get a health score, missing-meta signals, schema check, link structure, and an AI-written action plan saved to `.seoflow/reports/`.

### Full pipeline install (one-liner)

```bash
bash <(curl -s https://raw.githubusercontent.com/imsankz/seoflow/main/install.sh)
```

This auto-detects your AI coding tool (Kiro, Claude Code, Cursor, Copilot, Windsurf, OpenCode, Codex, Cline, Lingma, Zed) and copies the right agents to the right folder. Then:

```bash
npx seoflow init     # interactive: creates seoflow.config.json
npx seoflow status   # pipeline state + learning summary
npx seoflow audit    # run pipeline on top 10 priority posts
```

### Via npm (recommended)

```bash
npm install -D @imsankz/seoflow
npx seoflow init
```

`npx seoflow` resolves to the locally installed CLI. Prefer the full one-liner above if you also want the AI-coding-tool agents installed.

### From this repo (development)

```bash
git clone https://github.com/imsankz/seoflow.git .seoflow
cd .seoflow && npm install
npx tsx run.ts init
npx tsx run.ts audit --dry-run
```

Full walkthrough (config, GSC setup, first audit run): **[docs/getting-started.md](./docs/getting-started.md)**.

---

## Commands

| Command | Description |
|---------|-------------|
| `seoflow init` | Interactive setup — generates `seoflow.config.json` |
| `seoflow status` | Pipeline state, GSC coverage, learning summary |
| `seoflow audit` | Run pipeline on top 10 priority posts |
| `seoflow audit <slug>` | Run pipeline on one post |
| `seoflow audit https://<url>` | Live URL SEO audit — fetch page, compute scores, save to vault |
| `seoflow learn` | Show learning insights (step effectiveness, content patterns) |
| `seoflow learning export [file]` | Export `learning.json` + `gsc-baselines.json` |
| `seoflow learning import <file>` | Import a learning bundle (share across machines) |
| `seoflow generate` | Generate new posts from keywords |
| `seoflow publish` | Dry-run: preview unpublished posts |
| `seoflow publish --go` | Actually publish top candidates |
| `seoflow cluster <seed-keyword>` | Generate semantic topic cluster plan |
| `seoflow brief <keyword>` | Generate SEO content brief |
| `seoflow orchestrate <slug>` | Orchestrator-based pipeline with dependency resolution |
| `seoflow run <slug>` | Alias for orchestrate |
| `seoflow brain` | Brain summary + vault stats + suggested next actions |
| `seoflow vault` | Show vault summary directly |
| `seoflow extensions` | List supported optional extensions |
| `seoflow extensions install <id>` | Install an optional extension |
| `seoflow extensions status` | Show installed extension state |

### Global Flags

```bash
--dry-run           Preview changes without writing
--limit <n>         Max posts to process (default: 10)
--slug <slug>       Target one specific post
--reset-slug        Re-audit a previously completed post
--mode <step>       Run only one step: meta|links|images|keywords|neuron|content|review|factcheck|schema|technical|quality|report
```

---

## What It Does (12 Pipeline Steps)

```
seoflow audit
  │
  ├─► 0. Keywords  — Ahrefs/SEMrush (if key) or Ubersuggest MCP → focusKeyword + related terms
  ├─► 1. Meta      — Schema, description length, focusKeyword, lastModified
  ├─► 2. Links     — Inject internal links from your configured triggers
  ├─► 3. Images    — Pexels/Unsplash fetch per H2 section (1 per section, max 2)
  ├─► 4. Neuron    — NeuronWriter NLP: target word count, missing terms, People Also Ask
  ├─► 5. Content   — Gemini 2.5 Flash: FAQ, thin section expansion, NLP term weaving
  ├─► 6. Review    — Claude-style SEO review: score (1-10), quick wins, auto-fix title/meta
  ├─► 7. Schema    — Validate and generate Schema.org structured data
  ├─► 8. Quality   — Content quality audit (E-E-A-T signals, readability)
  ├─► 9. Technical — Technical SEO checks: broken links, redirect chains, canonical, hreflang, sitemap, robots, mobile
  ├─►10. FactCheck — Price/claim verification via Google Search grounding
  └─►11. Report    — Export audit report (computed health score, issues, quick wins)
```

Each step runs through the orchestrator with dependency resolution, brain vault logging, auto-fallback across 6 LLM providers, and integration degradation (graceful skip when APIs are unavailable).

---

## SEO Agents (20+ interactive agents)

After install, agents are available in your AI tool. Example commands:

```
/seo audit https://yoursite.com
/seo technical https://yoursite.com
/seo content https://yoursite.com/blog/post
/seo schema https://yoursite.com
/seo local https://yoursite.com
/seo geo https://yoursite.com
/seo cluster "best coffee in berlin"
/seo drift baseline https://yoursite.com
```

Engine setup stage: agent library covers technical, content, schema, sitemap, performance, visual, geo, local, maps, google, backlinks, dataforseo, image-gen, cluster, sxo, drift, ecommerce, flow. Detect-and-install is automatic — see `install.sh`.

---

## GSC Data (Live + CSV Fallback)

SeoFlow reads **live GSC data** via Google ADC, falls back to CSV exports in `gsc_data/`.

**One-time ADC setup:**
```bash
gcloud auth application-default login \
  --scopes=https://www.googleapis.com/auth/webmasters.readonly
```

- CSV auto-detects English (`Page, Clicks, Impressions...`) and German (`Häufigste Seiten, Klicks...`)
- Set `GSC_SITE_URL=sc-domain:yourdomain.com` in `.env.local` for domain properties
- Config: `gscDays` (default 28, auto-adds 3-day GSC lag)

---

## Content Format Support

| Value | Description |
|-------|-------------|
| `mdx` | YAML frontmatter + MDX body (Next.js, Astro) — **default** |
| `markdown` | YAML frontmatter + plain Markdown (Hugo, Jekyll, 11ty) |
| `wordpress` | Reserved for future REST API adapter |

Set in `seoflow.config.json`:
```json
{ "contentFormat": "markdown" }
```

---

## Voice & Domain — Make It Yours

### Single voice sample (all content types)
```json
{ "writingSample": "I've tested this for months. Here's what actually works: specific prices, real transit times, no fluff." }
```

### Per-type voice samples (recommended)
```json
{
  "writingSamples": {
    "guide": "Your destination guide voice...",
    "review": "Your review voice...",
    "itinerary": "Your itinerary voice...",
    "default": "Fallback voice..."
  }
}
```

### Domain context for AI prompts
```json
{
  "contentDomain": "food blog",
  "defaultCategory": "recipes",
  "imageSearchFallback": "food"
}
```

---

## AI Cost Guardrails

Prevent runaway costs on bulk runs:

```json
{
  "aiLimits": {
    "maxCallsPerRun": 50,
    "maxCallsPerPost": 3,
    "enabledSteps": ["keywords", "content", "review"]
  }
}
```

Pipeline prints an estimate:
```
AI budget: max 50 calls/run (~16 posts with AI, 3 calls each)
```

---

## Non-Travel Sites — Zero Code Changes

Just configure `seoflow.config.json`:

```json
{
  "publishPriority": [
    { "pattern": "review",  "score": 100 },
    { "pattern": "how-to",  "score": 80 },
    { "pattern": "guide",   "score": 60 }
  ],
  "imageSearchFallback": "tech",
  "defaultCategory": "engineering",
  "contentDomain": "developer blog",
  "contentTypes": {
    "tutorial": {
      "schema": "HowTo",
      "instructions": "Write a step-by-step tutorial with prerequisites, code samples, and troubleshooting."
    },
    "comparison": {
      "schema": "Article",
      "instructions": "Compare options in a table. Include pricing, pros/cons, and a verdict."
    }
  }
}
```

Built-in travel types (`guide`, `itinerary`, `things-to-do`, `city-pass-review`, `article`) are defaults — override or extend.

---

## Learning Data Portability

The self-learning system stores data locally in `.seoflow/data/`. Share across machines/team:

```bash
seoflow learning export team-learning.json   # export from machine A
seoflow learning import team-learning.json   # import on machine B
```

Files (`learning.json`, `gsc-baselines.json`) are gitignored by default. Use export/import to sync.

---

## Brain Vault

SeoFlow keeps a lightweight working memory across runs in `.seoflow/brain/`:

- `hot.md` — current pipeline state: last run, next actions, backlog
- `log.md` — append-only cross-session audit trail
- `wiki/audits/` — saved per-URL and per-post audit notes with evidence

```bash
seoflow brain   # show brain summary + vault stats + suggested next actions
seoflow vault   # show vault summary only
```

---

## Optional Extensions

```bash
seoflow extensions                # list available extensions
seoflow extensions install dataforseo   # install one
seoflow extensions status          # show what's installed
```

Available: ahrefs, bing-webmaster, dataforseo, firecrawl, profound, seranking, unlighthouse, banana (image-gen).

---

## Testing

```bash
npm test                 # All tests (unit + integration) — 50 tests
npm run test:unit        # Unit tests only (no file I/O)
npm run test:integration # Integration tests only
```

Covers:
- `mdx-parser.ts` — parse/build roundtrip, word/image/link counting, H2 extraction
- `gsc-parser.ts` — English/German CSV detection, CTR normalisation, `blogPrefix` stripping
- `learning.ts` — step recording, GSC delta tracking, predictive scoring
- `brain` — read/append/summary roundtrip
- `providers` — 6-provider registry, auth detection, fallback chain
- `orchestrator` — step registration, ID generation, phase coverage
- Integration — fixture MDX mutation safety, link injection idempotency

---

## Architecture — What Belongs Where

| In **SeoFlow** (this package) | In **Your Site** (site-specific) |
|-------------------------------|----------------------------------|
| GSC live data via ADC (or CSV fallback) | `seoflow.config.json` |
| MDX/Markdown frontmatter + body analysis | `.env.local` secrets |
| SEO priority scoring (GSC + learning) | Site-specific writing sample & author context |
| Internal link injection from triggers | Internal tool/link/booking triggers |
| Image enrichment (Pexels/Unsplash) | Content type defaults |
| AI content review & generation | Publishing branch, base URL, git identity |
| Fact-check & manual-review flags | |
| Audit logs, learning data, dry-run | |
| Optional publish workflow | |

**Repo layout:**

```
seoflow/
  run.ts                # Pipeline CLI entry point
  bin/cli.ts            # npm package CLI — forwards every verb to run.ts (published CLI stays in sync)
  agents/               # Canonical agent definitions (source of truth)
  skills/               # Canonical skill definitions (20+ SEO skills)
  extensions/           # Optional extension packages
  lib/
    config.ts           # Site config loader
    providers/          # 6 LLM providers with auto-fallback
    orchestrator/       # Dependency-aware step runner
    brain/              # Brain vault system (hot.md + log.md + vault notes)
    technical/          # PSI, CrUX, broken-links, canonical, hreflang, sitemap, robots
    content-quality/    # E-E-A-T + humanizer + claim verify
    drift/              # SEO drift monitoring
    backlinks/          # Backlink analysis
    reports/            # PDF/HTML/JSON report generation
    schema.ts           # 16 Schema.org types + validation
    url-auditor.ts      # Live URL SEO audit
    degradation.ts      # Graceful skip when APIs unavailable
    structured-output.ts# Typed JSON sidecars alongside markdown reports
  pipeline/
    steps.ts            # All pipeline steps + orchestrator runner registration
    technical.ts        # Technical audit step
    content-quality.ts  # Content quality audit step
    report-export.ts    # Report export step (computed health score)
  python/               # Python scripts (PSI, CrUX, GSC, reports, drift, images, geo...)
  hooks/                # PostToolUse hooks for local validation
  install.sh            # Smart installer (run once)
  update.sh             # Re-download + re-sync agents
```

---

## Requirements

- Node 18+
- `GEMINI_API_KEY` or `OPENROUTER_API_KEY` or `ANTHROPIC_API_KEY` (at least one for AI steps)
- Optional: `SEMRUSH_API_KEY` (keyword research — direct API calls via `phrase_this` + `phrase_related`)
- Optional: `AHREFS_API_KEY` (keyword research — direct API calls via v3 keywords-explorer)
- Optional: `NEURONWRITER_API_KEY`, `NEURONWRITER_PROJECT_ID`
- Optional: `PEXELS_API_KEY` or `UNSPLASH_API_KEY`
- Optional: Ubersuggest MCP (for keyword research)
- Optional: `AHREFS_COUNTRY` / `SEMRUSH_DATABASE` / `SEOFLOW_COUNTRY` — override default region (`us`)
Without any keys, SeoFlow still works — it skips AI/data steps gracefully and runs the URL auditor on raw signals.

---

## Contributing

PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md). Run tests before submitting:

```bash
npm test
```

Please read our [Code of Conduct](./CODE_OF_CONDUCT.md). Security issues: see [SECURITY.md](./SECURITY.md).

---

## License

[MIT](./LICENSE) — free for personal and commercial use.

---

## Star / Share

If SeoFlow helps you ship better SEO content, ⭐ the repo and share it:

> **SeoFlow** — the AI SEO pipeline that lives in your repo, not a SaaS dashboard. `npx seoflow init` → audit → learn → grow. Works with any stack. https://github.com/imsankz/seoflow

Built by [@imsankz](https://github.com/imsankz).