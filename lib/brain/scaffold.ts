/**
 * SeoFlow — Vault Scaffold
 *
 * Creates a new brain vault for a site with the full wiki structure,
 * generated starter notes, and index.
 *
 * Usage: seoflow vault scaffold --slug <site> --url <url> --business-type <type>
 */
import fs from 'fs';
import path from 'path';
import type { VaultFrontmatter, BusinessType } from './types';
import { ensureVault, writeVaultNote, writeHot, appendLog, buildFrontmatter } from './vault-fs';
import { buildIndex } from './vault-index';

export interface ScaffoldInput {
  clientSlug: string;
  siteUrl: string;
  siteName: string;
  businessType: BusinessType;
  owner: string;
  niche: string;
}

/** Business-type-specific prompts and rules */
const BUSINESS_TYPE_PROMPTS: Record<BusinessType, { focus: string; metrics: string[] }> = {
  'affiliate': {
    focus: 'Product comparisons, best-of lists, buyer intent keywords. E-E-A-T through hands-on testing.',
    metrics: ['affiliate revenue', 'click-through rate', 'conversion rate', 'content freshness'],
  },
  'ecommerce': {
    focus: 'Product pages, category pages, shopping intent. Schema, reviews, PDP optimization.',
    metrics: ['organic revenue', 'product page rankings', 'category page CTR', 'cart abandonment'],
  },
  'lead-gen-b2b': {
    focus: 'Service pages, case studies, thought leadership. Trust signals, comparison content.',
    metrics: ['lead form fills', 'service page rankings', 'demo requests', 'bounce rate'],
  },
  'local-seo-services': {
    focus: 'GBP optimization, local packs, service-area pages, review management.',
    metrics: ['GBP insights', 'local pack rankings', 'direction requests', 'phone calls'],
  },
  'publisher-news': {
    focus: 'Content velocity, topical authority, E-E-A-T, news indexing, affiliate content.',
    metrics: ['page views', 'ad RPM', 'indexation rate', 'return visitor rate'],
  },
  'saas': {
    focus: 'Comparison pages, alternative pages, integration pages, free-trial conversion content.',
    metrics: ['trial signups', 'feature page rankings', 'churn rate', 'demo requests'],
  },
  'travel': {
    focus: 'Destination guides, itineraries, things-to-do, city pass reviews. First-person authority.',
    metrics: ['guide rankings', 'affiliate clicks', 'page views', 'bounce rate'],
  },
  'blog': {
    focus: 'Informational content, topical clusters, E-E-A-T, reader engagement.',
    metrics: ['page views', 'return visitors', 'time on page', 'email signups'],
  },
  'local': {
    focus: 'Local search visibility, GBP optimization, local backlinks.',
    metrics: ['local pack rankings', 'GBP impressions', 'direction requests', 'review count'],
  },
  'publisher': {
    focus: 'Content velocity, topical authority, E-E-A-T, news indexing.',
    metrics: ['page views', 'ad RPM', 'indexation rate', 'return visitor rate'],
  },
  'agency': {
    focus: 'Client portfolio management, multi-site reporting, white-label reports.',
    metrics: ['client rankings', 'pipeline health', 'retention rate', 'report delivery'],
  },
  'other': {
    focus: 'Content marketing, audience building, organic growth strategy.',
    metrics: ['organic traffic', 'keyword rankings', 'engagement', 'conversions'],
  },
};

