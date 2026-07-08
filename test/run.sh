#!/usr/bin/env sh
# Headless-Chromium smoke test: builds, injects the packed script into
# demo.html, drives the public API, and checks the assertions below.
set -e
cd "$(dirname "$0")/.."
node --check src/lockin.js
node build.js >/dev/null
node --check dist/lockin.packed.js

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/inject" <<EOF
<script>window.__origText = document.querySelector('article').innerText.replace(/\s+/g,' ').trim();</script>
<script src="$(pwd)/dist/lockin.packed.js"></script>
<script>
(function(){
  var A = window.__lockin, q = function(s){return document.querySelectorAll(s).length;}, R = [];
  A.set('chunks', true);  R.push('gaps_alone=' + (q('span.adhdy-gap') > 3));
  A.set('chunks', false); R.push('gaps_removed=' + (q('span.adhdy-gap') === 0));
  A.set('bionic', true); A.set('chunks', true);
  R.push('gaps_after_bionic=' + (q('span.adhdy-gap') > 3));
  R.push('bionic_bolds=' + (q('b.adhdy-bio') > 100));
  A.set('focus', true);
  var bigP = document.querySelector('article p');
  bigP.dispatchEvent(new MouseEvent('mousemove',
    {bubbles: true, clientY: Math.max(10, bigP.getBoundingClientRect().top + 10)}));
  R.push('chunk_focus=' + (CSS.highlights.has('adhdy-dim') && CSS.highlights.get('adhdy-dim').size >= 1));
  R.push('chunk_dim_matches=' + (document.getElementById('adhdy-hlstyle').textContent.indexOf('rgba(34,34,34,0.28)') > -1));
  A.set('chunks', false);
  R.push('chunk_focus_cleared=' + !CSS.highlights.has('adhdy-dim'));
  A.set('chunks', true);
  A.set('focus', false);
  A.set('sections', true);
  document.querySelector('button.adhdy-check').click();
  R.push('folded=' + (q('.adhdy-folded') > 0));
  A.set('guard', true);
  var link = document.querySelector('nav a');
  var ev = new MouseEvent('click', {bubbles: true, cancelable: true});
  link.dispatchEvent(ev);
  R.push('guard_blocks=' + ev.defaultPrevented);
  var ev2 = new MouseEvent('click', {bubbles: true, cancelable: true, detail: 2});
  link.dispatchEvent(ev2);
  R.push('guard_dblclick_allows=' + !ev2.defaultPrevented);
  A.set('calm', true);
  R.push('calm=' + document.documentElement.classList.contains('adhdy-calm'));
  A.set('comfy', true);
  var fsSlider = document.querySelector('#adhdy-sliders input');
  fsSlider.value = 1.2;
  fsSlider.dispatchEvent(new Event('input'));
  R.push('comfy_slider=' + (document.querySelector('article').style.getPropertyValue('--adhdy-fs') === '1.2em'));
  A.set('map', true);
  R.push('map_rows=' + (q('#adhdy-map .adhdy-mrow') >= 5));
  R.push('map_done_mark=' + /✓/.test(document.querySelector('#adhdy-map .adhdy-mrow').textContent));
  var noteEl = document.getElementById('adhdy-note');
  noteEl.value = 'find the rate limits';
  noteEl.dispatchEvent(new Event('input'));
  R.push('note_saved=' + (localStorage.getItem('adhdy-note:' + location.host + location.pathname) === 'find the rate limits'));
  document.querySelector('.adhdy-tm').click();
  R.push('timer_runs=' + /⏱ \d/.test(document.querySelector('.adhdy-clock').textContent));
  document.querySelector('.adhdy-clock').click();
  ['focus','ruler','comfy','clean','progress'].forEach(function(f){A.set(f,true);});
  R.push('panel=' + (q('#adhdy-panel') === 1));
  A.destroy();
  R.push('leftovers_gone=' + (q('[class*="adhdy"],[id*="adhdy"]') === 0));
  var after = document.querySelector('article').innerText.replace(/\s+/g,' ').trim();
  R.push('text_restored=' + (after === window.__origText));
  var pre = document.createElement('pre');
  pre.textContent = '\nRESULTS_' + 'BEGIN\n' + R.join('\n') + '\nRESULTS_' + 'END\n';
  document.body.appendChild(pre);
})();
</script>
EOF

sed -e '/<\/body>/e cat '"$TMP/inject" demo.html > "$TMP/test.html"

chromium --headless=new --disable-gpu --virtual-time-budget=3000 \
  --dump-dom "file://$TMP/test.html" 2>/dev/null \
  | sed -n '/RESULTS_BEGIN/,/RESULTS_END/p' | grep '=' > "$TMP/results"

cat "$TMP/results"
TOTAL=19
if grep -q '=false' "$TMP/results" || [ "$(grep -c '=true' "$TMP/results")" -ne "$TOTAL" ]; then
  echo 'FAIL'; exit 1
fi
echo "PASS ($TOTAL/$TOTAL)"
