/**
 * SeoFlow — Brain Vault File Operations
 *
 * Reads and writes vault notes as structured markdown files with YAML frontmatter.
 * Notes live in <project_root>/.seoflow/brain/<client-slug>/wiki/
 */
import fs from 'fs';
import path from 'path';
import type { VaultNote, VaultFrontmatter, VaultNoteType } from './types';

const BRAIN_ROOT = '.seoflow';

/** Resolve the vault directory for a client slug */
export function vaultDir(clientSlug: string, rootDir?: string): string {
  const base = rootDir || process.cwd();
  return path.join(base, BRAIN_ROOT, 'brain', clientSlug);
}

/** Resolve the wiki directory */
export function wikiDir(clientSlug: string, rootDir?: string): string {
  return path.join(vaultDir(clientSlug, rootDir), 'wiki');
}

/** Ensure the vault directory tree exists */
export function ensureVault(clientSlug: string, rootDir?: string): string {
  const wd = wikiDir(clientSlug, rootDir);
  const dirs = [
    wd,
    path.join(wd, 'audits'),
    path.join(wd, 'findings'),
    path.join(wd, 'decisions'),
    path.join(wd, 'keywords'),
    path.join(wd, 'pages'),
    path.join(wd, 'entities'),
    path.join(wd, 'competitors'),
    path.join(wd, 'flows'),
    path.join(wd, 'concepts'),
    path.join(wd, 'deliverables'),
    path.join(wd, 'questions'),
    path.join(wd, 'sources'),
    path.join(vaultDir(clientSlug, rootDir), 'attachments'),
    path.join(vaultDir(clientSlug, rootDir), 'templates'),
  ];
  for (const d of dirs) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
  return wd;
}

/** Parse a vault markdown file into structured note */
export function parseVaultNote(filePath: string): VaultNote | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');

  const fmEnd = raw.indexOf('\n---', raw.startsWith('---') ? 3 : 0);
  if (fmEnd === -1 || !raw.startsWith('---')) {
    // No frontmatter — treat as body-only note
    return {
      frontmatter: {
        brain_schema: 'seoflow-brain.v1',
        type: 'finding',
        title: path.basename(filePath, '.md'),
        created: new Date().toISOString().split('T')[0],
        updated: new Date().toISOString().split('T')[0],
      },
      body: raw,
      filePath,
      relPath: path.relative(path.dirname(filePath), filePath),
    };
  }

  const fmRaw = raw.slice(3, fmEnd);
  const body = raw.slice(fmEnd + 4).trim();
  const fm: VaultFrontmatter = parseFrontmatter(fmRaw);

  return {
    frontmatter: fm,
    body: body || '',
    filePath,
    relPath: path.relative(path.dirname(filePath), filePath),
  };
}

/** Parse YAML frontmatter string into object (simple parser, no deps) */
function parseFrontmatter(yaml: string): VaultFrontmatter {
  const fm: Record<string, any> = {
    brain_schema: 'seoflow-brain.v1',
    type: 'finding',
    title: '',
    created: new Date().toISOString().split('T')[0],
    updated: new Date().toISOString().split('T')[0],
  };

  let currentKey: string | null = null;
  let listAccum: string[] = [];
  let inList = false;

  for (const line of yaml.split('\n')) {
    const trimmed = line.replace(/^\s+/, '');
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Top-level key
    const keyMatch = trimmed.match(/^(\w[\w_-]*?):\s*(.*?)$/);
    if (keyMatch && !trimmed.startsWith(' ')) {
      // Flush previous list
      if (currentKey && inList) {
        fm[currentKey] = listAccum;
        listAccum = [];
        inList = false;
      }
      currentKey = keyMatch[1];
      const val = keyMatch[2].trim();
      if (val === '' || val === '|') {
        // List follows
        inList = true;
        listAccum = [];
      } else {
        fm[currentKey] = parseScalar(val);
        currentKey = null;
      }
    } else if (inList && trimmed.startsWith('- ')) {
      listAccum.push(trimmed.slice(2).trim());
    } else if (inList && trimmed.startsWith('  - ')) {
      // Nested list items (sources, related)
      listAccum.push(trimmed.slice(4).trim());
    }
  }

  // Flush final list
  if (currentKey && inList) {
    fm[currentKey] = listAccum;
  }

  return fm as unknown as VaultFrontmatter;
}

