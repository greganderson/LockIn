#!/usr/bin/env sh
# Headless-Chromium smoke test: builds, injects the packed script into
# demo.html, drives the public API, and checks the assertions below.
set -e
cd "$(dirname "$0")/.."
node --check src/adhdifier.js
node build.js >/dev/null
node --check dist/adhdifier.packed.js

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/inject" <<EOF
<script>window.__origText = document.querySelector('article').innerText.replace(/\s+/g,' ').trim();</script>
<script src="$(pwd)/dist/adhdifier.packed.js"></script>
<script>
(function(){
  var A = window.__adhdifier, q = function(s){return document.querySelectorAll(s).length;}, R = [];
  A.set('chunks', true);  R.push('gaps_alone=' + (q('span.adhdy-gap') > 3));
  A.set('chunks', false); R.push('gaps_removed=' + (q('span.adhdy-gap') === 0));
  A.set('bionic', true); A.set('chunks', true);
  R.push('gaps_after_bionic=' + (q('span.adhdy-gap') > 3));
  R.push('bionic_bolds=' + (q('b.adhdy-bio') > 100));
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
  A.set('listen', true);
  R.push('listen_highlight=' + (A.state().listen ? q('.adhdy-speak') === 1 : 'skipped_no_tts'));
  A.set('listen', false);
  R.push('listen_off=' + (q('.adhdy-speak') === 0));
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
TOTAL=14
if grep -q '=false' "$TMP/results" || [ "$(grep -cE '=(true|skipped_no_tts)' "$TMP/results")" -ne "$TOTAL" ]; then
  echo 'FAIL'; exit 1
fi
echo "PASS ($TOTAL/$TOTAL)"
