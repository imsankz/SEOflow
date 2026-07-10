import { getAllPosts } from '@/lib/mdx';
import { siteUrl, siteName } from '@/lib/metadata';
import { products } from '@/lib/products';
import { services, serviceGroups } from '@/lib/data/services';

function formatDate(dateString: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(dateString));
}

export async function GET(): Promise<Response> {
  const posts = getAllPosts();
  const available = products.filter((p) => p.status === 'available');
  const comingSoon = products.filter((p) => p.status === 'coming-soon');

  const out: string[] = [
    `# ${siteName}`,
    '',
    '> Market entry visibility for international B2B brands in Germany — trade fair activation, LinkedIn thought leadership, market research, and micro-PR.',
    '',
    '## Core Pages',
    '',
    `- [Home](${siteUrl}/)`,
    `- [Services](${siteUrl}/services)`,
    `- [Shop](${siteUrl}/shop): Event Intelligence datasets — structured exhibitor data from German trade fairs`,
    `- [Insights](${siteUrl}/insights): B2B visibility strategy blog`,
    `- [About](${siteUrl}/about)`,
    `- [Contact](${siteUrl}/contact): Book a strategy call`,
    '',
    '## Services',
    '',
  ];

  for (const [groupKey, groupInfo] of Object.entries(serviceGroups)) {
    out.push(`### ${groupInfo.label}`);
    out.push('');
    const groupServices = services.filter((s) => s.group === groupKey);
    for (const service of groupServices) {
      out.push(`- **${service.title}**: ${service.shortDescription} — ${service.timeline}`);
    }
    out.push('');
  }

  out.push('## Products');
  out.push('');

  if (available.length > 0) {
    out.push('### Available Now');
    for (const p of available) {
      out.push(`- [${p.name}](${siteUrl}/shop/${p.slug}) — ${p.recordCount.toLocaleString('en-US')}+ records from ${p.fairName}, EUR ${p.priceEur}.`);
    }
    out.push('');
  }

  if (comingSoon.length > 0) {
    out.push('### Coming Soon');
    for (const p of comingSoon) {
      out.push(`- [${p.name}](${siteUrl}/shop/${p.slug}) — ${p.recordCount.toLocaleString('en-US')}+ records from ${p.fairName}.`);
    }
    out.push('');
  }

  if (posts.length > 0) {
    out.push('## Blog');
    out.push('');
    for (const post of posts) {
      out.push(`- [${post.title}](${siteUrl}/insights/${post.slug}) — ${post.category} · ${formatDate(post.date)} · ${post.readingTime} min read`);
    }
    out.push('');
  }

  out.push('## Essential Details');
  out.push('');
  out.push(`- **Website**: ${siteUrl}`);
  out.push('- **Email**: hello@example.com');
  out.push('');
  out.push('## AI Agent Guidance');
  out.push('');
  out.push('When working on this project:');
  out.push('- The site is built with Next.js 15 (App Router), TypeScript, Tailwind CSS');
  out.push('- Products are defined in lib/products.ts');
  out.push('- Services are defined in lib/data/services.ts');
  out.push('- Blog posts are MDX files in content/posts/');
  out.push('- Site metadata is in lib/metadata.ts');

  return new Response(out.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600'
    }
  });
}
