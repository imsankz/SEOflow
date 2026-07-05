/**
 * Brain — SeoFlow's working memory and audit trail.
 *
 * Two files:
 *   - hot.md: overwritten per session. Current state, next actions, summary of last run.
 *   - log.md: append-only. Every decision, change, and error.
 *
 * Data lives in .seoflow/brain/ within the installed project.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { HotBrain, LogEntry } from './types';

const BRAIN_DIR = () => path.join(process.cwd(), '.seoflow', 'brain');
const HOT_PATH = () => path.join(BRAIN_DIR(), 'hot.md');
const LOG_PATH = () => path.join(BRAIN_DIR(), 'log.md');

function ensureDir(): void {
  const dir = BRAIN_DIR();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ─── hot.md ───────────────────────────────────────────────────────────────────

const DEFAULT_HOT: HotBrain = {
  brain_schema: 'seoflow-brain.v1',
  lastUpdated: new Date().toISOString(),
  nextActions: [],
  recentPosts: [],
  backlog: [],
  issues: [],
};

/** Serialize a HotBrain to hot.md format */
function hotToYaml(hot: HotBrain): string {
  const lines: string[] = ['---'];
  const add = (key: string, val: unknown, indent = 0) => {
    const pad = '  '.repeat(indent);
    if (val === undefined || val === null) return;
    if (Array.isArray(val)) {
      if (val.length === 0) {
        lines.push(`${pad}${key}: []`);
      } else {
        lines.push(`${pad}${key}:`);
        for (const item of val) {
          if (typeof item === 'object' && item !== null) {
            lines.push(`${pad}-`);
            for (const [k, v] of Object.entries(item)) {
              add(k, v, indent + 2);
            }
          } else {
            lines.push(`${pad}- ${JSON.stringify(item)}`);
          }
        }
      }
    } else if (typeof val === 'object' && val !== null) {
      lines.push(`${pad}${key}:`);
      for (const [k, v] of Object.entries(val)) {
        add(k, v, indent + 1);
      }
    } else {
      lines.push(`${pad}${key}: ${JSON.stringify(val)}`);
    }
  };

  add('brain_schema', hot.brain_schema);
  add('lastUpdated', hot.lastUpdated);
  add('lastRun', hot.lastRun);
  add('recentPosts', hot.recentPosts);
  add('nextActions', hot.nextActions);
  add('backlog', hot.backlog);
  add('issues', hot.issues);
  lines.push('---');
  lines.push('');
  lines.push('## Working Memory');
  lines.push('');
  lines.push('This file is overwritten each session with the current pipeline state.');
  lines.push('Next actions are at the top — start here each session.');
  return lines.join('\n');
}

