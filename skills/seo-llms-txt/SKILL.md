---
name: seo-llms-txt
description: >
  Generate dynamic /llms.txt and /llms-full.txt route handlers for Next.js sites.
  Scans project data sources (products, services, blog posts, metadata) and
  creates server-rendered text routes that auto-update when content changes.
  Use when user says "llms.txt", "LLMs.txt", "AI visibility file",
  "generate llms.txt", "AI discovery file", or "llms-full.txt".
user-invocable: true
argument-hint: "[generate|validate] [path]"
license: MIT
metadata:
  author: Impact by Eri
  version: "1.0.0"
  category: seo
---

# LLMs.txt Generator — AI Visibility for Next.js Sites

## Overview

The [llms.txt standard](https://llmstxt.org/) provides AI agents with structured guidance about your site. Rather than a static file that goes stale, this skill generates **dynamic route handlers** that pull from your actual data sources (products, services, blog posts) so the AI-facing file always reflects your current content.

## How It Works

The generator creates two Next.js App Router route handlers:

| Route | Purpose | Detail Level |
|-------|---------|-------------|
| `/llms.txt` | AI Agent Quick Reference | Concise — services, products, pages, contact |
| `/llms-full.txt` | Full AI Context | Comprehensive — architecture, schema, database, working instructions |

Both are plain-text GET responses generated at request time from the same data sources your site already uses.

## Usage

### Quick Start

```
/seo llms-txt generate
```

This will:
1. Scan your project for data sources (auto-detects Next.js App Router)
2. Generate `app/llms.txt/route.ts` and `app/llms-full.txt/route.ts`
3. Verify the routes compile (runs typecheck)

### Validate Existing

```
/seo llms-txt validate
```

Checks if the routes exist, are valid, and reflect current data.

## Data Source Detection

The generator auto-discovers these sources:

| Source | Purpose | How Detected |
|--------|---------|-------------|
| `lib/metadata.ts` | Site name, URL, owner | Grep for `export const siteUrl` |
| `lib/products.ts` | Product/shop listings | Grep for `export const products` or `export type Product` |
| `lib/data/services.ts` | Service definitions | Grep for `export const services` or `export interface Service` |
| `lib/mdx.ts` | Blog post fetching | Grep for `getAllPosts` or `getPostBySlug` |
| `content/posts/` | MDX blog files | Glob for `*.mdx` |
| `app/sitemap.ts` | Route discovery fallback | Check if sitemap exports exist |

### Fallback Behavior

If no matching data sources are found, the generator:
- Extracts site name from `package.json` or `app/layout.tsx` metadata
- Discovers routes from the sitemap or filesystem
- Creates a minimal but useful llms.txt with what's available

## Generated Route Structure

### Minimal Route (`app/llms.txt/route.ts`)

```typescript
import { getAllPosts } from '@/lib/mdx';
import { siteUrl, siteName } from '@/lib/metadata';
import { products } from '@/lib/products';
import { services, serviceGroups } from '@/lib/data/services';

export async function GET(): Promise<Response> {
  const lines: string[] = [
    `# ${siteName}`,
    '',
    '> Description of your site...',
    '',
    '## Core Pages',
    `- [Home](${siteUrl}/)`,
    '...'
  ];

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600'
    }
  });
}
```

### Full Route (`app/llms-full.txt/route.ts`)

Extended version with:
- **Business Overview** — value proposition, methodology
- **Full Service Details** — each service with deliverables, timeline, ideal-for
- **Product Tables** — available + coming-soon in markdown tables
- **Blog Index** — all posts with dates, categories, reading times
- **Technical Architecture** — stack, environment variables, directory tree
- **SEO & Structured Data** — schema types per page, metadata system
- **Database Schema** — table definitions
- **AI Agent Guidance** — how to work on the project

## Format Specification

The generated files follow the llms.txt standard:

```
# Site Name
> Short description

## Section
- [Link](url): Description

## Data Tables
| Col A | Col B |
|-------|-------|
| Value | Value |
```

Rules:
- Single `# H1` per file
- `## H2` for major sections, `### H3` for subsections
- `[text](url)` markdown links
- Pipe tables for structured data
- Backtick code blocks for technical content
- Content-Type: `text/plain; charset=utf-8`

## Validation

After generation, the skill verifies:

1. **TypeScript** — `npm run typecheck` (or `npx tsc --noEmit`)
2. **Lint** — `npm run lint` (no errors, warnings ok)
3. **Route accessibility** — File exists at correct path for framework
4. **Content correctness** — Spot-check that products match `lib/products.ts`, posts match MDX files

## Integration with SeoFlow

This skill complements the existing `seo-geo` agent (which audits llms.txt presence) by providing the **generation** side — instead of just reporting that an llms.txt is missing, it creates one.

After generating, you can run:
- `/seo geo <url>` — audits the generated llms.txt for GEO compliance
- `/seo audit <url>` — full site audit including AI search readiness

## Error Handling

| Scenario | Action |
|----------|--------|
| Not a Next.js project | Guide user through creating a manual llms.txt (static file in `public/` or root) |
| App Router not detected | Fall back to Pages Router API route at `pages/api/llms-txt.js` |
| No data sources | Use package.json name + sitemap routes for minimal output |
| Route already exists | Check if existing route is static or dynamic; offer to upgrade to dynamic if static |
| Typecheck fails | Report the specific error; do not commit broken routes |

## Example Output

For a consulting/shop hybrid site like Impact by Eri, the generated `/llms.txt` includes:
- Business name and tagline
- 6 core page links
- 2 service packages with 6 total services
- Products split by availability (available vs coming-soon)
- Blog posts with categories and dates
- Contact info, location, pricing range
- AI agent guidance for working on the codebase

The `/llms-full.txt` expands to include full product tables (12+ products with record counts, prices, sectors), technical stack (Next.js 15, Supabase, Stripe, etc.), directory structure, and database schema.