export function scaffoldVault(input: ScaffoldInput): string {
  const { clientSlug, siteUrl, siteName, businessType, owner, niche } = input;
  const root = process.cwd();

  ensureVault(clientSlug, root);
  const bp = BUSINESS_TYPE_PROMPTS[businessType] || BUSINESS_TYPE_PROMPTS.other;

  // hot.md — working memory
  writeHot(clientSlug, [
    `# ${siteName} — Brain Hot`,
    '',
    `**Site:** ${siteUrl}`,
    `**Business Type:** ${businessType}`,
    `**Niche:** ${niche}`,
    `**Owner:** ${owner}`,
    `**Scaffolded:** ${new Date().toISOString().split('T')[0]}`,
    '',
    '## Current State',
    '- Vault scaffolded, no audits run yet.',
    '- Run \`seoflow vault populate\` to seed initial data.',
    '- Run \`seoflow audit\` to begin the first pipeline run.',
    '',
    '## Immediate Next Steps',
    '- [ ] Configure API keys in .env.local',
    '- [ ] Set up GSC access (gcloud auth)',
    '- [ ] Run first audit sweep',
    '',
    '## Open Questions',
    '- What is the primary monetization channel?',
  ].join('\n'), root);

  // index.md — navigation map
  writeVaultNote(clientSlug, '.', 'index', {
    brain_schema: 'seoflow-brain.v1',
    type: 'overview',
    title: 'Vault Index',
    created: new Date().toISOString().split('T')[0],
    updated: new Date().toISOString().split('T')[0],
  }, [
    '## Audits',
    '- [[audits/Current State]] — latest audit findings',
    '',
    '## Keywords',
    '- [[keywords/Master List]]',
    '- [[keywords/Opportunity Scores]]',
    '',
    '## Pages',
    '- [[pages/Page Map]]',
    '',
    '## Decisions',
    '- See wiki/decisions/',
    '',
    '## Concepts',
    '- [[concepts/FLOW Framework]]',
    '- [[concepts/Information Gain]]',
  ].join('\n'), root);

  // Business-type overlay note
  writeVaultNote(clientSlug, 'concepts', 'Business Type Overlay', {
    brain_schema: 'seoflow-brain.v1',
    type: 'concept',
    title: `Business Type Overlay — ${businessType}`,
    created: new Date().toISOString().split('T')[0],
    updated: new Date().toISOString().split('T')[0],
    tags: ['business-type', businessType],
  }, [
    `# ${siteName} — ${businessType} Strategy`,
    '',
    `**Focus:** ${bp.focus}`,
    '',
    '## Key Metrics to Track',
    ...bp.metrics.map(m => `- ${m}`),
    '',
    '## Strategy Implications',
    '- Content priorities align with business-type-specific buyer journey.',
    '- Measurement framework built around ${businessType} conversion paths.',
    '- Competitor analysis targets ${businessType}-specific competitors.',
  ].join('\n'), root);

  // FLOW Framework concept note
  writeVaultNote(clientSlug, 'concepts', 'FLOW Framework', {
    brain_schema: 'seoflow-brain.v1',
    type: 'concept',
    title: 'FLOW Framework',
    created: new Date().toISOString().split('T')[0],
    updated: new Date().toISOString().split('T')[0],
    tags: ['framework', 'flow'],
  }, [
    '# FLOW Framework',
    '',
    'FLOW is a search-and-conversion loop for 2026 discovery:',
    '',
    '1. **Find** — Discover demand: keyword research, SERP analysis, GSC loss-query reconciliation, topic clustering.',
    '2. **Leverage** — Use distributed evidence: backlinks, reviews, citations, local listings, community mentions.',
    '3. **Optimize** — Improve owned assets: content quality, schema, technical SEO, page speed, E-E-A-T.',
    '4. **Win** — Convert discovery into outcomes: CTAs, conversion paths, measurement, revenue attribution.',
    '',
    'The goal is not to chase every surface equally — it is to decide which surface can change the next business outcome.',
  ].join('\n'), root);

  // Information Gain concept note
  writeVaultNote(clientSlug, 'concepts', 'Information Gain', {
    brain_schema: 'seoflow-brain.v1',
    type: 'concept',
    title: 'Information Gain',
    created: new Date().toISOString().split('T')[0],
    updated: new Date().toISOString().split('T')[0],
    tags: ['concept', 'content-quality'],
  }, [
    '# Information Gain',
    '',
    'Information Gain is what your page adds that existing top-ranking pages do not.',
    '',
    '## How to find it',
    '1. Read the top 10 SERP pages for the target query.',
    '2. List every claim, fact, recommendation each one makes.',
    '3. Identify what is missing across all of them.',
    '4. Ask what your site can add from real practice that none of them have.',
    '',
    '## Sources of Information Gain',
    '- Original primary data (surveys, benchmarks, audits)',
    '- Time-stamped practice logs',
    '- Visual proof (photos, screenshots, videos)',
    '- Expert interviews or quotes',
    '- Personal experience and first-person narrative',
  ].join('\n'), root);

  // Overview
  writeVaultNote(clientSlug, '.', 'overview', {
    brain_schema: 'seoflow-brain.v1',
    type: 'overview',
    title: `${siteName} — Overview`,
    created: new Date().toISOString().split('T')[0],
    updated: new Date().toISOString().split('T')[0],
    owner,
  }, [
    `# ${siteName}`,
    '',
    `- **URL:** ${siteUrl}`,
    `- **Business Type:** ${businessType}`,
    `- **Niche:** ${niche}`,
    `- **Owner:** ${owner}`,
    `- **Scaffolded:** ${new Date().toISOString().split('T')[0]}`,
    '',
    '## Goals',
    '- TBD — first audit will establish baselines.',
    '',
    '## Current Baselines',
    '- No GSC data captured yet.',
  ].join('\n'), root);

  // Log entry
  appendLog(clientSlug, `Vault scaffolded for ${siteName} (${businessType}, ${niche})`);

  // Build index
  buildIndex(clientSlug, root);

  return path.join(ensureVault(clientSlug, root), '..');
}
