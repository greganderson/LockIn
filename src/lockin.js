/*
 * LockIn — make any article ADHD-friendly.
 * Runs as a bookmarklet (see build.js), a userscript, or a plain <script>.
 * Everything is toggleable, reversible, and namespaced with "adhdy".
 */
(function () {
  'use strict';

  // Already loaded? Just show/hide the panel instead of injecting twice.
  if (window.__lockin) { window.__lockin.togglePanel(); return; }

  var WPM = 230;              // reading speed for the "min left" estimate
  var CHUNK_MIN = 160;        // min chars between inserted paragraph breaks
  var STORE_KEY = 'adhdifier-settings'; // pre-rename key kept so upgrades keep settings

  var doc = document, html = doc.documentElement;
  var startTime = Date.now(); // for the session receipt
  var motionOK = !(window.matchMedia &&
    matchMedia('(prefers-reduced-motion: reduce)').matches);
  var listeners = [];         // [target, type, fn] so teardown can unbind all

  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    listeners.push([target, type, fn, opts]);
  }

  /* ---------------------------------------------------------- content root */

  // Best guess at "the article" — the element holding the most paragraph text.
  function findContent() {
    var sels = ['article', 'main', '[role="main"]', '#content', '.content',
                '.post', '.post-content', '.article', '.entry-content',
                '.markdown-body', '.doc', '.docs-content'];
    var cands = [];
    sels.forEach(function (s) {
      doc.querySelectorAll(s).forEach(function (el) {
        if (cands.indexOf(el) < 0) cands.push(el);
      });
    });
    if (!cands.length) cands = [doc.body];
    var best = doc.body, bestScore = 0;
    cands.forEach(function (el) {
      var score = 0;
      el.querySelectorAll('p, li, pre').forEach(function (b) {
        score += b.textContent.length;
      });
      if (score > bestScore) { bestScore = score; best = el; }
    });
    return best;
  }

  var root = findContent();

  function countWords() {
    return (root.innerText || root.textContent || '')
      .split(/\s+/).filter(Boolean).length;
  }

  /* ----------------------------------------------------------------- style */

  // All themeable colors live in --adhdy-* custom properties on <html>,
  // set by applyTheme() from the THEMES table below.
  var ACCENT = 'var(--adhdy-accent)';
  var DIM = 0.28;   // Focus dim strength, shared by paragraphs and chunks
  var style = doc.createElement('style');
  style.id = 'adhdy-style';
  style.textContent = [
    /* focus spotlight */
    'html.adhdy-focus .adhdy-block{opacity:' + DIM + ';transition:opacity .25s ease}',
    'html.adhdy-focus .adhdy-block.adhdy-cur{opacity:1}',
    /* With chunk-level focus, block opacity must switch instantly: an
       animated paragraph fade under the instant chunk highlight makes
       non-current chunks dip to double-dimmed mid-transition (flicker). */
    'html.adhdy-nofade .adhdy-block{transition:none}',
    /* bionic bolding */
    'b.adhdy-bio{font-weight:700;color:inherit}',
    /* chunk gaps */
    'span.adhdy-gap{display:block;height:.8em}',
    /* comfy text — tuned by the panel sliders via CSS variables */
    '.adhdy-comfy{max-width:var(--adhdy-w,70ch)!important;margin-left:auto!important;margin-right:auto!important;float:none!important}',
    '.adhdy-comfy :is(p,li,dd,blockquote){line-height:var(--adhdy-lh,1.8)!important;font-size:var(--adhdy-fs,1.05em)}',
    /* declutter */
    'html.adhdy-clean :is(nav,aside,footer,[role=navigation],[role=complementary],[role=banner]),html.adhdy-clean .adhdy-hidefixed{display:none!important}',
    /* section fold */
    '.adhdy-folded{display:none!important}',
    '.adhdy-done{opacity:.45;text-decoration:line-through}',
    'button.adhdy-check{cursor:pointer;margin-right:.5em;width:1.5em;height:1.5em;border-radius:50%;border:2px solid ' + ACCENT + ';background:transparent;color:' + ACCENT + ';font-size:.8em;line-height:1;vertical-align:middle;padding:0}',
    'button.adhdy-check.adhdy-on{background:' + ACCENT + ';color:var(--adhdy-accent-text)}',
    /* progress bar */
    '#adhdy-progress{position:fixed;top:0;left:0;height:4px;width:0;background:' + ACCENT + ';z-index:2147483645;transition:width .1s linear}',
    /* reading ruler */
    '#adhdy-ruler{position:fixed;left:0;width:100vw;height:96px;pointer-events:none;z-index:2147483640;box-shadow:0 0 0 200vmax rgba(var(--adhdy-shade),.34);border-top:1px solid rgba(var(--adhdy-argb),.55);border-bottom:1px solid rgba(var(--adhdy-argb),.55)}',
    /* while keyboard-paging, the ruler snaps to wrap the current chunk and
       eases back to the mouse band on the next real mouse move */
    '#adhdy-ruler.adhdy-snap{transition:top .25s ease,height .25s ease}',
    '@media (prefers-reduced-motion:reduce){#adhdy-ruler.adhdy-snap{transition:none}}',
    /* link guard */
    'html.adhdy-guard a[href]{color:inherit!important;text-decoration:underline dotted rgba(var(--adhdy-argb),.65)!important}',
    /* calm — freeze motion (confetti exempted below) */
    'html.adhdy-calm *,html.adhdy-calm *::before,html.adhdy-calm *::after{animation-play-state:paused!important;transition:none!important;scroll-behavior:auto!important}',
    /* confetti */
    '@keyframes adhdy-fall{to{transform:translateY(105vh) rotate(540deg);opacity:.15}}',
    '.adhdy-confetti{position:fixed;top:-32px;z-index:2147483644;font-size:22px;pointer-events:none;animation:adhdy-fall 1.9s ease-in forwards}',
    'html.adhdy-calm .adhdy-confetti{animation-play-state:running!important}',
    /* toast */
    '#adhdy-toast{position:fixed;bottom:18px;right:18px;z-index:2147483646;font:13px/1.5 system-ui,sans-serif;color:var(--adhdy-text);background:var(--adhdy-bg);border:1px solid var(--adhdy-border);border-radius:10px;padding:10px 14px;max-width:280px;box-shadow:0 8px 30px rgba(0,0,0,.45);cursor:pointer}',
    /* panel */
    '#adhdy-panel{all:initial;position:fixed;top:16px;right:16px;z-index:2147483646;font:13px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;color:var(--adhdy-text);background:var(--adhdy-bg);border:1px solid var(--adhdy-border);border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.45);padding:12px;width:216px;box-sizing:border-box}',
    '#adhdy-panel *{all:revert;font:inherit;color:inherit;box-sizing:border-box;margin:0;padding:0}',
    '#adhdy-panel .adhdy-head{display:flex;align-items:center;gap:6px;margin-bottom:10px;cursor:grab;touch-action:none}',
    '#adhdy-panel .adhdy-title{font-weight:700;font-size:14px;flex:1;user-select:none}',
    '#adhdy-panel .adhdy-x{cursor:pointer;background:none;border:none;color:var(--adhdy-muted);font-size:15px;padding:2px 5px;border-radius:6px}',
    '#adhdy-panel .adhdy-x:hover{background:var(--adhdy-hover);color:#fff}',
    '#adhdy-panel .adhdy-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}',
    '#adhdy-panel .adhdy-t{cursor:pointer;border:1px solid var(--adhdy-border);background:var(--adhdy-surface);color:var(--adhdy-btn);border-radius:8px;padding:6px 4px;font-size:12px;text-align:center}',
    '#adhdy-panel .adhdy-t:hover{border-color:' + ACCENT + '}',
    '#adhdy-panel .adhdy-t.adhdy-on{background:' + ACCENT + ';border-color:' + ACCENT + ';color:var(--adhdy-accent-text);font-weight:600}',
    '#adhdy-panel .adhdy-eta{margin-top:10px;font-size:12px;color:var(--adhdy-muted);text-align:center}',
    '#adhdy-panel .adhdy-row{display:flex;gap:6px;margin-top:8px;align-items:center}',
    '#adhdy-panel .adhdy-tm{cursor:pointer;border:1px solid var(--adhdy-border);background:var(--adhdy-surface);color:var(--adhdy-btn);border-radius:8px;padding:4px 0;font-size:11px;flex:1;text-align:center}',
    '#adhdy-panel .adhdy-tm:hover{border-color:' + ACCENT + '}',
    '#adhdy-panel .adhdy-clock{flex:1.4;text-align:center;font-size:12px;color:var(--adhdy-muted);cursor:pointer}',
    /* theme picker */
    '#adhdy-panel .adhdy-themes{display:flex;gap:8px;justify-content:center;margin-top:10px}',
    '#adhdy-panel .adhdy-th{width:16px;height:16px;border-radius:50%;cursor:pointer;border:2px solid transparent;padding:0}',
    '#adhdy-panel .adhdy-th:hover{transform:scale(1.15)}',
    '#adhdy-panel .adhdy-th.adhdy-on{border-color:var(--adhdy-text)}',
    /* "why am I here?" note */
    '#adhdy-note{width:100%;margin-bottom:10px;background:var(--adhdy-surface);border:1px solid var(--adhdy-border);border-radius:8px;color:var(--adhdy-text);font-size:12px;padding:6px 8px}',
    '#adhdy-note::placeholder{color:var(--adhdy-dim2)}',
    '#adhdy-note:focus{outline:none;border-color:' + ACCENT + '}',
    /* comfy sliders */
    '#adhdy-sliders{margin-top:8px;display:none}',
    '#adhdy-sliders label{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--adhdy-muted);margin-top:4px;cursor:pointer}',
    '#adhdy-sliders span{width:14px;text-align:center}',
    '#adhdy-sliders input{flex:1;accent-color:' + ACCENT + ';margin:0;min-width:0}',
    /* section map */
    '#adhdy-map{margin-top:8px;max-height:180px;overflow-y:auto;border-top:1px solid var(--adhdy-border);padding-top:6px;display:none}',
    '#adhdy-map .adhdy-mrow{cursor:pointer;padding:3px 6px;border-radius:6px;font-size:12px;color:var(--adhdy-btn);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#adhdy-map .adhdy-mrow:hover{background:var(--adhdy-hover);color:#fff}',
    '#adhdy-map .adhdy-mrow.adhdy-sub{padding-left:20px}',
    '#adhdy-map .adhdy-mrow.adhdy-read{color:var(--adhdy-dim2)}',
    '#adhdy-map .adhdy-mrow.adhdy-now{background:rgba(var(--adhdy-argb),.28);color:#fff;font-weight:600}',
    '#adhdy-mini{all:initial;position:fixed;top:16px;right:16px;z-index:2147483646;width:40px;height:40px;border-radius:50%;background:' + ACCENT + ';color:#fff;font:20px/40px system-ui;text-align:center;cursor:grab;touch-action:none;box-shadow:0 4px 16px rgba(0,0,0,.4);display:none}',
    /* mobile: panel becomes a bottom sheet, toast moves to the top */
    '@media (max-width:640px){' +
      '#adhdy-panel{top:auto;bottom:10px;left:10px;right:10px;width:auto;max-height:60vh;overflow-y:auto}' +
      '#adhdy-panel .adhdy-grid{grid-template-columns:1fr 1fr 1fr}' +
      '#adhdy-panel .adhdy-t{padding:10px 4px;font-size:13px}' +
      '#adhdy-panel .adhdy-tm{padding:9px 0;font-size:12px}' +
      '#adhdy-panel .adhdy-x{font-size:19px;padding:4px 10px}' +
      '#adhdy-panel .adhdy-th{width:22px;height:22px}' +
      '#adhdy-map{max-height:130px}' +
      '#adhdy-mini{top:auto;bottom:16px;width:48px;height:48px;font:24px/48px system-ui}' +
      '#adhdy-toast{bottom:auto;top:12px;left:12px;right:12px;max-width:none}' +
    '}'
  ].join('\n');
  doc.head.appendChild(style);

  /* ---------------------------------------------------------------- themes */

  // All dark; accent-text is the text color on accent-filled buttons and is
  // picked per theme for contrast. argb/shade are r,g,b triplets used in
  // rgba() tints.
  var THEMES = {
    teal: { label: 'Teal', accent: '#14b8a6', argb: '20,184,166', accentText: '#052e28',
      bg: '#16211e', surface: '#20302b', border: '#33473f', hover: '#2a3d36',
      muted: '#9cb5ac', btn: '#d2e6de', text: '#ecf5f1', dim2: '#6e857c', shade: '6,20,17' },
    violet: { label: 'Violet', accent: '#7c5cff', argb: '124,92,255', accentText: '#ffffff',
      bg: '#211d33', surface: '#2a2542', border: '#3a3355', hover: '#332c4f',
      muted: '#a49ec4', btn: '#cfc9e8', text: '#eceaf6', dim2: '#6f6a8a', shade: '15,12,35' },
    ember: { label: 'Ember', accent: '#f59e0b', argb: '245,158,11', accentText: '#2a1a00',
      bg: '#231d14', surface: '#2e2619', border: '#46392a', hover: '#3a3021',
      muted: '#b3a88e', btn: '#e4dbc6', text: '#f4efe4', dim2: '#857a63', shade: '20,15,5' },
    ocean: { label: 'Ocean', accent: '#38bdf8', argb: '56,189,248', accentText: '#05263a',
      bg: '#131f27', surface: '#1c2b35', border: '#2d4453', hover: '#24394a',
      muted: '#93aebf', btn: '#cbdfec', text: '#eaf3f9', dim2: '#66808f', shade: '5,15,23' },
    rose: { label: 'Rose', accent: '#f472b6', argb: '244,114,182', accentText: '#3d0a24',
      bg: '#251a20', surface: '#30222a', border: '#4a3440', hover: '#3d2a34',
      muted: '#b899a8', btn: '#e6ccd7', text: '#f6ecf1', dim2: '#8a6e7b', shade: '25,8,18' }
  };
  var THEME_VARS = { accent: 'accent', argb: 'argb', accentText: 'accent-text',
    bg: 'bg', surface: 'surface', border: 'border', hover: 'hover',
    muted: 'muted', btn: 'btn', text: 'text', dim2: 'dim2', shade: 'shade' };
  var themeName = 'teal', themeDots = {};

  function applyTheme(name) {
    themeName = THEMES[name] ? name : 'teal';
    var t = THEMES[themeName];
    Object.keys(THEME_VARS).forEach(function (k) {
      html.style.setProperty('--adhdy-' + THEME_VARS[k], t[k]);
    });
    Object.keys(themeDots).forEach(function (n) {
      themeDots[n].classList.toggle('adhdy-on', n === themeName);
      themeDots[n].setAttribute('aria-pressed', String(n === themeName));
    });
  }

  /* -------------------------------------------------------------- features */

  var features = {};   // name -> {on, off, label}
  var state = {};      // name -> bool
  var totalWords = 0;

  // -- focus spotlight ------------------------------------------------------
  var BLOCK_SEL = 'p,li,h1,h2,h3,h4,h5,h6,pre,blockquote,dt,dd,figcaption';
  var blocks = [], curBlock = null, focusRaf = 0;

  function collectLeafBlocks() {
    var out = [];
    root.querySelectorAll(BLOCK_SEL).forEach(function (el) {
      if (el.closest('#adhdy-panel')) return;
      if (el.querySelector(BLOCK_SEL)) return; // keep leaf blocks only
      out.push(el);
    });
    return out;
  }

  function pickFrom(list, y) {
    var best = null, bestDist = Infinity;
    for (var i = 0; i < list.length; i++) {
      var r = list[i].getBoundingClientRect();
      if (!r.height) continue;
      if (r.bottom < 0 || r.top > innerHeight) continue;
      var mid = (r.top + r.bottom) / 2;
      var d = (y >= r.top && y <= r.bottom) ? 0 : Math.min(Math.abs(mid - y), Math.abs(r.top - y));
      if (d < bestDist) { bestDist = d; best = list[i]; }
    }
    return best;
  }
  function pickBlockAt(y) { return pickFrom(blocks, y); }
  function setCur(el) {
    if (el === curBlock) return;
    if (curBlock) curBlock.classList.remove('adhdy-cur');
    curBlock = el;
    if (curBlock) curBlock.classList.add('adhdy-cur');
  }

  // When Chunks has split the current paragraph, narrow the spotlight to one
  // chunk: paint the paragraph's other chunks with faded text via the Custom
  // Highlight API. Paint-only — no DOM mutation, so reversibility holds.
  // Browsers without the API keep whole-paragraph highlighting.
  var canHl = typeof Highlight === 'function' && window.CSS && CSS.highlights;
  // The fade color is computed from the paragraph's real text color at the
  // same alpha Focus uses for opacity, so a dimmed chunk looks exactly like
  // a dimmed paragraph. (currentColor inside ::highlight resolves
  // inconsistently across browsers, so we can't do this in static CSS.)
  var hlStyle = doc.createElement('style');
  hlStyle.id = 'adhdy-hlstyle';
  doc.head.appendChild(hlStyle);
  function setChunkDimColor(el) {
    var m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(getComputedStyle(el).color);
    var faded = m ?
      'rgba(' + m[1] + ',' + m[2] + ',' + m[3] + ',' + DIM + ')' :
      'rgba(128,128,128,' + DIM + ')';
    if (hlStyle.__c !== faded) {
      hlStyle.__c = faded;
      hlStyle.textContent = '::highlight(adhdy-dim){color:' + faded + '}';
    }
  }
  var lastHlBlock = null, lastHlIdx = -1;
  function clearChunkDim() {
    lastHlBlock = null; lastHlIdx = -1;
    if (canHl) CSS.highlights.delete('adhdy-dim');
  }
  function chunkRanges(p) {
    var gaps = p.querySelectorAll('span.adhdy-gap');
    if (!gaps.length) return null;
    var ranges = [], r = doc.createRange();
    r.setStart(p, 0);
    gaps.forEach(function (g) {
      r.setEndBefore(g);
      ranges.push(r);
      r = doc.createRange();
      r.setStartAfter(g);
    });
    r.setEnd(p, p.childNodes.length);
    ranges.push(r);
    return ranges;
  }
  function applyChunkDim(block, ranges, bestI) {
    // Same paragraph, same chunk: the registered ranges are live, skip the
    // rebuild (mousemove calls this constantly).
    if (block === lastHlBlock && bestI === lastHlIdx) return;
    lastHlBlock = block; lastHlIdx = bestI;
    setChunkDimColor(block);
    var hl = new Highlight();
    ranges.forEach(function (rg, i) { if (i !== bestI) hl.add(rg); });
    CSS.highlights.set('adhdy-dim', hl);
  }
  function updateChunkDim(y) {
    if (!canHl) return;
    if (!curBlock || !state.chunks) { clearChunkDim(); return; }
    var ranges = chunkRanges(curBlock);
    if (!ranges || ranges.length < 2) { clearChunkDim(); return; }
    var bestI = 0, bestD = Infinity;
    ranges.forEach(function (rg, i) {
      var rect = rg.getBoundingClientRect();
      if (!rect.height) return;
      var mid = (rect.top + rect.bottom) / 2;
      var d = (y >= rect.top && y <= rect.bottom) ? 0 :
        Math.min(Math.abs(mid - y), Math.abs(rect.top - y));
      if (d < bestD) { bestD = d; bestI = i; }
    });
    applyChunkDim(curBlock, ranges, bestI);
  }

  // -- keyboard pager: j / k / space step the spotlight chunk by chunk --------
  var pagerHold = 0; // suppress cursor/scroll re-picking while we glide

  function pagerStep(dir) {
    if (!blocks.length) return false;
    var block = (curBlock && blocks.indexOf(curBlock) > -1) ? curBlock
      : (pickBlockAt(innerHeight * 0.38) || blocks[0]);
    var useChunks = state.chunks && canHl;
    var ranges = useChunks ? chunkRanges(block) : null;
    if (ranges && ranges.length < 2) ranges = null;
    var ci = (ranges && block === lastHlBlock) ? lastHlIdx
      : (dir > 0 ? -1 : (ranges ? ranges.length : 1));
    if (ranges && ci + dir >= 0 && ci + dir < ranges.length) {
      ci += dir; // next/prev chunk within the same paragraph
    } else {
      var bi = blocks.indexOf(block) + dir;
      if (bi < 0 || bi >= blocks.length) return false;
      block = blocks[bi];
      ranges = useChunks ? chunkRanges(block) : null;
      if (ranges && ranges.length < 2) ranges = null;
      ci = ranges ? (dir > 0 ? 0 : ranges.length - 1) : 0;
    }
    setCur(block);
    if (ranges) applyChunkDim(block, ranges, ci);
    else clearChunkDim();
    var rect = ranges ? ranges[ci].getBoundingClientRect()
      : block.getBoundingClientRect();
    pagerHold = Date.now() + 900;
    rulerSnapTo(rect);
    try {
      scrollBy({ top: rect.top - innerHeight * 0.38, behavior: motionOK ? 'smooth' : 'auto' });
    } catch (e) { scrollBy(0, rect.top - innerHeight * 0.38); }
    return true;
  }
  function pagerKeys(e) {
    if (!state.focus || e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (t && ((t.closest && t.closest('#adhdy-panel')) ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') || t.isContentEditable)) return;
    var dir = 0;
    if (e.key === 'j' || (e.key === ' ' && !e.shiftKey)) dir = 1;
    else if (e.key === 'k' || (e.key === ' ' && e.shiftKey)) dir = -1;
    else return;
    if (pagerStep(dir)) e.preventDefault();
    // at the very start/end pagerStep declines and space keeps its default
  }
  on(doc, 'keydown', pagerKeys);

  function focusScroll() {
    if (focusRaf) return;
    focusRaf = requestAnimationFrame(function () {
      focusRaf = 0;
      if (!state.focus || Date.now() < pagerHold) return;
      var y = innerHeight * 0.38;
      setCur(pickBlockAt(y));
      updateChunkDim(y);
    });
  }
  function focusMove(e) {
    if (!state.focus || Date.now() < pagerHold) return;
    var el = e.target && e.target.closest && e.target.closest(BLOCK_SEL);
    if (el && blocks.indexOf(el) > -1) {
      setCur(el);
      updateChunkDim(e.clientY);
    }
  }
  features.focus = {
    label: 'Focus',
    on: function () {
      blocks = collectLeafBlocks();
      blocks.forEach(function (el) { el.classList.add('adhdy-block'); });
      html.classList.add('adhdy-focus');
      var y = innerHeight * 0.38;
      setCur(pickBlockAt(y));
      updateChunkDim(y);
    },
    off: function () {
      html.classList.remove('adhdy-focus');
      setCur(null);
      clearChunkDim();
      blocks.forEach(function (el) { el.classList.remove('adhdy-block'); });
      blocks = [];
    }
  };
  on(window, 'scroll', focusScroll, { passive: true });
  on(doc, 'mousemove', focusMove, { passive: true });

  // -- reading ruler --------------------------------------------------------
  var ruler = null, rulerSnapT = 0, lastMX = -1, lastMY = -1;
  function rulerMove(e) {
    var t = e.touches && e.touches[0];
    var y = t ? t.clientY : e.clientY;
    var x = t ? t.clientX : e.clientX;
    if (typeof y !== 'number') return;
    // Track travel so a tiny jiggle (brushing the mouse while typing j/k)
    // doesn't knock the ruler off a snapped chunk.
    var travel = lastMX < 0 ? 0 : Math.abs((x || 0) - lastMX) + Math.abs(y - lastMY);
    lastMX = x || 0; lastMY = y;
    if (!ruler) return;
    if (ruler.classList.contains('adhdy-snap')) {
      if (travel < 6) return;
      // ease back to the normal band at the cursor, then track instantly
      ruler.style.height = '96px';
      ruler.style.top = (y - 48) + 'px';
      clearTimeout(rulerSnapT);
      rulerSnapT = setTimeout(function () {
        if (ruler) ruler.classList.remove('adhdy-snap');
      }, 280);
      return;
    }
    ruler.style.top = (y - 48) + 'px';
  }
  function rulerSnapTo(rect) {
    // Wrap the chunk at its post-scroll position: pagerStep lands the chunk's
    // top at 38% of the viewport, so park the ruler there and let the text
    // glide into it.
    if (!ruler) return;
    ruler.classList.add('adhdy-snap');
    ruler.style.top = (innerHeight * 0.38 - 8) + 'px';
    ruler.style.height = (rect.height + 16) + 'px';
  }
  features.ruler = {
    label: 'Ruler',
    on: function () {
      ruler = doc.createElement('div');
      ruler.id = 'adhdy-ruler';
      ruler.setAttribute('aria-hidden', 'true');
      ruler.style.top = (innerHeight * 0.35) + 'px';
      doc.body.appendChild(ruler);
    },
    off: function () {
      clearTimeout(rulerSnapT);
      if (ruler) ruler.remove();
      ruler = null;
    }
  };
  on(doc, 'mousemove', rulerMove, { passive: true });
  on(doc, 'touchmove', rulerMove, { passive: true });

  // -- bionic bolding -------------------------------------------------------
  function textNodesUnder(el, skipSel) {
    var out = [], w = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!/\S/.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
        var p = n.parentElement;
        if (!p || p.closest(skipSel)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    while (w.nextNode()) out.push(w.currentNode);
    return out;
  }
  features.bionic = {
    label: 'Bionic',
    on: function () {
      textNodesUnder(root, 'code,pre,script,style,textarea,#adhdy-panel,b.adhdy-bio')
        .forEach(function (n) {
          var parts = n.nodeValue.split(/(\s+)/);
          var frag = doc.createDocumentFragment();
          parts.forEach(function (word) {
            var m = /^([A-Za-zÀ-ɏЀ-ӿ]{2,})(.*)$/.exec(word);
            if (!m) { frag.appendChild(doc.createTextNode(word)); return; }
            var cut = Math.max(1, Math.ceil(m[1].length * 0.42));
            var b = doc.createElement('b');
            b.className = 'adhdy-bio';
            b.textContent = m[1].slice(0, cut);
            frag.appendChild(b);
            frag.appendChild(doc.createTextNode(m[1].slice(cut) + m[2]));
          });
          // Merge adjacent text pieces ("endix." + " ") back into single
          // nodes, so sentence-end detection in Chunks still works.
          frag.normalize();
          n.parentNode.replaceChild(frag, n);
        });
    },
    off: function () {
      root.querySelectorAll('b.adhdy-bio').forEach(function (b) {
        b.replaceWith(doc.createTextNode(b.textContent));
      });
      root.normalize();
    }
  };

  // -- paragraph chunking ---------------------------------------------------
  var SENT_END = /[.!?][)"'’”]*\s+/g;
  features.chunks = {
    label: 'Chunks',
    on: function () {
      root.querySelectorAll('p').forEach(function (p) {
        if (p.closest('#adhdy-panel') || p.textContent.length < CHUNK_MIN * 1.5) return;
        var since = 0;
        var nodes = textNodesUnder(p, 'code,#adhdy-panel');
        var mkGap = function () {
          var gap = doc.createElement('span');
          gap.className = 'adhdy-gap';
          gap.setAttribute('aria-hidden', 'true');
          return gap;
        };
        for (var i = 0; i < nodes.length; i++) {
          var node = nodes[i], from = 0;
          for (;;) {
            SENT_END.lastIndex = from;
            var m = SENT_END.exec(node.nodeValue);
            if (!m) { since += node.nodeValue.length - from; break; }
            var end = m.index + m[0].length;
            if (since + (end - from) < CHUNK_MIN) {
              since += end - from; from = end;
            } else if (end < node.nodeValue.length) {
              var rest = node.splitText(end);
              node.after(mkGap());
              node = rest; from = 0; since = 0;
            } else {
              // Sentence ends exactly at this node's boundary (common once
              // bionic has fragmented the text) — drop the gap after it,
              // unless this is the paragraph's last text node.
              if (i < nodes.length - 1) { node.after(mkGap()); since = 0; }
              break;
            }
          }
        }
      });
      if (canHl) html.classList.add('adhdy-nofade');
      if (state.focus) updateChunkDim(innerHeight * 0.38);
    },
    off: function () {
      html.classList.remove('adhdy-nofade');
      clearChunkDim(); // chunk ranges are about to go stale
      root.querySelectorAll('span.adhdy-gap').forEach(function (g) {
        var p = g.parentNode;
        g.remove();
        if (p) p.normalize();
      });
    }
  };

  // -- comfy text -----------------------------------------------------------
  var PREFS_DEF = { fs: 1.05, lh: 1.8, w: 70 };
  var COMFY_MAX_W = 200; // slider's top value; at max the width cap lifts entirely
  var prefs = Object.assign({}, PREFS_DEF);
  function applyPrefs() {
    root.style.setProperty('--adhdy-fs', prefs.fs + 'em');
    root.style.setProperty('--adhdy-lh', prefs.lh);
    root.style.setProperty('--adhdy-w', prefs.w >= COMFY_MAX_W ? 'none' : prefs.w + 'ch');
  }
  features.comfy = {
    label: 'Comfy',
    on: function () {
      applyPrefs();
      root.classList.add('adhdy-comfy');
      sliders.style.display = 'block';
    },
    off: function () {
      root.classList.remove('adhdy-comfy');
      ['--adhdy-fs', '--adhdy-lh', '--adhdy-w'].forEach(function (v) {
        root.style.removeProperty(v);
      });
      sliders.style.display = 'none';
    }
  };

  // -- declutter ------------------------------------------------------------
  features.clean = {
    label: 'Declutter',
    on: function () {
      // Hide fixed/sticky things (cookie bars, share rails) that aren't ours.
      doc.body.querySelectorAll('div,section,header').forEach(function (el) {
        if (el.id && el.id.indexOf('adhdy') === 0) return;
        if (el.closest('#adhdy-panel') || root.contains(el) || el.contains(root)) return;
        var pos = getComputedStyle(el).position;
        if (pos === 'fixed' || pos === 'sticky') el.classList.add('adhdy-hidefixed');
      });
      html.classList.add('adhdy-clean');
    },
    off: function () {
      html.classList.remove('adhdy-clean');
      doc.querySelectorAll('.adhdy-hidefixed').forEach(function (el) {
        el.classList.remove('adhdy-hidefixed');
      });
    }
  };

  // -- section check-off ----------------------------------------------------
  function sectionEls(h) {
    var lvl = +h.tagName[1], out = [], el = h.nextElementSibling;
    while (el) {
      if (/^H[1-6]$/.test(el.tagName) && +el.tagName[1] <= lvl) break;
      out.push(el);
      el = el.nextElementSibling;
    }
    return out;
  }
  features.sections = {
    label: 'Check off',
    on: function () {
      root.querySelectorAll('h2,h3').forEach(function (h) {
        if (h.closest('#adhdy-panel') || h.querySelector('button.adhdy-check')) return;
        var btn = doc.createElement('button');
        btn.className = 'adhdy-check';
        btn.type = 'button';
        btn.textContent = '✓';
        btn.title = 'Mark section done (collapses it)';
        btn.setAttribute('aria-label', 'Mark section done');
        btn.setAttribute('aria-pressed', 'false');
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var done = btn.classList.toggle('adhdy-on');
          btn.setAttribute('aria-pressed', String(done));
          h.classList.toggle('adhdy-done', done);
          sectionEls(h).forEach(function (el) {
            el.classList.toggle('adhdy-folded', done);
          });
          updateMap();
        });
        h.insertBefore(btn, h.firstChild);
      });
    },
    off: function () {
      root.querySelectorAll('button.adhdy-check').forEach(function (b) { b.remove(); });
      root.querySelectorAll('.adhdy-folded').forEach(function (el) { el.classList.remove('adhdy-folded'); });
      root.querySelectorAll('.adhdy-done').forEach(function (el) { el.classList.remove('adhdy-done'); });
    }
  };

  // -- progress bar + time left ---------------------------------------------
  var bar = null, eta = null, progRaf = 0;
  function progScroll() {
    if (progRaf || !state.progress) return;
    progRaf = requestAnimationFrame(function () {
      progRaf = 0;
      if (!bar) return;
      var max = html.scrollHeight - innerHeight;
      var frac = max > 0 ? Math.min(1, (scrollY || html.scrollTop) / max) : 1;
      bar.style.width = (frac * 100) + '%';
      maybeCelebrate(frac);
      if (eta) {
        var mins = Math.ceil(totalWords * (1 - frac) / WPM);
        eta.textContent = frac >= 1 ? '✓ done — nice.' :
          '≈ ' + mins + ' min left · ' + Math.round(frac * 100) + '%';
      }
    });
  }
  features.progress = {
    label: 'Progress',
    on: function () {
      if (!totalWords) totalWords = countWords();
      bar = doc.createElement('div');
      bar.id = 'adhdy-progress';
      bar.setAttribute('aria-hidden', 'true');
      doc.body.appendChild(bar);
      if (eta) eta.style.display = '';
      progScroll();
    },
    off: function () {
      if (bar) bar.remove(); bar = null;
      if (eta) { eta.style.display = 'none'; }
    }
  };
  on(window, 'scroll', progScroll, { passive: true });
  on(window, 'resize', progScroll, { passive: true });

  // Confetti when the progress bar first crosses 100% (requires an actual
  // scroll transition, so enabling at the bottom of a page doesn't fire it).
  var lastFrac = 1, celebrated = false;
  function maybeCelebrate(frac) {
    if (!celebrated && lastFrac < 0.99 && frac >= 1) {
      celebrated = true;
      if (motionOK) {
        var emoji = ['🎉', '✨', '⭐', '🎊', '💚'];
        for (var i = 0; i < 22; i++) {
          var s = doc.createElement('span');
          s.className = 'adhdy-confetti';
          s.setAttribute('aria-hidden', 'true');
          s.textContent = emoji[i % emoji.length];
          s.style.left = (Math.random() * 100) + 'vw';
          s.style.animationDelay = (Math.random() * 0.5) + 's';
          doc.body.appendChild(s);
          setTimeout(function (el) { el.remove(); }.bind(null, s), 2600);
        }
      }
      if (eta) { eta.style.cursor = 'pointer'; eta.title = 'Copy your session receipt'; }
      var t = toast('🎉 You finished! Click here to copy a session receipt for your notes.');
      t.__act = copyReceipt;
    }
    lastFrac = frac;
  }

  /* -------------------------------------------------------- session receipt */

  function buildReceipt() {
    var lines = ['# ' + (doc.title || 'Article').trim(), ''];
    var why = note.value.trim();
    if (why) lines.push('🎯 Why I was here: ' + why);
    var mins = Math.max(1, Math.round((Date.now() - startTime) / 60000));
    lines.push('⏱ Session: ~' + mins + ' min · ~' + (totalWords || countWords()) + ' words');
    var done = [];
    root.querySelectorAll('h2.adhdy-done,h3.adhdy-done').forEach(function (h) {
      done.push(h.textContent.replace(/^✓\s*/, '').trim());
    });
    if (done.length) {
      lines.push('', '## Sections checked off');
      done.forEach(function (t) { lines.push('- [x] ' + t); });
    }
    lines.push('', '🔗 ' + location.href);
    return lines.join('\n');
  }
  function legacyCopy(text) {
    var ta = doc.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    doc.body.appendChild(ta);
    ta.select();
    try { doc.execCommand('copy'); } catch (e) {}
    ta.remove();
  }
  function copyReceipt() {
    var text = buildReceipt();
    var ok = function () { toast('📋 Receipt copied — paste it into your notes.'); };
    try {
      navigator.clipboard.writeText(text).then(ok, function () { legacyCopy(text); ok(); });
    } catch (e) { legacyCopy(text); ok(); }
  }

  /* ---------------------------------------------------------------- toast */

  var toastEl = null, toastTimer = 0;
  function toast(msg) {
    if (!toastEl) {
      toastEl = doc.createElement('div');
      toastEl.id = 'adhdy-toast';
      toastEl.setAttribute('role', 'status');
      toastEl.addEventListener('click', function () {
        toastEl.style.display = 'none';
        if (toastEl.__act) { var a = toastEl.__act; toastEl.__act = null; a(); }
      });
      doc.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.__act = null;
    toastEl.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.style.display = 'none'; }, 8000);
    return toastEl;
  }

  // -- link guard -------------------------------------------------------------
  // A second click/tap on the same link within 1.5s follows it — double-click
  // works on desktop, and a deliberate re-tap works on touch screens.
  var guardHinted = false, guardLast = null, guardLastT = 0;
  function guardClick(e) {
    if (!state.guard) return;
    var a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a || a.closest('#adhdy-panel')) return;
    var now = Date.now();
    if (e.detail >= 2 || (guardLast === a && now - guardLastT < 1500)) {
      guardLast = null;
      return;
    }
    guardLast = a; guardLastT = now;
    e.preventDefault();
    e.stopPropagation();
    if (!guardHinted) { guardHinted = true; toast('🐇 Link guard: click a link twice when you really mean it.'); }
  }
  features.guard = {
    label: 'Link guard',
    on: function () { guardHinted = false; html.classList.add('adhdy-guard'); },
    off: function () { html.classList.remove('adhdy-guard'); }
  };
  on(doc, 'click', guardClick, true);

  // -- calm (freeze motion) -----------------------------------------------------
  var pausedVids = [];
  features.calm = {
    label: 'Calm',
    on: function () {
      html.classList.add('adhdy-calm');
      doc.querySelectorAll('video').forEach(function (v) {
        if (!v.paused) { v.pause(); pausedVids.push(v); }
        v.removeAttribute('autoplay');
      });
    },
    off: function () {
      html.classList.remove('adhdy-calm');
      pausedVids.forEach(function (v) { try { v.play(); } catch (e) {} });
      pausedVids = [];
    }
  };

  // -- section map ------------------------------------------------------------
  var mapEl = null, mapRows = [], mapRaf = 0;
  function updateMap() {
    if (!state.map || !mapRows.length) return;
    var y = innerHeight * 0.4, curIdx = -1;
    for (var i = 0; i < mapRows.length; i++) {
      if (mapRows[i].h.getBoundingClientRect().top < y) curIdx = i;
    }
    mapRows.forEach(function (m, i) {
      var done = m.h.classList.contains('adhdy-done');
      var past = curIdx > -1 && i < curIdx;
      m.row.classList.toggle('adhdy-now', i === curIdx);
      m.row.classList.toggle('adhdy-read', done || past);
      m.row.textContent =
        (done ? '✓ ' : i === curIdx ? '▸ ' : past ? '· ' : '○ ') + m.title;
    });
  }
  function mapScroll() {
    if (mapRaf) return;
    mapRaf = requestAnimationFrame(function () { mapRaf = 0; updateMap(); });
  }
  features.map = {
    label: 'Map',
    on: function () {
      mapRows = [];
      mapEl.textContent = '';
      root.querySelectorAll('h2,h3').forEach(function (h) {
        if (h.closest('#adhdy-panel')) return;
        // strip the Check off feature's "✓" glyph from the title
        var t = h.textContent.replace(/^✓\s*/, '').trim();
        if (!t) return;
        var row = doc.createElement('div');
        row.className = 'adhdy-mrow' + (h.tagName === 'H3' ? ' adhdy-sub' : '');
        row.title = t;
        row.setAttribute('role', 'button');
        row.setAttribute('tabindex', '0');
        row.addEventListener('click', function () {
          try { h.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
          catch (e) { h.scrollIntoView(); }
        });
        mapRows.push({ h: h, row: row, title: t });
        mapEl.appendChild(row);
      });
      mapEl.style.display = 'block';
      updateMap();
    },
    off: function () {
      mapEl.style.display = 'none';
      mapEl.textContent = '';
      mapRows = [];
    }
  };
  on(window, 'scroll', mapScroll, { passive: true });

  /* --------------------------------------------------------- sprint timer */

  var timerEnd = 0, timerInt = 0, timerCtx = null, clock = null;
  function chime() {
    try {
      if (!timerCtx) return;
      timerCtx.resume();
      [880, 1174].forEach(function (f, i) {
        var o = timerCtx.createOscillator(), g = timerCtx.createGain();
        var t = timerCtx.currentTime + i * 0.2;
        o.frequency.value = f;
        o.connect(g); g.connect(timerCtx.destination);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
        o.start(t); o.stop(t + 0.45);
      });
    } catch (e) {}
  }
  function timerTick() {
    var left = timerEnd - Date.now();
    if (left <= 0) {
      stopTimer();
      clock.textContent = '🎉 break time!';
      chime();
      toast('⏱ Sprint done — stand up, shake it off, water.');
      return;
    }
    var m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
    clock.textContent = '⏱ ' + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function startTimer(mins) {
    // Created on the button click so the browser's autoplay policy lets the
    // chime play when the timer fires minutes later.
    try { timerCtx = timerCtx || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    timerEnd = Date.now() + mins * 60000;
    clearInterval(timerInt);
    timerInt = setInterval(timerTick, 1000);
    timerTick();
  }
  function stopTimer() {
    clearInterval(timerInt);
    timerInt = 0;
  }

  /* ----------------------------------------------------------------- panel */

  var ORDER = ['focus', 'ruler', 'bionic', 'chunks', 'comfy', 'clean',
               'sections', 'progress', 'map', 'guard', 'calm'];
  var panel = doc.createElement('div');
  panel.id = 'adhdy-panel';
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'LockIn reading tools');
  var mini = doc.createElement('div');
  mini.id = 'adhdy-mini';
  mini.textContent = '🧠';
  mini.title = 'LockIn';
  mini.setAttribute('role', 'button');
  mini.setAttribute('tabindex', '0');
  mini.setAttribute('aria-label', 'Open the LockIn panel');
  mini.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); mini.click(); }
  });

  var head = doc.createElement('div');
  head.className = 'adhdy-head';
  var title = doc.createElement('span');
  title.className = 'adhdy-title';
  title.textContent = '🧠 LockIn';
  var minBtn = doc.createElement('button');
  minBtn.className = 'adhdy-x';
  minBtn.textContent = '–';
  minBtn.title = 'Minimize';
  var closeBtn = doc.createElement('button');
  closeBtn.className = 'adhdy-x';
  closeBtn.textContent = '×';
  closeBtn.title = 'Turn everything off and remove';
  head.appendChild(title); head.appendChild(minBtn); head.appendChild(closeBtn);
  panel.appendChild(head);

  // "Why am I here?" — an intention anchor, remembered per article.
  var NOTE_KEY = 'adhdy-note:' + location.host + location.pathname;
  var note = doc.createElement('input');
  note.id = 'adhdy-note';
  note.type = 'text';
  note.placeholder = '🎯 Why am I here?';
  note.title = 'Write down what you came to find out — it stays pinned here.';
  try { note.value = localStorage.getItem(NOTE_KEY) || ''; } catch (e) {}
  note.addEventListener('input', function () {
    try {
      if (note.value.trim()) localStorage.setItem(NOTE_KEY, note.value);
      else localStorage.removeItem(NOTE_KEY);
    } catch (e) {}
  });
  panel.appendChild(note);

  var grid = doc.createElement('div');
  grid.className = 'adhdy-grid';
  var btns = {};
  ORDER.forEach(function (name) {
    var b = doc.createElement('button');
    b.className = 'adhdy-t';
    b.type = 'button';
    b.textContent = features[name].label;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', function () { setFeature(name, !state[name]); });
    btns[name] = b;
    grid.appendChild(b);
  });
  panel.appendChild(grid);

  var sliders = doc.createElement('div');
  sliders.id = 'adhdy-sliders';
  var slInputs = {};
  [{ key: 'fs', icon: 'A',  min: 0.9, max: 1.4, step: 0.05, name: 'Text size' },
   { key: 'lh', icon: '↕', min: 1.4, max: 2.4, step: 0.1,  name: 'Line spacing' },
   { key: 'w',  icon: '⇔', min: 45,  max: COMFY_MAX_W, step: 5, name: 'Column width' }
  ].forEach(function (s) {
    var lab = doc.createElement('label');
    lab.title = s.name;
    var ic = doc.createElement('span');
    ic.textContent = s.icon;
    var inp = doc.createElement('input');
    inp.type = 'range';
    inp.min = s.min; inp.max = s.max; inp.step = s.step;
    inp.value = prefs[s.key];
    inp.setAttribute('aria-label', s.name);
    inp.addEventListener('input', function () {
      prefs[s.key] = +inp.value;
      applyPrefs();
      save();
    });
    slInputs[s.key] = inp;
    lab.appendChild(ic); lab.appendChild(inp);
    sliders.appendChild(lab);
  });
  panel.appendChild(sliders);

  var row = doc.createElement('div');
  row.className = 'adhdy-row';
  [10, 15, 25].forEach(function (mins) {
    var b = doc.createElement('button');
    b.className = 'adhdy-tm';
    b.type = 'button';
    b.textContent = mins + 'm';
    b.title = 'Start a ' + mins + '-minute reading sprint';
    b.addEventListener('click', function () { startTimer(mins); });
    row.appendChild(b);
  });
  clock = doc.createElement('span');
  clock.className = 'adhdy-clock';
  clock.textContent = '⏱ sprint';
  clock.title = 'Click to stop the timer';
  clock.addEventListener('click', function () {
    stopTimer();
    clock.textContent = '⏱ sprint';
  });
  row.appendChild(clock);
  panel.appendChild(row);

  mapEl = doc.createElement('div');
  mapEl.id = 'adhdy-map';
  mapEl.setAttribute('aria-label', 'Section map');
  mapEl.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('adhdy-mrow')) {
      e.preventDefault();
      e.target.click();
    }
  });
  panel.appendChild(mapEl);

  eta = doc.createElement('div');
  eta.className = 'adhdy-eta';
  eta.style.display = 'none';
  eta.setAttribute('aria-live', 'off');
  eta.addEventListener('click', function () { if (celebrated) copyReceipt(); });
  panel.appendChild(eta);

  var themesRow = doc.createElement('div');
  themesRow.className = 'adhdy-themes';
  themesRow.setAttribute('role', 'group');
  themesRow.setAttribute('aria-label', 'Color theme');
  Object.keys(THEMES).forEach(function (name) {
    var d = doc.createElement('button');
    d.className = 'adhdy-th';
    d.type = 'button';
    d.style.background = THEMES[name].accent;
    d.title = THEMES[name].label + ' theme';
    d.setAttribute('aria-label', THEMES[name].label + ' theme');
    d.setAttribute('aria-pressed', 'false');
    d.addEventListener('click', function () { applyTheme(name); save(); });
    themeDots[name] = d;
    themesRow.appendChild(d);
  });
  panel.appendChild(themesRow);

  doc.body.appendChild(panel);
  doc.body.appendChild(mini);

  minBtn.addEventListener('click', function () {
    panel.style.display = 'none';
    mini.style.display = 'block';
  });
  mini.addEventListener('click', function () {
    if (miniMoved) { miniMoved = false; return; } // that click ended a drag, not a tap
    mini.style.display = 'none';
    panel.style.display = 'block';
  });
  closeBtn.addEventListener('click', destroy);

  /* ------------------------------------------------------------- drag */

  // Drag the panel by its header. Mobile (<=640px) uses a fixed bottom
  // sheet layout instead (see the media query above), so dragging is
  // desktop-only.
  var dragging = false, dragOffX = 0, dragOffY = 0;
  function dragStart(e) {
    if (e.target.closest && e.target.closest('.adhdy-x')) return;
    if (innerWidth <= 640) return;
    var r = panel.getBoundingClientRect();
    dragging = true;
    dragOffX = e.clientX - r.left;
    dragOffY = e.clientY - r.top;
    panel.style.left = r.left + 'px';
    panel.style.top = r.top + 'px';
    panel.style.right = 'auto';
    head.style.cursor = 'grabbing';
    try { head.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  }
  function dragMove(e) {
    if (!dragging) return;
    var x = Math.min(Math.max(0, e.clientX - dragOffX), innerWidth - panel.offsetWidth);
    var y = Math.min(Math.max(0, e.clientY - dragOffY), innerHeight - panel.offsetHeight);
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
  }
  function dragEnd() {
    dragging = false;
    head.style.cursor = 'grab';
  }
  on(head, 'pointerdown', dragStart);
  on(doc, 'pointermove', dragMove);
  on(doc, 'pointerup', dragEnd);
  on(window, 'resize', function () {
    // Hand layout back to the mobile bottom-sheet CSS once we cross the
    // breakpoint, undoing any inline position left over from a desktop drag.
    if (innerWidth <= 640) {
      panel.style.left = ''; panel.style.top = ''; panel.style.right = '';
    }
  }, { passive: true });

  // The minimized bubble is itself the click target, so a drag is told
  // apart from a tap by a small movement threshold; crossing it suppresses
  // the click that would otherwise fire on release (handled above).
  var miniDragging = false, miniMoved = false;
  var miniStartX = 0, miniStartY = 0, miniOffX = 0, miniOffY = 0;
  function miniDragStart(e) {
    var r = mini.getBoundingClientRect();
    miniDragging = true;
    miniMoved = false;
    miniStartX = e.clientX; miniStartY = e.clientY;
    miniOffX = e.clientX - r.left;
    miniOffY = e.clientY - r.top;
    try { mini.setPointerCapture(e.pointerId); } catch (err) {}
  }
  function miniDragMove(e) {
    if (!miniDragging) return;
    if (!miniMoved) {
      if (Math.abs(e.clientX - miniStartX) + Math.abs(e.clientY - miniStartY) < 4) return;
      miniMoved = true;
      mini.style.right = 'auto';
      mini.style.bottom = 'auto';
    }
    var x = Math.min(Math.max(0, e.clientX - miniOffX), innerWidth - mini.offsetWidth);
    var y = Math.min(Math.max(0, e.clientY - miniOffY), innerHeight - mini.offsetHeight);
    mini.style.left = x + 'px';
    mini.style.top = y + 'px';
    e.preventDefault();
  }
  function miniDragEnd() {
    miniDragging = false;
  }
  on(mini, 'pointerdown', miniDragStart);
  on(doc, 'pointermove', miniDragMove);
  on(doc, 'pointerup', miniDragEnd);

  /* ------------------------------------------------------- state & wiring */

  function setFeature(name, val, skipSave) {
    val = !!val;
    if (state[name] === val) return;
    state[name] = val;
    try { val ? features[name].on() : features[name].off(); }
    catch (err) { state[name] = false; }
    btns[name].classList.toggle('adhdy-on', state[name]);
    btns[name].setAttribute('aria-pressed', String(state[name]));
    if (!skipSave) save();
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ f: state, p: prefs, t: themeName }));
    } catch (e) {}
  }
  function load() {
    try {
      var v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (!v) return null;
      return v.f ? v : { f: v, p: null }; // migrate pre-slider flat format
    } catch (e) { return null; }
  }

  function destroy() {
    ORDER.forEach(function (n) { if (state[n]) { try { features[n].off(); } catch (e) {} } });
    listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2], l[3]); });
    stopTimer();
    doc.querySelectorAll('.adhdy-confetti').forEach(function (el) { el.remove(); });
    if (toastEl) toastEl.remove();
    Object.keys(THEME_VARS).forEach(function (k) {
      html.style.removeProperty('--adhdy-' + THEME_VARS[k]);
    });
    panel.remove(); mini.remove(); style.remove(); hlStyle.remove();
    delete window.__lockin;
  }

  window.__lockin = {
    set: setFeature,
    state: function () { return Object.assign({}, state); },
    receipt: buildReceipt,
    togglePanel: function () {
      var hidden = panel.style.display === 'none' && mini.style.display === 'none';
      if (hidden) { panel.style.display = 'block'; }
      else if (panel.style.display !== 'none') { panel.style.display = 'none'; mini.style.display = 'block'; }
      else { mini.style.display = 'none'; panel.style.display = 'block'; }
    },
    destroy: destroy
  };

  /* -------------------------------------------- resume where you left off */

  var POS_KEY = 'adhdy-pos:' + location.host + location.pathname;
  var posTimer = 0;
  function savePos() {
    if (posTimer) return;
    posTimer = setTimeout(function () {
      posTimer = 0;
      try {
        if (scrollY > 400) {
          localStorage.setItem(POS_KEY, JSON.stringify({ y: scrollY, t: Date.now() }));
        }
      } catch (e) {}
    }, 1500);
  }
  on(window, 'scroll', savePos, { passive: true });
  (function offerResume() {
    var pos = null;
    try { pos = JSON.parse(localStorage.getItem(POS_KEY)); } catch (e) {}
    if (!pos || !pos.y) return;
    if (Date.now() - (pos.t || 0) > 14 * 864e5) return; // stale after 2 weeks
    if (Math.abs(scrollY - pos.y) < 400) return;        // already about there
    var t = toast('↩ Jump back to where you left off?');
    t.__act = function () {
      scrollTo({ top: pos.y, behavior: 'smooth' });
    };
  })();

  // Restore theme, last-used toggles, and slider prefs, or start with a
  // friendly default set.
  var saved = load();
  applyTheme(saved && saved.t);
  if (saved && saved.p) {
    Object.keys(PREFS_DEF).forEach(function (k) {
      if (typeof saved.p[k] === 'number') {
        prefs[k] = saved.p[k];
        slInputs[k].value = prefs[k];
      }
    });
  }
  if (saved) {
    ORDER.forEach(function (n) { if (saved.f[n]) setFeature(n, true, true); });
  } else {
    ['progress', 'comfy'].forEach(function (n) { setFeature(n, true, true); });
  }
})();
