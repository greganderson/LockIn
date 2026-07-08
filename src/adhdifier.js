/*
 * ADHDifier — make any article ADHD-friendly.
 * Runs as a bookmarklet (see build.js), a userscript, or a plain <script>.
 * Everything is toggleable, reversible, and namespaced with "adhdy".
 */
(function () {
  'use strict';

  // Already loaded? Just show/hide the panel instead of injecting twice.
  if (window.__adhdifier) { window.__adhdifier.togglePanel(); return; }

  var WPM = 230;              // reading speed for the "min left" estimate
  var CHUNK_MIN = 160;        // min chars between inserted paragraph breaks
  var STORE_KEY = 'adhdifier-settings';

  var doc = document, html = doc.documentElement;
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

  var ACCENT = '#7c5cff';
  var style = doc.createElement('style');
  style.id = 'adhdy-style';
  style.textContent = [
    /* focus spotlight */
    'html.adhdy-focus .adhdy-block{opacity:.28;transition:opacity .25s ease}',
    'html.adhdy-focus .adhdy-block.adhdy-cur{opacity:1}',
    /* bionic bolding */
    'b.adhdy-bio{font-weight:700;color:inherit}',
    /* chunk gaps */
    'span.adhdy-gap{display:block;height:.8em}',
    /* comfy text */
    '.adhdy-comfy{max-width:70ch!important;margin-left:auto!important;margin-right:auto!important;float:none!important}',
    '.adhdy-comfy :is(p,li,dd,blockquote){line-height:1.8!important;font-size:1.05em}',
    /* declutter */
    'html.adhdy-clean :is(nav,aside,footer,[role=navigation],[role=complementary],[role=banner]),html.adhdy-clean .adhdy-hidefixed{display:none!important}',
    /* section fold */
    '.adhdy-folded{display:none!important}',
    '.adhdy-done{opacity:.45;text-decoration:line-through}',
    'button.adhdy-check{cursor:pointer;margin-right:.5em;width:1.5em;height:1.5em;border-radius:50%;border:2px solid ' + ACCENT + ';background:transparent;color:' + ACCENT + ';font-size:.8em;line-height:1;vertical-align:middle;padding:0}',
    'button.adhdy-check.adhdy-on{background:' + ACCENT + ';color:#fff}',
    /* progress bar */
    '#adhdy-progress{position:fixed;top:0;left:0;height:4px;width:0;background:' + ACCENT + ';z-index:2147483645;transition:width .1s linear}',
    /* reading ruler */
    '#adhdy-ruler{position:fixed;left:0;width:100vw;height:96px;pointer-events:none;z-index:2147483640;box-shadow:0 0 0 200vmax rgba(15,12,35,.32);border-top:1px solid rgba(124,92,255,.55);border-bottom:1px solid rgba(124,92,255,.55)}',
    /* listen (TTS) highlight */
    '.adhdy-speak{background:rgba(124,92,255,.16)!important;outline:2px solid rgba(124,92,255,.5);border-radius:4px}',
    /* link guard */
    'html.adhdy-guard a[href]{color:inherit!important;text-decoration:underline dotted rgba(124,92,255,.65)!important}',
    /* calm — freeze motion (confetti exempted below) */
    'html.adhdy-calm *,html.adhdy-calm *::before,html.adhdy-calm *::after{animation-play-state:paused!important;transition:none!important;scroll-behavior:auto!important}',
    /* confetti */
    '@keyframes adhdy-fall{to{transform:translateY(105vh) rotate(540deg);opacity:.15}}',
    '.adhdy-confetti{position:fixed;top:-32px;z-index:2147483644;font-size:22px;pointer-events:none;animation:adhdy-fall 1.9s ease-in forwards}',
    'html.adhdy-calm .adhdy-confetti{animation-play-state:running!important}',
    /* toast */
    '#adhdy-toast{position:fixed;bottom:18px;right:18px;z-index:2147483646;font:13px/1.5 system-ui,sans-serif;color:#eceaf6;background:#211d33;border:1px solid #3a3355;border-radius:10px;padding:10px 14px;max-width:280px;box-shadow:0 8px 30px rgba(0,0,0,.45);cursor:pointer}',
    /* panel */
    '#adhdy-panel{all:initial;position:fixed;top:16px;right:16px;z-index:2147483646;font:13px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;color:#eceaf6;background:#211d33;border:1px solid #3a3355;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.45);padding:12px;width:216px;box-sizing:border-box}',
    '#adhdy-panel *{all:revert;font:inherit;color:inherit;box-sizing:border-box;margin:0;padding:0}',
    '#adhdy-panel .adhdy-head{display:flex;align-items:center;gap:6px;margin-bottom:10px}',
    '#adhdy-panel .adhdy-title{font-weight:700;font-size:14px;flex:1}',
    '#adhdy-panel .adhdy-x{cursor:pointer;background:none;border:none;color:#a49ec4;font-size:15px;padding:2px 5px;border-radius:6px}',
    '#adhdy-panel .adhdy-x:hover{background:#332c4f;color:#fff}',
    '#adhdy-panel .adhdy-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}',
    '#adhdy-panel .adhdy-t{cursor:pointer;border:1px solid #3a3355;background:#2a2542;color:#cfc9e8;border-radius:8px;padding:6px 4px;font-size:12px;text-align:center}',
    '#adhdy-panel .adhdy-t:hover{border-color:' + ACCENT + '}',
    '#adhdy-panel .adhdy-t.adhdy-on{background:' + ACCENT + ';border-color:' + ACCENT + ';color:#fff;font-weight:600}',
    '#adhdy-panel .adhdy-eta{margin-top:10px;font-size:12px;color:#a49ec4;text-align:center}',
    '#adhdy-panel .adhdy-row{display:flex;gap:6px;margin-top:8px;align-items:center}',
    '#adhdy-panel .adhdy-tm{cursor:pointer;border:1px solid #3a3355;background:#2a2542;color:#cfc9e8;border-radius:8px;padding:4px 0;font-size:11px;flex:1;text-align:center}',
    '#adhdy-panel .adhdy-tm:hover{border-color:' + ACCENT + '}',
    '#adhdy-panel .adhdy-clock{flex:1.4;text-align:center;font-size:12px;color:#a49ec4;cursor:pointer}',
    '#adhdy-mini{all:initial;position:fixed;top:16px;right:16px;z-index:2147483646;width:40px;height:40px;border-radius:50%;background:' + ACCENT + ';color:#fff;font:20px/40px system-ui;text-align:center;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.4);display:none}'
  ].join('\n');
  doc.head.appendChild(style);

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
  function focusScroll() {
    if (focusRaf) return;
    focusRaf = requestAnimationFrame(function () {
      focusRaf = 0;
      if (state.focus) setCur(pickBlockAt(innerHeight * 0.38));
    });
  }
  function focusMove(e) {
    if (!state.focus) return;
    var el = e.target && e.target.closest && e.target.closest(BLOCK_SEL);
    if (el && blocks.indexOf(el) > -1) setCur(el);
  }
  features.focus = {
    label: 'Focus',
    on: function () {
      blocks = collectLeafBlocks();
      blocks.forEach(function (el) { el.classList.add('adhdy-block'); });
      html.classList.add('adhdy-focus');
      setCur(pickBlockAt(innerHeight * 0.38));
    },
    off: function () {
      html.classList.remove('adhdy-focus');
      setCur(null);
      blocks.forEach(function (el) { el.classList.remove('adhdy-block'); });
      blocks = [];
    }
  };
  on(window, 'scroll', focusScroll, { passive: true });
  on(doc, 'mousemove', focusMove, { passive: true });

  // -- reading ruler --------------------------------------------------------
  var ruler = null;
  function rulerMove(e) {
    if (ruler) ruler.style.top = (e.clientY - 48) + 'px';
  }
  features.ruler = {
    label: 'Ruler',
    on: function () {
      ruler = doc.createElement('div');
      ruler.id = 'adhdy-ruler';
      ruler.style.top = (innerHeight * 0.35) + 'px';
      doc.body.appendChild(ruler);
    },
    off: function () { if (ruler) ruler.remove(); ruler = null; }
  };
  on(doc, 'mousemove', rulerMove, { passive: true });

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
    },
    off: function () {
      root.querySelectorAll('span.adhdy-gap').forEach(function (g) {
        var p = g.parentNode;
        g.remove();
        if (p) p.normalize();
      });
    }
  };

  // -- comfy text -----------------------------------------------------------
  features.comfy = {
    label: 'Comfy',
    on: function () { root.classList.add('adhdy-comfy'); },
    off: function () { root.classList.remove('adhdy-comfy'); }
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
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var done = btn.classList.toggle('adhdy-on');
          h.classList.toggle('adhdy-done', done);
          sectionEls(h).forEach(function (el) {
            el.classList.toggle('adhdy-folded', done);
          });
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
      var emoji = ['🎉', '✨', '⭐', '🎊', '💜'];
      for (var i = 0; i < 22; i++) {
        var s = doc.createElement('span');
        s.className = 'adhdy-confetti';
        s.textContent = emoji[i % emoji.length];
        s.style.left = (Math.random() * 100) + 'vw';
        s.style.animationDelay = (Math.random() * 0.5) + 's';
        doc.body.appendChild(s);
        setTimeout(function (el) { el.remove(); }.bind(null, s), 2600);
      }
    }
    lastFrac = frac;
  }

  /* ---------------------------------------------------------------- toast */

  var toastEl = null, toastTimer = 0;
  function toast(msg) {
    if (!toastEl) {
      toastEl = doc.createElement('div');
      toastEl.id = 'adhdy-toast';
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

  // -- listen (text-to-speech) ------------------------------------------------
  var synth = window.speechSynthesis || null;
  var speakList = [], speakIdx = 0, speaking = false;
  function unmarkSpoken() {
    root.querySelectorAll('.adhdy-speak').forEach(function (el) {
      el.classList.remove('adhdy-speak');
    });
  }
  function speakNext() {
    if (!speaking) return;
    unmarkSpoken();
    if (speakIdx >= speakList.length) { setFeature('listen', false); return; }
    var el = speakList[speakIdx];
    el.classList.add('adhdy-speak');
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
    // Speak sentence-by-sentence: long utterances get silently cut off in
    // Chrome, and per-sentence chunks keep pause/stop responsive.
    var text = el.innerText || '';
    var sentences = text.match(/[^.!?]+[.!?]*["'’”)]*\s*/g) || [text];
    var qi = 0;
    (function say() {
      if (!speaking) return;
      if (qi >= sentences.length) { speakIdx++; speakNext(); return; }
      var chunk = sentences[qi++].trim();
      if (!chunk) { say(); return; }
      var u = new SpeechSynthesisUtterance(chunk);
      u.rate = 1.05;
      u.onend = say;
      u.onerror = function () { if (speaking) say(); };
      synth.speak(u);
    })();
  }
  features.listen = {
    label: 'Listen',
    on: function () {
      if (!synth) { toast('This browser has no text-to-speech voice.'); throw new Error('no tts'); }
      speakList = collectLeafBlocks();
      var start = pickFrom(speakList, innerHeight * 0.38);
      speakIdx = Math.max(0, speakList.indexOf(start));
      speaking = true;
      synth.cancel();
      speakNext();
    },
    off: function () {
      speaking = false;
      if (synth) synth.cancel();
      unmarkSpoken();
    }
  };

  // -- link guard -------------------------------------------------------------
  var guardHinted = false;
  function guardClick(e) {
    if (!state.guard) return;
    var a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a || a.closest('#adhdy-panel') || e.detail >= 2) return;
    e.preventDefault();
    e.stopPropagation();
    if (!guardHinted) { guardHinted = true; toast('🐇 Link guard: double-click a link when you really mean it.'); }
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
               'sections', 'progress', 'listen', 'guard', 'calm'];
  var panel = doc.createElement('div');
  panel.id = 'adhdy-panel';
  var mini = doc.createElement('div');
  mini.id = 'adhdy-mini';
  mini.textContent = '🧠';
  mini.title = 'ADHDifier';

  var head = doc.createElement('div');
  head.className = 'adhdy-head';
  var title = doc.createElement('span');
  title.className = 'adhdy-title';
  title.textContent = '🧠 ADHDifier';
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

  var grid = doc.createElement('div');
  grid.className = 'adhdy-grid';
  var btns = {};
  ORDER.forEach(function (name) {
    var b = doc.createElement('button');
    b.className = 'adhdy-t';
    b.type = 'button';
    b.textContent = features[name].label;
    b.addEventListener('click', function () { setFeature(name, !state[name]); });
    btns[name] = b;
    grid.appendChild(b);
  });
  panel.appendChild(grid);

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

  eta = doc.createElement('div');
  eta.className = 'adhdy-eta';
  eta.style.display = 'none';
  panel.appendChild(eta);

  doc.body.appendChild(panel);
  doc.body.appendChild(mini);

  minBtn.addEventListener('click', function () {
    panel.style.display = 'none';
    mini.style.display = 'block';
  });
  mini.addEventListener('click', function () {
    mini.style.display = 'none';
    panel.style.display = 'block';
  });
  closeBtn.addEventListener('click', destroy);

  /* ------------------------------------------------------- state & wiring */

  function setFeature(name, val, skipSave) {
    val = !!val;
    if (state[name] === val) return;
    state[name] = val;
    try { val ? features[name].on() : features[name].off(); }
    catch (err) { state[name] = false; }
    btns[name].classList.toggle('adhdy-on', state[name]);
    if (!skipSave) save();
  }

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || null; }
    catch (e) { return null; }
  }

  function destroy() {
    ORDER.forEach(function (n) { if (state[n]) { try { features[n].off(); } catch (e) {} } });
    listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2], l[3]); });
    stopTimer();
    if (synth) { try { synth.cancel(); } catch (e) {} }
    doc.querySelectorAll('.adhdy-confetti').forEach(function (el) { el.remove(); });
    if (toastEl) toastEl.remove();
    panel.remove(); mini.remove(); style.remove();
    delete window.__adhdifier;
  }

  window.__adhdifier = {
    set: setFeature,
    state: function () { return Object.assign({}, state); },
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

  // Restore last-used toggles, or start with a friendly default set.
  // 'listen' never auto-restores: speech needs a user gesture anyway.
  var saved = load();
  if (saved) {
    ORDER.forEach(function (n) {
      if (saved[n] && n !== 'listen') setFeature(n, true, true);
    });
  } else {
    ['progress', 'comfy'].forEach(function (n) { setFeature(n, true, true); });
  }
})();
