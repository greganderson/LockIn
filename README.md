# 🧠 ADHDifier

A bookmarklet that turns any wall-of-text article — API docs, tutorials, textbooks —
into something an ADHD brain can actually get through. No extension, no install,
works in every desktop browser (including managed/locked-down machines where
extension stores are blocked).

## Install

1. `node build.js`
2. Open `index.html` in a browser.
3. Drag the **🧠 ADHDify** button to your bookmarks bar.
4. On any article, click the bookmark. Click again to hide/show the panel.

To try it immediately, open `demo.html` (a deliberately boring API reference)
and click the bookmark.

## Features

| Toggle | What it does |
|---|---|
| **Focus** | Dims everything except the paragraph you're reading; follows scroll and mouse. |
| **Ruler** | A reading band that follows the cursor, shading the rest of the page. |
| **Bionic** | Bolds the first ~40% of each word to give the eye anchor points. |
| **Chunks** | Splits paragraphs longer than ~240 chars at sentence boundaries. |
| **Comfy** | 70ch column, 1.8 line height. |
| **Declutter** | Hides `nav`/`aside`/`footer`/banner roles and any fixed/sticky overlays. |
| **Check off** | Adds a ✓ to each h2/h3 — click to collapse the section and mark it done. |
| **Progress** | Top progress bar + live "≈ N min left" estimate (230 wpm). Confetti at 100%. |
| **Listen** | Text-to-speech via the browser's built-in `speechSynthesis` — highlights and auto-scrolls the paragraph being read, starting from wherever you are. |
| **Link guard** | Single-clicking a link does nothing (rabbit-hole protection); double-click follows it. |
| **Calm** | Pauses all CSS animations/transitions and autoplaying videos. |
| **Sprint timer** | 10/15/25-minute time-box in the panel with a soft chime at the end. |
| **Resume** | (Always on.) Remembers scroll position per article; offers a "jump back to where you left off" toast on return. |

Toggles persist in `localStorage` per site. The panel's **×** reverses every
transformation and removes the tool from the page entirely.

## A note on the evidence

These features are not all equally supported by research. Chunking, progress
indicators, decluttering, time-boxing, and text-to-speech line up with
well-studied attention/working-memory findings. "Bionic"-style bolding is a
2022 commercial invention, not an ADHD intervention — the largest empirical
test to date (Readwise, ~2,000 readers) found no reading-speed or
comprehension benefit on average. It stays because a minority of readers
genuinely prefer it and it's strictly opt-in.

## Files

- `src/adhdifier.js` — the readable source. Plain ES5-ish vanilla JS, one IIFE,
  everything namespaced `adhdy`. Also usable directly as a userscript body or
  a content script if you ever want an extension version.
- `build.js` — strips comments/indentation (line-level only, so strings can
  never be corrupted), URL-encodes into `dist/bookmarklet.txt`, and generates
  `index.html`.
- `demo.html` — worst-case test article: giant paragraphs, sidebar, sticky
  cookie banner, nav, footer.

## Design notes

- **Reversibility is the invariant.** Every transform stores nothing it can't
  undo: bionic wraps in `b.adhdy-bio` (unwrap + `normalize()` restores),
  chunking splits text nodes and inserts `span.adhdy-gap` spacers (remove +
  `normalize()` restores), everything else is CSS classes.
- Content detection scores candidate containers (`article`, `main`, etc.) by
  total paragraph text length and falls back to `<body>`.
- Bionic must `normalize()` its output fragment, otherwise the word-remainder
  and following whitespace end up in separate text nodes and Chunks can no
  longer see sentence boundaries. (Found the hard way; covered by the test.)
- `javascript:` bookmarklets run regardless of the page's CSP in mainline
  browsers, which is why this form factor beats an injected `<script src>`.

## Testing

```sh
sh test/run.sh   # requires chromium on PATH
```

Builds, injects the packed script into `demo.html` headlessly, and asserts:
chunk gaps inserted and removed, chunks still work after bionic, bionic bold
count, section fold, panel present, zero `adhdy` leftovers after destroy, and
`innerText` byte-identical to the original after destroy.

The public API the tests drive is exactly what the panel buttons call:
`window.__adhdifier.set(name, bool)`, `.state()`, `.togglePanel()`, `.destroy()`.