/** Read hot.md, returning defaults on first run */
export function readBrain(): HotBrain {
  const hpath = HOT_PATH();
  if (!fs.existsSync(hpath)) {
    return { ...DEFAULT_HOT, lastUpdated: new Date().toISOString() };
  }
  try {
    const raw = fs.readFileSync(hpath, 'utf-8');
    // Simple YAML frontmatter parser
    const match = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return { ...DEFAULT_HOT };

    const frontmatter: Record<string, any> = {};
    const parseVal = (v: string): any => {
      v = v.trim();
      if (v === '[]') return [];
      if (v === 'true') return true;
      if (v === 'false') return false;
      if (/^\d+$/.test(v)) return parseInt(v, 10);
      if (/^\d+\.\d+$/.test(v)) return parseFloat(v);
      if (/^"/.test(v)) return JSON.parse(v);
      return v;
    };

    const lines = match[1].split('\n');
    let currentKey = '';
    let inList = false;
    let listItems: any[] = [];
    let inNestedSection = false;
    let nestedKeys: Record<string, any> = {};
    let nestedSubItems: any[] = [];

    for (const line of lines) {
      const trimmed = line.trimLeft();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Top-level list item (array of objects)
      if (inList && trimmed.startsWith('- ') && !trimmed.slice(2).includes(':')) {
        listItems.push(parseVal(trimmed.slice(2).trim()));
        continue;
      }

      // Sub-key under a nested object (indented, for lastRun sections)
      if (inNestedSection && /^\w[\w_-]*?:\s*/.test(trimmed) && !trimmed.startsWith('-')) {
        const subMatch = trimmed.match(/^(\w[\w_-]*?):\s*(.*?)$/);
        if (subMatch) {
          const sk = subMatch[1];
          let sv = subMatch[2].trim();
          if (sv !== '') {
            nestedKeys[sk] = parseVal(sv);
          } else {
            // Nested list follows
            nestedSubItems = [];
            const afterLine = lines.indexOf(line);
            for (let j = afterLine + 1; j < lines.length; j++) {
              const ln = lines[j];
              if (ln.trimLeft().startsWith('- ') && !ln.includes(':') && !ln.startsWith('- ') || !ln.trimLeft().startsWith('- ')) {
                let listVal = ln.trimLeft().slice(2).trim();
                nestedSubItems.push(parseVal(listVal));
              } else {
                break;
              }
            }
            nestedKeys[sk] = nestedSubItems;
          }
        }
        continue;
      }

      // Array item with key: value (backlog entries, recentPosts entries)
      if (inList && trimmed.startsWith('- ') && trimmed.slice(2).includes(':')) {
        const entryMatch = trimmed.slice(2).match(/^(\w[\w_-]*?):\s*(.*?)$/);
        if (entryMatch) {
          if (listItems.length === 0 || typeof listItems[listItems.length - 1] !== 'object') {
            listItems.push({});
          }
          listItems[listItems.length - 1][entryMatch[1]] = parseVal(entryMatch[2].trim());
        }
        continue;
      }

      // Top-level key
      const keyMatch = trimmed.match(/^(\w[\w_-]*?):\s*(.*?)$/);
      if (keyMatch) {
        const key = keyMatch[1];
        const val = keyMatch[2].trim();

        // Flush previous list
        if (inList) {
          frontmatter[currentKey] = listItems;
          listItems = [];
          inList = false;
        }

        if (val === '' || val === '[]') {
          // List or object follows
          frontmatter[key] = val === '[]' ? [] : undefined;
          currentKey = key;
          inList = true;
          listItems = [];
          inNestedSection = false;
          nestedKeys = {};
        } else if (val === '{') {
          // Try to detect next lines as object fields
          inNestedSection = true;
          nestedKeys = {};
          currentKey = key;
        } else {
          frontmatter[key] = parseVal(val);
        }
        continue;
      }

      // Nested object detection: sub-keys under lastRun etc
      if (inList && currentKey && /^\w[\w_-]*?:\s*/.test(trimmed)) {
        const subMatch = trimmed.match(/^(\w[\w_-]*?):\s*(.*?)$/);
        if (subMatch) {
          if (typeof listItems[0] !== 'object' && listItems.length === 0) {
            // This is actually a nested object (like lastRun) not a list
            frontmatter[currentKey] = {} as any;
          }
          const existing = frontmatter[currentKey] || {};
          existing[subMatch[1]] = parseVal(subMatch[2].trim());
          frontmatter[currentKey] = existing;
          inList = false;
        }
      }
    }

    // Flush final list
    if (inList) {
      frontmatter[currentKey] = listItems;
    }

    // Convert parsed nested run-like objects into typed objects
    const parsedLastRun: any = frontmatter['lastRun'];
    const parsedRecentPosts = Array.isArray(frontmatter['recentPosts']) ? frontmatter['recentPosts'] : [];
    const parsedBacklog = Array.isArray(frontmatter['backlog']) ? frontmatter['backlog'] : [];
    const parsedIssues: Array<{severity: string; count: number; description: string}> = (() => {
      const raw = frontmatter['issues'];
      if (Array.isArray(raw)) {
        return raw.map((item: any) => {
          if (typeof item === 'string') return { severity: 'medium', count: 1, description: item };
          const parts = item.split('||');
          if (parts.length === 3) {
            const [sev, cnt, desc] = parts;
            const count = parseInt(cnt, 10) || 0;
            return {
              severity: sev.trim() as 'high' | 'medium' | 'low',
              count,
              description: desc.trim(),
            };
          }
          return { severity: 'medium', count: 1, description: item };
        });
      }
      return [];
    })();

    return {
      brain_schema: 'seoflow-brain.v1',
      lastUpdated: (frontmatter.lastUpdated as string) || new Date().toISOString(),
      lastRun: parsedLastRun?.timestamp ? parsedLastRun as HotBrain['lastRun'] : undefined,
      recentPosts: parsedRecentPosts as HotBrain['recentPosts'],
      nextActions: Array.isArray(frontmatter.nextActions) ? frontmatter.nextActions as string[] : [],
      backlog: parsedBacklog as HotBrain['backlog'],
      issues: parsedIssues as HotBrain['issues'],
    };
  } catch {
    return { ...DEFAULT_HOT };
  }
}

/** Overwrite hot.md with current state */
export function writeBrain(hot: Partial<HotBrain>): void {
  ensureDir();
  const existing = readBrain();
  const merged: HotBrain = { ...existing, ...hot, lastUpdated: new Date().toISOString() };
  fs.writeFileSync(HOT_PATH(), hotToYaml(merged));
}

/** Quick update: append a next action */
export function addNextAction(action: string): void {
  const brain = readBrain();
  if (!brain.nextActions.includes(action)) {
    brain.nextActions.push(action);
    writeBrain(brain);
  }
}

/** Quick update: add a backlog item */
export function addBacklogItem(slug: string, priority: number, reason: string): void {
  const brain = readBrain();
  const existing = brain.backlog.find((b) => b.slug === slug);
  if (existing) {
    existing.priority = Math.max(existing.priority, priority);
    existing.reason = reason;
  } else {
    brain.backlog.push({ slug, priority, reason });
  }
  brain.backlog.sort((a, b) => b.priority - a.priority);
  writeBrain(brain);
}

/** Quick update: record a post's last-run status */
export function recordPostRun(slug: string, status: 'ok' | 'warn' | 'error', changes: number, aiCalls: number): void {
  const brain = readBrain();
  const existing = brain.recentPosts.find((p) => p.slug === slug);
  if (existing) {
    existing.status = status;
    existing.changes = changes;
    existing.aiCalls = aiCalls;
  } else {
    brain.recentPosts.push({ slug, status, changes, aiCalls });
  }
  writeBrain(brain);
}

/** Record a pipeline run */
export function recordRun(timestamp: string, duration: number, postsProcessed: number, errors: number, totalChanges: number): void {
  writeBrain({
    lastRun: { timestamp, duration, postsProcessed, errors, totalChanges },
  } as Partial<HotBrain>);
}

// ─── log.md ───────────────────────────────────────────────────────────────────

/** Append an entry to the audit trail log */
export function appendLog(entry: Omit<LogEntry, 'timestamp'>): void {
  ensureDir();
  const timestamp = new Date().toISOString();
  const logLine = `- **${timestamp.slice(0, 19).replace('T', ' ')}** [${entry.type}] ${entry.summary}${entry.slug ? ` (slug: ${entry.slug})` : ''}${entry.changeCount !== undefined ? ` (${entry.changeCount} changes)` : ''}\n${entry.step ? `  - step: ${entry.step}\n` : ''}${entry.detail ? `  - detail: ${entry.detail}\n` : ''}`;

  fs.appendFileSync(LOG_PATH(), logLine);
}

/** Read the last N log entries */
export function readLog(limit = 20): LogEntry[] {
  const lpath = LOG_PATH();
  if (!fs.existsSync(lpath)) return [];

  try {
    const raw = fs.readFileSync(lpath, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.startsWith('- **'));
    const entries: LogEntry[] = [];

    for (const line of lines.slice(-limit)) {
      const tsMatch = line.match(/- \*\*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\*\*/);
      const typeMatch = line.match(/\[(\w+)\]/);
      const summary = line.replace(/^- \*\*.*?\*\* \[.*?\] /, '').split(' (slug:')[0].trim();
      if (tsMatch && typeMatch) {
        entries.push({
          timestamp: tsMatch[1],
          type: typeMatch[1] as LogEntry['type'],
          summary,
        });
      }
    }

    return entries;
  } catch {
    return [];
  }
}

/** Read the full brain state as a human-readable string */
export function readBrainSummary(): string {
  const hot = readBrain();
  const recent = readLog(10);

  const lines: string[] = [];
  lines.push(`## SeoFlow Brain`);
  lines.push(`**Last updated:** ${hot.lastUpdated}`);
  lines.push(``);

  if (hot.lastRun) {
    const dur = (hot.lastRun.duration / 1000).toFixed(0);
    lines.push(`**Last run:** ${hot.lastRun.timestamp} (${dur}s)`);
    lines.push(`  - Posts processed: ${hot.lastRun.postsProcessed}`);
    lines.push(`  - Changes: ${hot.lastRun.totalChanges}`);
    lines.push(`  - Errors: ${hot.lastRun.errors}`);
    lines.push(``);
  }

  if (hot.nextActions.length > 0) {
    lines.push(`**Next actions:**`);
    for (const a of hot.nextActions) {
      lines.push(`  ☐ ${a}`);
    }
    lines.push(``);
  }

  if (hot.backlog.length > 0) {
    lines.push(`**Backlog (top 5):**`);
    for (const b of hot.backlog.slice(0, 5)) {
      lines.push(`  [${b.priority}] ${b.slug} — ${b.reason}`);
    }
    lines.push(``);
  }

  if (recent.length > 0) {
    lines.push(`**Recent log entries:**`);
    for (const e of recent) {
      lines.push(`  [${e.type}] ${e.summary}`);
    }
  }

  return lines.join('\n');
}