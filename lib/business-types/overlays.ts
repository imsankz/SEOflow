/**
 * SeoFlow — Business Type Strategy Overlays
 *
 * Each business type gets a strategy overlay that modifies:
 * - Content priorities and focus areas
 * - AI prompts for content generation/audit
 * - Metric tracking and measurement framework
 * - Analysis rules for the pipeline steps
 */
import type { BusinessType } from '../brain/types';

export interface BusinessTypeOverlay {
  id: BusinessType;
  name: string;
  description: string;
  /** The primary schema type to use */
  defaultSchema: string;
  /** Content priorities — what to focus on */
  contentPriorities: string[];
  /** Measurement framework */
  keyMetrics: string[];
  /** Which pipeline steps to prioritize */
  prioritySteps: string[];
  /** Site types this applies to */
  appliesTo: string[];
  /** Anti-patterns to warn about */
  antiPatterns: string[];
}

const OVERLAYS: Record<string, BusinessTypeOverlay> = {
  'travel': {
    id: 'travel',
    name: 'Travel Blog',
    description: 'Destination guides, itineraries, things-to-do, city pass reviews. First-person authority.',
    defaultSchema: 'TravelGuide',
    contentPriorities: [
      'First-person authentic voice with specific details',
      'Practical information (prices, transit, timing)',
      'Visual proof — real photos, not stock',
      'Itinerary templates and ready-to-use plans',
      'Seasonal updates for time-sensitive content',
    ],
    keyMetrics: [
      'Guide rankings (position 1-3 for destination keywords)',
      'Affiliate click-through rate',
      'Page views per guide',
      'Return visitor rate',
    ],
    prioritySteps: ['keywords', 'content', 'review', 'images', 'links'],
    appliesTo: ['travel blog', 'travel', 'destination guide', 'wanderlust'],
    antiPatterns: [
      'Generic descriptions without personal experience',
      'No specific prices or transit details',
      'Stock photos without original images',
      'Over-optimization that sacrifices authenticity',
      'AI-generated content without human fact-check',
    ],
  },
  'saas': {
    id: 'saas',
    name: 'SaaS / Software',
    description: 'Comparison pages, alternative pages, integration docs, feature pages. Trial conversion content.',
    defaultSchema: 'SoftwareApplication',
    contentPriorities: [
      'Comparison and alternative pages',
      'Feature-specific deep dives',
      'Integration documentation',
      'Use case and case study content',
      'Pricing and value messaging',
    ],
    keyMetrics: [
      'Trial signups from organic',
      'Feature page rankings',
      'Comparison page conversion rate',
      'Demo request volume',
    ],
    prioritySteps: ['technical', 'schema', 'content', 'review', 'keywords'],
    appliesTo: ['saas', 'software', 'developer tool', 'api', 'platform'],
    antiPatterns: [
      'Feature lists without buyer context',
      'Missing comparison content',
      'Over-reliance on generic schema',
      'Thin integration documentation',
      'No clear pricing or value prop in content',
    ],
  },
  'ecommerce': {
    id: 'ecommerce',
    name: 'E-Commerce',
    description: 'Product pages, category pages, shopping intent optimization.',
    defaultSchema: 'Product',
    contentPriorities: [
      'Product page depth and unique content',
      'Category page structure and internal linking',
      'Buying guides and comparison content',
      'Customer review integration',
      'Faceted navigation crawl optimization',
    ],
    keyMetrics: [
      'Organic revenue',
      'Product page rankings',
      'Category page CTR',
      'Product page conversion rate',
    ],
    prioritySteps: ['technical', 'schema', 'meta', 'review', 'report'],
    appliesTo: ['ecommerce', 'shop', 'store', 'retail', 'product'],
    antiPatterns: [
      'Duplicate product descriptions from manufacturer',
      'Thin category pages with no unique content',
      'Faceted navigation creating crawl traps',
      'Missing product schema',
      'Review content not optimized for rich results',
    ],
  },
  'affiliate': {
    id: 'affiliate',
    name: 'Affiliate Content',
    description: 'Product comparisons, best-of lists, buyer-intent content. Hands-on testing authority.',
    defaultSchema: 'Review',
    contentPriorities: [
      'Hands-on testing evidence and real photos',
      'Honest pros/cons and when to buy alternatives',
      'Regular price and recommendation updates',
      'Comparison tables with clear differentiators',
      'Dual-surface content (AI overview + organic click)',
    ],
    keyMetrics: [
      'Affiliate revenue per post',
      'Click-through rate to affiliate links',
      'Keyword rankings for buyer-intent queries',
      'Content freshness and update cadence',
    ],
    prioritySteps: ['keywords', 'content', 'review', 'factcheck', 'links'],
    appliesTo: ['affiliate', 'best of', 'review site', 'comparison', 'product review'],
    antiPatterns: [
      'No hands-on testing evidence',
      'Amazon boilerplate with no added value',
      'Outdated pricing and recommendations',
      'Over-aggressive affiliate links hurting UX',
      'Same affiliate content as every other site',
    ],
  },
  'lead-gen-b2b': {
    id: 'lead-gen-b2b',
    name: 'Lead Gen B2B',
    description: 'Service pages, case studies, thought leadership. Trust and authority building.',
    defaultSchema: 'Article',
    contentPriorities: [
      'Service page depth and specificity',
      'Case studies with real results',
      'Comparison content vs competitors',
      'Industry-specific thought leadership',
      'Trust signals and certifications',
    ],
    keyMetrics: [
      'Lead form fills',
      'Service page rankings',
      'Demo request conversion',
      'Case study engagement',
    ],
    prioritySteps: ['content', 'schema', 'technical', 'review', 'report'],
    appliesTo: ['agency', 'consulting', 'b2b', 'professional services', 'freelance'],
    antiPatterns: [
      'Generic service descriptions',
      'No case studies or proof of work',
      'Missing CTA or unclear next step',
      'No differentiation from competitors',
      'Pricing hidden or unclear',
    ],
  },
  'publisher-news': {
    id: 'publisher-news',
    name: 'Publisher / News',
    description: 'Content velocity, topical authority, E-E-A-T, news indexing.',
    defaultSchema: 'NewsArticle',
    contentPriorities: [
      'Content freshness and update velocity',
      'Topical authority through clusters',
      'Author E-E-A-T signals',
      'News indexing speed',
      'Reader engagement and retention',
    ],
    keyMetrics: [
      'Page views',
      'Ad RPM',
      'Indexation rate',
      'Return visitor rate',
    ],
    prioritySteps: ['technical', 'content', 'schema', 'factcheck', 'links'],
    appliesTo: ['publisher', 'news', 'magazine', 'media', 'journalism'],
    antiPatterns: [
      'Thin content for ad impressions',
      'No author bylines or credentials',
      'Missing news article schema',
      'Slow indexation of breaking content',
      'Poor internal linking between related stories',
    ],
  },
  'local-seo-services': {
    id: 'local-seo-services',
    name: 'Local SEO Services',
    description: 'GBP optimization, local packs, service-area pages, review management.',
    defaultSchema: 'LocalBusiness',
    contentPriorities: [
      'GBP listing optimization',
      'Local service-area pages',
      'City-specific landing pages',
      'Review generation and management',
      'Local citation consistency',
    ],
    keyMetrics: [
      'GBP insights (views, clicks, direction requests)',
      'Local pack rankings',
      'Phone call volume',
      'Review count and rating',
    ],
    prioritySteps: ['schema', 'technical', 'content', 'review', 'report'],
    appliesTo: ['local business', 'service area', 'plumber', 'contractor', 'restaurant'],
    antiPatterns: [
      'NAP inconsistency across listings',
      'GBP listing not claimed or verified',
      'No local schema markup',
      'Keyword-stuffed city pages with no value',
      'Ignoring negative reviews',
    ],
  },
  'blog': {
    id: 'blog',
    name: 'Blog / Content Site',
    description: 'Informational content, topical clusters, reader engagement.',
    defaultSchema: 'Article',
    contentPriorities: [
      'Topical authority through content clusters',
      'Information gain vs top-ranking results',
      'Reader engagement metrics',
      'Email list building',
      'Evergreen content updates',
    ],
    keyMetrics: [
      'Organic traffic',
      'Keyword rankings',
      'Time on page',
      'Email signups',
    ],
    prioritySteps: ['keywords', 'content', 'links', 'technical', 'review'],
    appliesTo: ['blog', 'content site', 'personal blog', 'niche site'],
    antiPatterns: [
      'Mass-produced AI content with no unique value',
      'No author identity or E-E-A-T',
      'Keyword stuffing for ranking attempts',
      'No internal linking strategy',
      'No clear monetization path',
    ],
  },
  'other': {
    id: 'other',
    name: 'General / Other',
    description: 'General SEO strategy with customizable priorities.',
    defaultSchema: 'Article',
    contentPriorities: [
      'Content quality improvement',
      'Technical SEO basics',
      'Keyword research and targeting',
      'Internal linking',
      'Performance optimization',
    ],
    keyMetrics: [
      'Organic traffic',
      'Keyword rankings',
      'Bounce rate',
      'Conversions',
    ],
    prioritySteps: ['meta', 'technical', 'content', 'links', 'review'],
    appliesTo: ['other', 'general', 'misc'],
    antiPatterns: [
      'No clear business goal for SEO',
      'Missing analytics setup',
      'No baseline measurement before optimization',
    ],
  },
};

export function getOverlay(businessType: BusinessType): BusinessTypeOverlay {
  return OVERLAYS[businessType] || OVERLAYS.other;
}

export function getAllOverlays(): BusinessTypeOverlay[] {
  return Object.values(OVERLAYS);
}

/** Suggest a business type based on site content domain */
export function suggestBusinessType(contentDomain: string): BusinessType {
  const lower = contentDomain.toLowerCase();
  for (const [type, overlay] of Object.entries(OVERLAYS)) {
    if (overlay.appliesTo.some(a => lower.includes(a))) {
      return type as BusinessType;
    }
  }
  return 'other';
}
