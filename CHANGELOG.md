# Changelog

All notable changes to SeoFlow will be documented in this file.

## [0.1.0] — 2026-07-05 (open-source launch)

### Added
- **Initial public release of SeoFlow** — AI-powered SEO pipeline for content sites
- 12-step pipeline: keywords, meta, links, images, neuron, content, review, schema, quality, technical, fact-check, report
- Supports MDX, Markdown, and WordPress content formats
- Self-learning priority system with GSC delta tracking
- GSC live data via Google ADC + CSV fallback (English + German)
- Internal link injection from configurable triggers
- Image enrichment via Pexels/Unsplash
- AI content audit and generation with cost guardrails
- Fact-checking via Google Search grounding
- Claude Code plugin metadata + postToolUse hooks for local validation
- **Multi-provider support** — 6 LLM backends (Gemini, OpenRouter, Anthropic, Claude CLI, Codex CLI, Gemini CLI) with automatic fallback chain
- **Brain vault system** — `hot.md` + `log.md` working memory with cross-session audit trail and `wiki/audits/` notes with evidence ledger
- **Orchestrator** — dependency-aware step runner with assignment tracking (proposed → queued → running → succeeded/failed/skipped)
- **Integration degradation** — graceful skip when API keys are missing instead of crashing; no step ever crashes due to a missing key
- **Structured output** — typed JSON data sidecars (`*.data.json`) alongside markdown reports
- **URL auditor** — `seoflow audit https://...` with computed health scores even without AI keys
- **20+ SEO agents** (technical, content, schema, sitemap, performance, visual, geo, local, maps, google, backlinks, dataforseo, image-gen, cluster, sxo, drift, ecommerce, flow) auto-installed to Kiro, Claude Code, Cursor, Copilot, Windsurf, OpenCode, Codex, Cline, Lingma, Zed
- **Optional extensions** (ahrefs, bing-webmaster, dataforseo, firecrawl, profound, seranking, unlighthouse, banana) installable via `seoflow extensions install <id>`
- **AI cost guardrails** — `aiLimits.maxCallsPerRun` / `maxCallsPerPost` / `enabledSteps` with run-time budget estimate
- **Per content-type voice samples** — `writingSamples.{guide,review,itinerary,default}` for content-type-aware AI prompts
- **Semantic topic clustering** — `seoflow cluster <seed>` generates a full cluster plan (JSON + markdown)
- **SEO content briefs** — `seoflow brief <keyword>` generates a structured content brief
- **Learning data portability** — `seoflow learning export/import` to share `learning.json` + `gsc-baselines.json` across machines/team
- **Computed health score** in report-export (title + description + word count + internal links + images + schema, minus issue/warning deductions)

### Project & Community
- MIT license
- CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md
- Issue templates (bug, feature) and pull request template
- GitHub Actions CI (Node 20, build + test on push/PR to main)
- `.env.example` with all variables and guidance — no redacted/leaked values
- README badges (CI, MIT, npm, Node); tested with `npm test` (50 tests passing)

### Fixed
- Provider CLI availability checks handle ENOENT gracefully
- Content truncation in render_page.py — switched to fetch_page.py for full HTML
- Missing vault types in brain schema
- `pipeline/technical.ts` — complete import set (all 7 broken-link/technical checks reachable)
- `pipeline/report-export.ts` — `computeScore()` replaces previously-hardcoded `score: 85`
- Doc/CLI script-name consistency — added `seoflow:init`, `seoflow:audit`, `seoflow:orchestrate`, `seoflow:brain`, `seoflow:vault` to package.json so `npm run seoflow:*` matches docs

### Changed
- `ai-provider.ts` delegates to `lib/providers/` abstraction (6 providers)
- `.gitignore` now also excludes `.mcp.json`, `opencode.json`, `*.bak` (per-machine MCP config)

### Removed (cleanup for open-source release)
- Empty stub `lib/surfer-client.ts`
- Superseded `lib/claude-client.ts`, `lib/gemini-client.ts`, `lib/openrouter-client.ts` (replaced by `lib/providers/`)
- Unused `lib/cli/cli.ts` (separate commander-based CLI never wired up)
- Unused `lib/flow/framework.ts`, `lib/business-types/overlays.ts`
- Duplicate `scripts/` directory (51 files — exact copy of `python/`)