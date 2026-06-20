import 'server-only';
import fs from 'fs';
import path from 'path';
import { marked } from 'marked';

const KB_DIR = path.join(process.cwd(), 'content/kb');

// build-process / architecture / troubleshooting / error-codes / ha-runbook → Technical.
// index is the home doc (excluded from the nav list). Everything else → Sections.
const TECHNICAL = new Set([
  'build-process',
  'architecture',
  'troubleshooting',
  'error-codes',
  'ha-runbook',
  'staging',
]);

export type KbDoc = { slug: string; title: string; group: 'Sections' | 'Technical' };

function prettify(slug: string): string {
  return slug
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function firstH1(raw: string): string | null {
  const m = raw.match(/^\s*#\s+(.+?)\s*$/m);
  return m ? m[1].trim() : null;
}

function readRaw(slug: string): string | null {
  // Guard against path traversal — slug must be a bare filename.
  if (!/^[a-z0-9-]+$/i.test(slug)) return null;
  const file = path.join(KB_DIR, `${slug}.md`);
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

export function listDocs(): KbDoc[] {
  let files: string[] = [];
  try {
    files = fs.readdirSync(KB_DIR).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }

  const docs = files
    .map((f) => f.replace(/\.md$/, ''))
    .filter((slug) => slug !== 'index')
    .map<KbDoc>((slug) => {
      const raw = readRaw(slug);
      const title = (raw && firstH1(raw)) || prettify(slug);
      const group: KbDoc['group'] = TECHNICAL.has(slug) ? 'Technical' : 'Sections';
      return { slug, title, group };
    });

  // Sections first, then Technical; alphabetical by title within a group.
  const order = { Sections: 0, Technical: 1 };
  docs.sort((a, b) => order[a.group] - order[b.group] || a.title.localeCompare(b.title));
  return docs;
}

function rewriteLinks(raw: string): string {
  return raw
    // ./images/foo.png  ->  /kb-images/foo.png
    .replace(/\]\(\.\/images\/([^)]+)\)/g, '](/kb-images/$1)')
    // ./tickets.md (optionally with #anchor)  ->  /kb/tickets
    .replace(/\]\(\.\/([a-z0-9-]+)\.md(#[^)]*)?\)/gi, '](/kb/$1$2)');
}

export function getDoc(slug: string): { title: string; html: string } | null {
  const raw = readRaw(slug);
  if (raw == null) return null;
  const title = firstH1(raw) || prettify(slug);
  const html = marked.parse(rewriteLinks(raw)) as string;
  return { title, html };
}