function parseScalar(val: string): any {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (/^\d+$/.test(val)) return parseInt(val, 10);
  if (/^\d+\.\d+$/.test(val)) return parseFloat(val);
  if (val.startsWith('"') && val.endsWith('"')) return val.slice(1, -1);
  if (val.startsWith("'") && val.endsWith("'")) return val.slice(1, -1);
  // Wikilink or plain string
  return val;
}

/** Build YAML frontmatter from VaultFrontmatter */
export function buildFrontmatter(fm: VaultFrontmatter): string {
  const lines: string[] = ['---'];
  for (const [key, val] of Object.entries(fm)) {
    if (val === undefined || val === null) continue;
    if (Array.isArray(val)) {
      lines.push(`${key}:`);
      for (const item of val) {
        lines.push(`  - ${quoteYaml(item)}`);
      }
    } else if (typeof val === 'object') {
      lines.push(`${key}:`);
      for (const item of val as string[]) {
        lines.push(`  - ${quoteYaml(item)}`);
      }
    } else {
      lines.push(`${key}: ${quoteYaml(val)}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

function quoteYaml(val: any): string {
  const s = String(val);
  if (/[:\[\]#{}|>]/.test(s) || s.includes('\n') || s === '') {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

/** Write a vault note to disk */
export function writeVaultNote(
  clientSlug: string,
  typeDir: string,
  slug: string,
  frontmatter: VaultFrontmatter,
  body: string,
  rootDir?: string,
): string {
  const wd = wikiDir(clientSlug, rootDir);
  ensureVault(clientSlug, rootDir);
  const dir = path.join(wd, typeDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, `${slug}.md`);
  const fmStr = buildFrontmatter(frontmatter);
  const content = `${fmStr}\n\n${body.trim()}\n`;
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

/** Read hot.md (working memory) */
export function readHot(clientSlug: string, rootDir?: string): string | null {
  const hp = path.join(wikiDir(clientSlug, rootDir), 'hot.md');
  if (!fs.existsSync(hp)) return null;
  const note = parseVaultNote(hp);
  return note?.body || null;
}

/** Write hot.md (working memory — overwritten each session) */
export function writeHot(clientSlug: string, body: string, rootDir?: string): string {
  const hp = path.join(wikiDir(clientSlug, rootDir), 'hot.md');
  const fm: VaultFrontmatter = {
    brain_schema: 'seoflow-brain.v1',
    type: 'hot',
    title: 'Hot — Working Memory',
    created: new Date().toISOString().split('T')[0],
    updated: new Date().toISOString().split('T')[0],
  };
  const content = `${buildFrontmatter(fm)}\n\n${body.trim()}\n`;
  fs.writeFileSync(hp, content, 'utf8');
  return hp;
}

/** Append to log.md (append-only) */
export function appendLog(clientSlug: string, entry: string, rootDir?: string): string {
  const lp = path.join(wikiDir(clientSlug, rootDir), 'log.md');
  const date = new Date().toISOString();
  const line = `- ${date.slice(0, 10)} ${date.slice(11, 16)} — ${entry}\n`;

  if (!fs.existsSync(lp)) {
    const fm: VaultFrontmatter = {
      brain_schema: 'seoflow-brain.v1',
      type: 'log',
      title: 'Change Log',
      created: new Date().toISOString().split('T')[0],
      updated: new Date().toISOString().split('T')[0],
    };
    fs.writeFileSync(lp, `${buildFrontmatter(fm)}\n\n${line}`, 'utf8');
  } else {
    fs.appendFileSync(lp, line, 'utf8');
  }
  return lp;
}
