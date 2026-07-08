# 🧠 LockIn

A bookmarklet that turns any wall-of-text article — API docs, tutorials, textbooks —
into something an ADHD brain can actually get through. No extension, no install,
works in every desktop browser (including managed/locked-down machines where
extension stores are blocked).

## Install

1. `node build.js`
2. Open `index.html` in a browser.
3. Drag the **🧠 LockIn** button to your bookmarks bar.
4. On any article, click the bookmark. Click again to hide/show the panel.

To try it immediately, open `demo.html` (a deliberately boring API reference)
and click the bookmark.

## Features

| Toggle | What it does |
|---|---|
| **Focus** | Dims everything except the paragraph you're reading; follows scroll and mouse. With Chunks on, the spotlight narrows to the single chunk you're on (via the CSS Custom Highlight API; older browsers fall back to whole-paragraph highlighting). |
| **Pager keys** | With Focus on: `j` / `space` step the spotlight forward chunk-by-chunk, `k` / `shift+space` step back, gliding the page as you go. Ignored while typing; at the article's ends space reverts to normal scrolling. |
| **Ruler** | A reading band that follows the cursor, shading the rest of the page. On a `j`/`k` step it snaps to wrap the current chunk exactly (however tall), then eases back to the cursor band on the next real mouse move — small jiggles don't knock it loose. |
| **Bionic** | Bolds the first ~40% of each word to give the eye anchor points. |
| **Chunks** | Splits paragraphs longer than ~240 chars at sentence boundaries. |
| **Comfy** | Narrow column + relaxed line height, with sliders for text size, line spacing, and column width. |
| **Declutter** | Hides `nav`/`aside`/`footer`/banner roles and any fixed/sticky overlays. |
| **Check off** | Adds a ✓ to each h2/h3 — click to collapse the section and mark it done. |
| **Progress** | Top progress bar + live "≈ N min left" estimate (230 wpm). At 100%: confetti (skipped under `prefers-reduced-motion`) and a **session receipt** — a copyable Markdown summary of time spent, sections checked off, and your "why am I here?" note. Also via the finish toast, the ETA line, or `window.__lockin.receipt()`. |
| **Map** | Mini table of contents in the panel: ▸ current section, ✓ done (via Check off), · read, ○ unread; click to jump. |
| **Link guard** | Clicking a link once does nothing (rabbit-hole protection); a second click/tap within 1.5s — or a double-click — follows it. |
| **Calm** | Pauses all CSS animations/transitions and autoplaying videos. |
| **Sprint timer** | 10/15/25-minute time-box in the panel with a soft chime at the end. |
| **🎯 Why am I here?** | An intention-anchor input pinned at the top of the panel, remembered per article. |
| **Themes** | Five dark themes (Teal, Violet, Ember, Ocean, Rose) — the dots at the bottom of the panel. Each retints the accent *and* the panel's dark neutrals; the choice persists with your other settings. |
| **Resume** | (Always on.) Remembers scroll position per article; offers a "jump back to where you left off" toast on return. |

Mobile: below 640px the panel becomes a bottom sheet with bigger tap targets,
the toast moves to the top, and the ruler follows touch instead of the mouse.

Toggles persist in `localStorage` per site. The panel's **×** reverses every
transformation and removes the tool from the page entirely.

## A note on the evidence

These features are not all equally supported by research. Chunking, progress
indicators, decluttering, time-boxing, and intention-setting line up with
well-studied attention/working-memory findings. "Bionic"-style bolding is a
2022 commercial invention, not an ADHD intervention — the largest empirical
test to date (Readwise, ~2,000 readers) found no reading-speed or
comprehension benefit on average. It stays because a minority of readers
genuinely prefer it and it's strictly opt-in.

## Files

- `src/lockin.js` — the readable source. Plain ES5-ish vanilla JS, one IIFE,
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
`window.__lockin.set(name, bool)`, `.state()`, `.receipt()`, `.togglePanel()`,
`.destroy()`.

## Hosting the install page (GitHub Pages)

The repo is Pages-ready: `index.html` (bookmarklet baked in) and `demo.html`
are static and self-contained; nothing in `dist/` is needed at runtime.

1. Push to GitHub.
2. Repo → Settings → Pages → Source "Deploy from a branch" → branch `main`,
   folder `/ (root)` → Save.
3. The install page appears at `https://<user>.github.io/<repo>/` within a
   minute or two; share that link and people can drag the button straight
   from it.

Pages serves committed files — it does not run the build. After changing
`src/lockin.js`, run `node build.js` and commit the regenerated `index.html`.
