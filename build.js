#!/usr/bin/env node
/*
 * Packs src/lockin.js into a javascript: bookmarklet and generates:
 *   dist/lockin.packed.js  - comment/indent-stripped source
 *   dist/bookmarklet.txt      - the full javascript: URL
 *   index.html                - install page with the draggable link
 *
 * The "minify" is deliberately dumb (line-level comment + indent stripping)
 * so it can never corrupt strings. Newlines are kept; they URL-encode fine.
 */
const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, 'src', 'lockin.js');
const src = fs.readFileSync(srcPath, 'utf8');

let inBlock = false;
const packed = src.split('\n').map(line => {
  let t = line.trim();
  if (inBlock) {
    if (t.includes('*/')) { inBlock = false; t = t.slice(t.indexOf('*/') + 2).trim(); }
    else return '';
  }
  if (t.startsWith('/*')) {
    if (t.includes('*/')) t = t.slice(t.indexOf('*/') + 2).trim();
    else { inBlock = true; return ''; }
  }
  if (t.startsWith('//')) return '';
  return t;
}).filter(Boolean).join('\n');

const bookmarklet = 'javascript:' + encodeURIComponent(packed);

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'lockin.packed.js'), packed);
fs.writeFileSync(path.join(__dirname, 'dist', 'bookmarklet.txt'), bookmarklet);

const esc = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LockIn — install</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.7 system-ui, sans-serif; max-width: 46rem; margin: 3rem auto; padding: 0 1.25rem; }
  h1 { font-size: 2rem; }
  .drag {
    display: inline-block; padding: .8rem 1.6rem; border-radius: 12px;
    background: #14b8a6; color: #052e28; font-weight: 700; font-size: 1.15rem;
    text-decoration: none; box-shadow: 0 4px 14px rgba(20,184,166,.4); cursor: grab;
  }
  .hint { color: #888; font-size: .9rem; }
  code { background: rgba(20,184,166,.12); padding: .1em .35em; border-radius: 5px; }
  table { border-collapse: collapse; width: 100%; }
  td, th { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid rgba(128,128,128,.25); }
  details { margin: 1rem 0; }
  textarea { width: 100%; height: 7rem; font: 12px/1.4 monospace; }
</style>
</head>
<body>
<h1>🧠 LockIn</h1>
<p>Turns any wall-of-text article — API docs, tutorials, textbooks — into something an
ADHD brain can actually get through. Works in every desktop browser, no extension needed.</p>

<h2>Install (10 seconds)</h2>
<p>Drag this button onto your bookmarks bar:</p>
<p><a class="drag" href="${esc(bookmarklet)}">🧠 LockIn</a></p>
<p class="hint">Bookmarks bar hidden? Press <code>Ctrl+Shift+B</code> (<code>⌘+Shift+B</code> on Mac).
Then, on any article, click the bookmark. Click it again to hide the panel.</p>

<details>
<summary>Can't drag it? (Safari, mobile, managed machines)</summary>
<p>Bookmark any page, then edit that bookmark and paste this as its URL:</p>
<textarea readonly onclick="this.select()">${bookmarklet
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')}</textarea>
</details>

<h2>What the buttons do</h2>
<table>
<tr><th>Focus</th><td>Dims everything except the paragraph you're reading — follows your scroll and mouse. Keyboard: <code>j</code>/<code>space</code> and <code>k</code> step the spotlight chunk by chunk.</td></tr>
<tr><th>Ruler</th><td>A reading band that follows your cursor, shading the rest of the page.</td></tr>
<tr><th>Bionic</th><td>Bolds the first part of each word so your eye has anchors to jump between.</td></tr>
<tr><th>Chunks</th><td>Splits giant paragraphs into short, breathable pieces.</td></tr>
<tr><th>Comfy</th><td>Narrow column, taller line spacing — less visual noise per line.</td></tr>
<tr><th>Declutter</th><td>Hides sidebars, navs, footers, cookie bars, and sticky banners.</td></tr>
<tr><th>Check off</th><td>Adds a ✓ next to each section heading — click to collapse it and feel the progress.</td></tr>
<tr><th>Progress</th><td>Progress bar plus a live "≈ N min left" estimate, so the end is always in sight — with confetti when you finish, and a one-click session receipt (time spent, sections done, your note) to paste into your notes.</td></tr>
<tr><th>Map</th><td>A mini table of contents in the panel: ▸ where you are, ✓ what's done, click to jump.</td></tr>
<tr><th>Link guard</th><td>One click on a link does nothing — click it twice when you really mean it. Goodbye, rabbit holes.</td></tr>
<tr><th>Calm</th><td>Freezes animations and pauses autoplaying videos.</td></tr>
<tr><th>10m / 15m / 25m</th><td>Reading sprint timer with a gentle chime — helps with time blindness.</td></tr>
<tr><th>🎯 Why am I here?</th><td>Write the question you came to answer; it stays pinned in the panel (and is remembered per article).</td></tr>
<tr><th>Themes</th><td>Five dark color themes — tap the dots at the bottom of the panel.</td></tr>
</table>
<p>Comfy has sliders for text size, line spacing, and column width. It also
remembers how far you scrolled and offers a one-click "jump back to where you
left off" when you come back to an article. On phones the panel becomes a
bottom sheet — install by editing any bookmark and pasting the code above as
its URL.</p>
<p>Your toggles are remembered per site. The <b>×</b> button undoes everything and removes the tool from the page.</p>

<h2>Try it</h2>
<p>Open the <a href="demo.html">deliberately boring demo article</a> and click your new bookmark.</p>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), page);

console.log('packed source : %d bytes', packed.length);
console.log('bookmarklet   : %d bytes (URL length)', bookmarklet.length);
console.log('wrote dist/lockin.packed.js, dist/bookmarklet.txt, index.html');
