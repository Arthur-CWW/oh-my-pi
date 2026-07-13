> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-07-06T07-53-32-097Z_019f366b-08c1-7000-b479-8aaa760c2c42/local/xunzi-clean-rebuild.md

cd /Users/arthur/agents/streams/primer/wrapped-commentary-reader
node <<'NODE'
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const src = 'artifacts/library/priority-reading/[Translations_from_the_Asian_Classics]_Xunzi,_Burton_Watson_-_Xunzi_Basic_Writings_(2003,_Columbia_University_Press)_-_libgen.li.epub';
const text = execFileSync('pandoc', [src, '-t', 'plain'], { encoding: 'utf8', maxBuffer: 30_000_000 }).replace(/\u00a0/g, ' ');
const lines = text.split(/\r?\n/);
const headings = [
  { title: 'Introduction', marker: 'INTRODUCTION' },
  { title: 'Encouraging Learning', marker: 'ENCOURAGING LEARNING' },
  { title: 'Improving Yourself', marker: 'IMPROVING YOURSELF' },
  { title: 'The Regulations of a King', marker: 'THE REGULATIONS OF A KING' },
  { title: 'Debating Military Affairs', marker: 'DEBATING MILITARY AFFAIRS' },
  { title: 'A Discussion of Heaven', marker: 'A DISCUSSION OF HEAVEN' },
  { title: 'A Discussion of Rites', marker: 'A DISCUSSION OF RITES' },
  { title: 'A Discussion of Music', marker: 'A DISCUSSION OF MUSIC' },
  { title: 'Dispelling Obsession', marker: 'DISPELLING OBSESSION' },
  { title: 'Rectifying Names', marker: 'RECTIFYING NAMES' },
  { title: 'Man’s Nature Is Evil', marker: 'MAN’S NATURE IS EVIL' },
];
const starts = headings.map((h) => {
  const idx = lines.findIndex((line, i) => i > 120 && line.includes(h.marker));
  if (idx < 0) throw new Error(`missing ${h.marker}`);
  return { ...h, idx };
});
const indexIdx = lines.findIndex((line, i) => i > starts.at(-1).idx && line.trim() === 'Index');
if (indexIdx < 0) throw new Error('missing Index boundary');
const cleanLine = (line) => line.replace(/\[image\]/g, '').replace(/\s+$/g, '');
const units = starts.map((h, n) => {
  const next = n + 1 < starts.length ? starts[n + 1].idx : indexIdx;
  const bodyLines = lines.slice(h.idx + 1, next).map(cleanLine);
  while (bodyLines.length && bodyLines[0].trim() === '') bodyLines.shift();
  while (bodyLines.length && bodyLines.at(-1).trim() === '') bodyLines.pop();
  return `# ${h.title}\n\n${bodyLines.join('\n')}`;
});
fs.writeFileSync('artifacts/library/xunzi-chapters.md', `${units.join('\n\n')}\n`);
console.log(`wrote artifacts/library/xunzi-chapters.md with ${units.length} units`);
NODE
rm -rf artifacts/books/xunzi
bun scripts/prepare-book-ir.ts artifacts/library/xunzi-chapters.md --slug xunzi --title "Xunzi" --author "Burton Watson" --prompt-units 11
