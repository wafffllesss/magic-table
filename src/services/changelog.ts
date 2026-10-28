export type ChangelogLocale = 'en' | 'pt-BR';
export type ChangelogNotes = Partial<Record<ChangelogLocale, string>>;
const files = import.meta.glob('../../changelogs/*.md', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;

export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number); const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}
export const changelogs = Object.entries(files).reduce<Record<string, ChangelogNotes>>((result, [path, text]) => {
  const match = /\/(\d+\.\d+\.\d+)\.(en|pt-BR)\.md$/.exec(path);
  if (match) (result[match[1]] ??= {})[match[2] as ChangelogLocale] = text;
  return result;
}, {});
export const changelogVersions = Object.keys(changelogs).sort((a, b) => compareVersions(b, a)).slice(0, 10);

export function shouldShowChangelog(version: string, seen: string | undefined, notes: Record<string, ChangelogNotes>): boolean {
  return Boolean(notes[version]) && seen !== version;
}

// Deliberately support only headings, list items and paragraphs. All text is rendered by Vue as text.
export function parseChangelog(markdown: string): { type: 'heading' | 'item' | 'paragraph'; text: string }[] {
  return markdown.split(/\r?\n/).flatMap<{ type: 'heading' | 'item' | 'paragraph'; text: string }>(line => {
    const text = line.trim();
    if (!text) return [];
    if (/^#{1,3}\s+/.test(text)) return [{ type: 'heading' as const, text: text.replace(/^#{1,3}\s+/, '') }];
    if (/^[-*]\s+/.test(text)) return [{ type: 'item' as const, text: text.replace(/^[-*]\s+/, '') }];
    return [{ type: 'paragraph' as const, text }];
  });
}
