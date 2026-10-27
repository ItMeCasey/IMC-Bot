/* Light theme + slim density for every page and widget of the app. Choice is kept in localStorage, so all frames follow the shell live. */
(function () {
  var KT = 'icm.theme', KD = 'icm.density';
  var get = function (k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
  var css = [

    /* ---------- form controls in the app's own look (low specificity: any page can still override) */
    ':where(select){-webkit-appearance:none;appearance:none;font:inherit;font-size:15px;color:var(--cream);background:var(--iron) url(data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%2212%22%20height=%228%22%3E%3Cpath%20d=%22M1%201l5%205%205-5%22%20fill=%22none%22%20stroke=%22%23F39120%22%20stroke-width=%222%22/%3E%3C/svg%3E) no-repeat right 11px center/12px 8px;border:2px solid #46504f;border-radius:0;padding:8px 34px 8px 10px;cursor:pointer;min-width:0}',
    ':where(select:hover){border-color:var(--aqua)}',':where(select:focus){outline:none;border-color:var(--heat)}',
    ':where(select option){background:var(--iron-d,#1A2020);color:var(--cream)}',
    ':where(input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]):not([type=button]):not([type=submit]):not([type=hidden]),textarea){font:inherit;font-size:15px;color:var(--cream);background-color:var(--iron);border:2px solid #46504f;border-radius:0;padding:7px 9px;transition:border-color .12s}',
    ':where(input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]):not([type=button]):not([type=submit]):hover,textarea:hover){border-color:var(--aqua)}',
    ':where(input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]):not([type=button]):not([type=submit]):focus,textarea:focus){outline:none;border-color:var(--heat);box-shadow:0 0 0 2px rgba(243,145,32,.25)}',
    ':where(input,textarea)::placeholder{color:#7d8885;opacity:1}',':where(input,textarea)::selection{background:var(--heat);color:var(--iron)}',
    ':where(input[type=number]){-moz-appearance:textfield}',':where(input[type=number])::-webkit-inner-spin-button,:where(input[type=number])::-webkit-outer-spin-button{opacity:.5;filter:invert(.8)}',
    ':where(input:disabled,textarea:disabled){opacity:.5;cursor:not-allowed}',
    ':where(input[type=checkbox]){padding:0;-webkit-appearance:none;appearance:none;width:18px;height:18px;margin:0;flex:none;vertical-align:middle;background:var(--iron);border:2px solid #46504f;border-radius:0;cursor:pointer;position:relative}',
    ':where(input[type=checkbox]:hover){border-color:var(--aqua)}','input[type=checkbox]:checked{background:var(--aqua);border-color:var(--aqua);padding:0}',
    'input[type=checkbox]:checked::after{content:"";position:absolute;left:4px;top:0;width:5px;height:10px;border:solid var(--iron);border-width:0 2px 2px 0;transform:rotate(45deg)}',
    ':where(input[type=checkbox]:focus-visible){outline:2px solid var(--heat);outline-offset:2px}',
    /* ---------- calm layer: quieter panels, one neutral heading style, folded sections */
    'section{border-left:0!important;border-top:1px solid var(--line)!important}',
    'section>h2{color:var(--cream)!important;opacity:.9;font-size:12px!important;letter-spacing:3px!important;font-weight:700}',
    'section>h2.acc{display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none;margin-bottom:0!important}',
    'section>h2.acc::before{content:"";width:7px;height:7px;border-right:2px solid var(--heat);border-bottom:2px solid var(--heat);transform:rotate(-45deg);transition:transform .15s;flex:none}',
    'section>h2.acc.open::before{transform:rotate(45deg)}',
    'section>h2.acc:hover{opacity:1}','section>h2.acc:focus-visible{outline:2px solid var(--heat);outline-offset:2px}',
    'section>h2.acc.open{margin-bottom:12px!important}',
    'section.folded>*:not(h2){display:none!important}',
    'html:not([data-theme="light"]) .muted,html:not([data-theme="light"]) small,html:not([data-theme="light"]) .lbl,html:not([data-theme="light"]) .fld{color:#b5bdb9}',
    '.fld{letter-spacing:1px!important}',
    'button.danger,.btn.danger{background:transparent!important;color:var(--rust)!important;outline:1px solid var(--rust);outline-offset:-1px}button.danger:hover{background:var(--rust)!important;color:#fff!important;filter:none}',
    'details>summary{cursor:pointer;color:var(--heat);font-size:12px;letter-spacing:1px;padding:2px 0;list-style:none}details>summary::-webkit-details-marker{display:none}details>summary::before{content:"+ "}details[open]>summary::before{content:"\\2212 "}',
    'section.folded{padding-top:11px!important;padding-bottom:11px!important}',
    'section>h2 small.cnt{margin-left:auto;font-weight:400;letter-spacing:1px;opacity:.6;text-transform:none}',
    /* ---------- light theme: same variable names the pages already use */
    'html[data-theme="light"]{--iron:#ECE5CF;--iron-d:#FAF6E8;--cream:#222A2A;--aqua:#2A8F90;--heat:#D9780F;--rust:#D23C1D;--drust:#A8321C;--olive:#6F7F27;--line:#D8CFB2;--chatbg:#FBF7EA;color-scheme:light}',
    'html[data-theme="light"] body{background:var(--iron);color:var(--cream)}',
    'html[data-theme="light"] button:not(.ghost):not(.g){color:#fff}',
    'html[data-theme="light"] button.c,html[data-theme="light"] .b.cream{color:#fff}',
    'html[data-theme="light"] button.ghost,html[data-theme="light"] button.g{color:var(--cream);outline-color:#bfb58f}',
    'html[data-theme="light"] input,html[data-theme="light"] select,html[data-theme="light"] textarea{border-color:#bfb58f!important;background:#fff!important;color:#222A2A!important}',
    'html[data-theme="light"] .muted,html[data-theme="light"] small,html[data-theme="light"] .lbl,html[data-theme="light"] .fld,html[data-theme="light"] .cap{color:#5d6763!important}',
    'html[data-theme="light"] [style*="9aa39f"]{color:#5d6763!important}',
    'html[data-theme="light"] pre,html[data-theme="light"] code{background:#E3DCC4!important;color:#222A2A!important}',
    'html[data-theme="light"] .edit .w .bar{background:#E3DCC4!important}',
    'html[data-theme="light"] #top,html[data-theme="light"] header{box-shadow:0 1px 0 var(--line)}',
    'html[data-theme="light"] table td,html[data-theme="light"] table th{border-color:var(--line)!important}',
    'html[data-theme="light"] nav button:not(.on){color:var(--cream)!important}',
    'html[data-theme="light"] nav button.on{color:#fff}',
    'html[data-theme="light"] .tab,html[data-theme="light"] .tabs button{color:var(--cream)}',
    'html[data-theme="light"] ::-webkit-scrollbar-thumb{background:#bfb58f}',
    /* ---------- slim density: tighter padding, smaller type */
    'html[data-density="slim"] body{font-size:13px}',
    'html[data-density="slim"] header{padding:5px 14px!important}',
    'html[data-density="slim"] header img{width:22px!important;height:22px!important}',
    'html[data-density="slim"] header h1,html[data-density="slim"] h1{font-size:14px!important;letter-spacing:4px!important}',
    'html[data-density="slim"] main{padding:10px 12px 28px!important;gap:10px!important}',
    'html[data-density="slim"] section,html[data-density="slim"] .card{padding:9px 13px!important}',
    'html[data-density="slim"] h2{margin-bottom:6px!important;font-size:11px!important;letter-spacing:4px!important}',
    'html[data-density="slim"] button{padding:4px 9px!important;font-size:11px!important;letter-spacing:1px!important}',
    'html[data-density="slim"] input,html[data-density="slim"] select,html[data-density="slim"] textarea{padding:3px 7px!important;font-size:13px!important}',
    'html[data-density="slim"] .row{margin:4px 0!important;gap:6px!important}',
    'html[data-density="slim"] .fld{margin-bottom:6px!important;gap:2px!important;font-size:10px!important}',
    'html[data-density="slim"] td,html[data-density="slim"] th{padding:2px 5px!important}',
    'html[data-density="slim"] .big{font-size:26px!important}',
    'html[data-density="slim"] .muted{font-size:12px!important}',
    'html[data-density="slim"] .b{min-height:48px!important;font-size:12px!important}',
    'html[data-density="slim"] .goal{padding:5px 0!important}',
    'html[data-density="slim"] .m{padding-top:1px!important;padding-bottom:1px!important}'
  ].join('\n');
  var st = document.createElement('style'); st.id = 'icm-ui-css'; st.textContent = css; (document.head || document.documentElement).appendChild(st);
  /* "Make your own theme": the colour tokens every page uses. A custom theme is a dark or light base plus the colours the user changed. */
  var KC = 'icm.custom', KB = 'icm.customBase', HEX = /^#[0-9a-f]{6}$/i;
  var TOKENS = [
    { key: 'iron', label: 'Background', hint: 'page background' },
    { key: 'iron-d', label: 'Panels', hint: 'cards, header, side menu' },
    { key: 'cream', label: 'Text', hint: 'main text colour' },
    { key: 'aqua', label: 'Accent 1', hint: 'links, highlights, checked boxes' },
    { key: 'heat', label: 'Accent 2', hint: 'buttons, focus rings' },
    { key: 'rust', label: 'Alert', hint: 'live light, delete, warnings' },
    { key: 'drust', label: 'Alert (dark)', hint: 'darker alert shade' },
    { key: 'line', label: 'Borders', hint: 'lines between sections' },
    { key: 'green', label: 'Success', hint: 'ok messages' }
  ];
  var BASES = {
    dark: { 'iron': '#222A2A', 'iron-d': '#1A2020', 'cream': '#E2DAC2', 'aqua': '#4FBBBC', 'heat': '#F39120', 'rust': '#EC4624', 'drust': '#B13A22', 'line': '#2F3938', 'green': '#7BC47F' },
    light: { 'iron': '#ECE5CF', 'iron-d': '#FAF6E8', 'cream': '#222A2A', 'aqua': '#2A8F90', 'heat': '#D9780F', 'rust': '#D23C1D', 'drust': '#A8321C', 'line': '#D8CFB2', 'green': '#3F8A44' }
  };
  // the page's own :root colours are the dark theme; a custom theme only overrides the tokens the user changed
  var customBase = function () { return get(KB, 'dark') === 'light' ? 'light' : 'dark'; };
  function customSaved() { try { var c = JSON.parse(localStorage.getItem(KC) || 'null'); return c && typeof c === 'object' ? c : null; } catch (e) { return null; } }
  /* every token with a value: the user's own where valid, else the base's */
  function customTokens() { var b = BASES[customBase()], c = customSaved() || {}, o = {}; TOKENS.forEach(function (t) { o[t.key] = HEX.test(c[t.key] || '') ? c[t.key].toUpperCase() : b[t.key]; }); return o; }
  /* writes one rule that sets every token; its selector is more specific than the pages' :root and the light theme, so it always wins */
  function paintCustom(on) {
    var st = document.getElementById('icm-custom-css');
    if (!on) { if (st) st.textContent = ''; return; }
    if (!st) { st = document.createElement('style'); st.id = 'icm-custom-css'; (document.head || document.documentElement).appendChild(st); }
    var v = customTokens(), n = ''; TOKENS.forEach(function (t) { n += '--' + t.key + ':' + v[t.key] + ';'; });
    st.textContent = 'html[data-custom][data-theme]{' + n + 'color-scheme:' + customBase() + '}';
  }
  /* data-theme stays dark or light (so the existing light-theme fixes still apply to a light base); data-custom switches the user's colours on */
  function apply() {
    var h = document.documentElement, t = get(KT, 'dark'), custom = t === 'custom';
    h.setAttribute('data-theme', custom ? customBase() : t); if (custom) h.setAttribute('data-custom', '1'); else h.removeAttribute('data-custom');
    paintCustom(custom); h.setAttribute('data-density', get(KD, 'normal'));
  }
  apply(); window.addEventListener('storage', apply);

  /* Folded sections: pages with three or more full-width sections open the first one (or any marked data-open) and fold the rest.
     Click a heading to open or close it; what you open is remembered per page. */
  function foldSections() {
    if (document.documentElement.classList.contains('noacc')) return;
    var key = 'icm.fold.' + location.pathname, saved = {}; try { saved = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { saved = {}; }
    var parents = new Set(); document.querySelectorAll('section').forEach(function (s) { if (s.parentElement) parents.add(s.parentElement); });
    parents.forEach(function (p) {
      var secs = [].filter.call(p.children, function (c) { return c.tagName === 'SECTION' && c.firstElementChild && c.firstElementChild.tagName === 'H2'; });
      var cols = (getComputedStyle(p).display === 'grid' ? getComputedStyle(p).gridTemplateColumns.split(' ').length : 1);
      var wide = secs.filter(function (s) { if (cols < 2) return true; var cs = getComputedStyle(s); return cs.gridColumnEnd === '-1' || /span\s*[2-9]/.test(cs.gridColumnEnd); });
      if (wide.length < 3 && secs.length < 3) return;
      var firstDone = false;
      wide.forEach(function (s) {
        var h = s.firstElementChild, title = h.textContent.trim().replace(/\s+/g, ' ').slice(0, 40), want = saved[title];
        var open = want !== undefined ? !!want : (s.hasAttribute('data-open') || (!firstDone && !wide.some(function (x) { return x.hasAttribute('data-open'); })));
        firstDone = true;
        h.classList.add('acc'); h.setAttribute('role', 'button'); h.setAttribute('tabindex', '0');
        function paint() { h.classList.toggle('open', open); s.classList.toggle('folded', !open); h.setAttribute('aria-expanded', open ? 'true' : 'false'); }
        function toggle() { open = !open; saved[title] = open ? 1 : 0; try { localStorage.setItem(key, JSON.stringify(saved)); } catch (e) { /* ignore */ } paint(); window.dispatchEvent(new Event('resize')); }
        h.addEventListener('click', function (e) { if (e.target.closest('button,a,input,select')) return; toggle(); });
        h.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
        paint();
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', foldSections); else foldSections();
  window.icmUi = {
    theme: function () { return get(KT, 'dark'); }, density: function () { return get(KD, 'normal'); },
    set: function (k, v) { try { localStorage.setItem(k === 'theme' ? KT : KD, v); } catch (e) { /* storage blocked */ } apply(); },
    tokens: TOKENS, bases: BASES, customBase: customBase, hasCustom: function () { return !!customSaved(); },
    custom: customTokens,
    /* name = token key, value = '#RRGGBB'; returns false for anything that is not a full hex colour. Using it switches the app to the custom theme. */
    setToken: function (name, value) {
      if (!TOKENS.some(function (t) { return t.key === name; }) || !HEX.test(value)) return false;
      var c = customSaved() || {}; c[name] = value.toUpperCase();
      try { localStorage.setItem(KC, JSON.stringify(c)); localStorage.setItem(KT, 'custom'); } catch (e) { /* storage blocked */ } apply(); return true;
    },
    setBase: function (b) { try { localStorage.setItem(KB, b === 'light' ? 'light' : 'dark'); if (get(KT, 'dark') === 'custom') apply(); } catch (e) { /* storage blocked */ } },
    resetCustom: function () { try { localStorage.removeItem(KC); } catch (e) { /* storage blocked */ } apply(); }
  };
})();
