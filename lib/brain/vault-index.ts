/**
 * SeoFlow — Vault Index
 *
 * Lightweight JSON index for fast vault lookups without SQLite.
 * Rebuilt on vault scaffold and on-demand (seoflow vault index).
 */
import fs from 'fs';
import path from 'path';
import type { VaultIndex, VaultNoteMeta, VaultFrontmatter } from './types';
import { vaultDir, wikiDir, parseVaultNote, ensureVault } from './vault-fs';

const INDEX_FILE = 'vault-index.json';

function indexPath(clientSlug: string, rootDir?: string): string {
  return path.join(vaultDir(clientSlug, rootDir), INDEX_FILE);
}

/** Build index from scratch by scanning all wiki .md files */
export function buildIndex(clientSlug: string, rootDir?: string): VaultIndex {
  const wd = ensureVault(clientSlug, rootDir);
  const notes: Record<string, VaultNoteMeta> = {};

  function walk(dir: string) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.md') && entry.name !== 'hot.md') {
        const note = parseVaultNote(full);
        if (!note) continue;
        const slug = path.relative(wd, full).replace(/\.md$/, '');
        const bodyText = note.body || '';
        notes[slug] = {
          title: note.frontmatter.title || entry.name.replace('.md', ''),
          type: note.frontmatter.type || 'finding',
          created: note.frontmatter.created || '',
          updated: note.frontmatter.updated || '',
          confidence: note.frontmatter.confidence || 'seed',
          approval_status: note.frontmatter.approval_status || 'needs-review',
          tags: note.frontmatter.tags || [],
          relPath: path.relative(wd, full),
          summary: bodyText.slice(0, 200).replace(/\n/g, ' ').trim(),
        };
      }
    }
  }

  walk(wd);

  const index: VaultIndex = {
    notes,
    lastIndexed: new Date().toISOString(),
    clientSlug,
    schema: 'seoflow-brain.v1',
  };

  saveIndex(clientSlug, index, rootDir);
  return index;
}

/** Load existing index, rebuild if missing */
export function loadIndex(clientSlug: string, rootDir?: string): VaultIndex {
  const ip = indexPath(clientSlug, rootDir);
  if (fs.existsSync(ip)) {
    try {
      const raw = JSON.parse(fs.readFileSync(ip, 'utf8'));
      if (raw.schema === 'seoflow-brain.v1' && raw.clientSlug === clientSlug) {
        return raw as VaultIndex;
      }
    } catch { /* corrupt index — rebuild */ }
  }
  return buildIndex(clientSlug, rootDir);
}

/** Save index to disk */
export function saveIndex(clientSlug: string, index: VaultIndex, rootDir?: string): void {
  const vd = vaultDir(clientSlug, rootDir);
  if (!fs.existsSync(vd)) fs.mkdirSync(vd, { recursive: true });
  fs.writeFileSync(indexPath(clientSlug, rootDir), JSON.stringify(index, null, 2), 'utf8');
}

/** Query index by type */
export function findByType(clientSlug: string, type: string, rootDir?: string): VaultNoteMeta[] {
  const index = loadIndex(clientSlug, rootDir);
  return Object.values(index.notes).filter(n => n.type === type);
}

/** Query index by tag */
export function findByTag(clientSlug: string, tag: string, rootDir?: string): VaultNoteMeta[] {
  const index = loadIndex(clientSlug, rootDir);
  return Object.values(index.notes).filter(n => (n.tags || []).includes(tag));
}

/** Full-text simple search over note titles and summaries */
export function searchVault(clientSlug: string, query: string, rootDir?: string): VaultNoteMeta[] {
  const index = loadIndex(clientSlug, rootDir);
  const lower = query.toLowerCase();
  return Object.values(index.notes).filter(n =>
    n.title.toLowerCase().includes(lower) ||
    (n.summary && n.summary.toLowerCase().includes(lower)) ||
    (n.tags || []).some(t => t.toLowerCase().includes(lower)),
  );
}
