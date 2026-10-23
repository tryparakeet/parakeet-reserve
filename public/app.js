(function () {
  'use strict';

  var doc = document;
  var win = window;
  var root = doc.documentElement;

  var ENDPOINT = '/api/event';
  var COOKIE = 'pk_v';
  var NINETY_DAYS = 90 * 24 * 60 * 60;

  /* ---------- --screen-h: innerHeight in px, only where svh units are unknown ---------- */

  var hasSvh = false;
  try { hasSvh = !!(win.CSS && win.CSS.supports && win.CSS.supports('height', '1svh')); } catch (e) {}
  if (!hasSvh) {
    var setScreenH = function () {
      try { root.style.setProperty('--screen-h', (win.innerHeight || root.clientHeight) + 'px'); } catch (e) {}
    };
    setScreenH();
    win.addEventListener('resize', setScreenH);
    win.addEventListener('orientationchange', setScreenH);
  }

  /* ---------- --cta-h: the pinned Reserve sheet's measured height (styles.css has a fallback) ---------- */

  var cta = doc.querySelector('.cta');
  function setCtaH() {
    try { if (cta && cta.offsetHeight) root.style.setProperty('--cta-h', cta.offsetHeight + 'px'); } catch (e) {}
  }
  setCtaH();
  try {
    if (cta && win.ResizeObserver) new win.ResizeObserver(setCtaH).observe(cta);
    else win.addEventListener('resize', setCtaH);
  } catch (e) {}

  /* ---------- visitor id (one first-party cookie) ---------- */

  function randomId() {
    var bytes = null;
    try {
      if (win.crypto && win.crypto.getRandomValues) {
        bytes = new Uint8Array(16);
        win.crypto.getRandomValues(bytes);
      }
    } catch (e) { bytes = null; }
    var out = '';
    var alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    for (var i = 0; i < 24; i++) {
      var n = bytes ? bytes[i % 16] ^ (i * 31) : Math.floor(Math.random() * 256);
      out += alphabet[n % alphabet.length];
    }
    return out;
  }

  function readCookie(name) {
    var parts = (doc.cookie || '').split(';');
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].replace(/^\s+/, '');
      if (p.indexOf(name + '=') === 0) return p.slice(name.length + 1);
    }
    return '';
  }

  var vid = readCookie(COOKIE);
  if (!/^[a-z0-9]{24}$/.test(vid)) {
    vid = randomId();
    try {
      doc.cookie = COOKIE + '=' + vid + '; Max-Age=' + NINETY_DAYS + '; Path=/; SameSite=Lax' +
        (win.isSecureContext === true ? '; Secure' : '');
    } catch (e) {}
  }

  /* ---------- context ---------- */

  var params;
  try { params = new URLSearchParams(location.search); } catch (e) { params = null; }
  function param(name) {
    var v = params ? params.get(name) : null;
    return v ? String(v).slice(0, 100) : '';
  }

  function refOrigin(v) {
    if (!v) return '';
    try { var o = new URL(v).origin; return o === 'null' ? '' : o; } catch (e) {}
    var m = /^[a-z]+:\/\/[^\/?#]+/i.exec(v);
    return m ? m[0] : '';
  }

  var ua = navigator.userAgent || '';
  var device = (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) ? 'ios'
    : /Android/.test(ua) ? 'android' : 'other';
  var inapp = /BytedanceWebview|musical_ly|TikTok/i.test(ua) ? 'tiktok'
    : /Instagram/i.test(ua) ? 'instagram'
    : /FBAN|FBAV|FB_IAB|FBIOS|FB4A/.test(ua) ? 'facebook' : 'none';

  var base = {
    vid: vid,
    utm_source: param('utm_source'),
    utm_medium: param('utm_medium'),
    utm_campaign: param('utm_campaign'),
    utm_content: param('utm_content'),
    device: device,
    inapp: inapp,
    ref: refOrigin(doc.referrer)
  };

  /* ---------- transport ---------- */

  function payload(event, extra) {
    var row = { event: event, ts: new Date().toISOString() };
    for (var k in base) if (Object.prototype.hasOwnProperty.call(base, k)) row[k] = base[k];
    if (extra) for (var j in extra) if (Object.prototype.hasOwnProperty.call(extra, j)) row[j] = extra[j];
    return JSON.stringify(row);
  }

  function post(body, attempt) {
    attempt = attempt || 1;
    var retry = function () { if (attempt < 3) setTimeout(function () { post(body, attempt + 1); }, 600 * attempt); };
    try {
      if (!win.fetch) { xhr(body); return; }
      win.fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true,
        credentials: 'same-origin',
        cache: 'no-store'
      }).then(function (r) { if (!r.ok && r.status !== 400) retry(); }, retry);
    } catch (e) { xhr(body); }
  }

  function xhr(body) {
    try {
      var x = new XMLHttpRequest();
      x.open('POST', ENDPOINT, true);
      x.setRequestHeader('Content-Type', 'application/json');
      x.send(body);
    } catch (e) {}
  }

  function send(event, extra) { post(payload(event, extra)); }

  function beacon(event, extra) {
    var body = payload(event, extra);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, body)) return;
    } catch (e) {}
    post(body);
  }

  /* ---------- taps: the row goes first, then the action, inside the gesture ---------- */

  var selectedPlan = 'yearly';   // Yearly is preselected in the markup; no row on load
  var planTapped = false;        // a plan tap was sent this load (card or Hold my spot)

  var tapButtons = doc.querySelectorAll('[data-tap]');
  for (var b = 0; b < tapButtons.length; b++) {
    tapButtons[b].addEventListener('click', onTap);
  }

  function onTap() {
    var button = this.getAttribute('data-tap') || '';
    var plan = this.getAttribute('data-plan') || '';
    var extra = { button: button };
    if (plan) { extra.via = 'card'; planTapped = true; }
    try { send('tap', extra); } catch (e) {}
    try {
      if (button === 'reserve') openSheet();
      else if (plan) selectPlan(plan);
    } catch (e) {}
  }

  /* ---------- events ---------- */

  var evidence = {};
  try {
    evidence = {
      ua: ua.slice(0, 400),
      wd: navigator.webdriver === true,
      scr: (win.screen ? win.screen.width + 'x' + win.screen.height : '').slice(0, 12)
    };
  } catch (e) { evidence = {}; }
  send('pageview', evidence);

  /* hero B has no clip: no video row and no video state on the leave beacon */
  var t0 = Date.now();
  var left = false;
  function leave() {
    if (left) return;
    left = true;
    beacon('leave', { seconds: Math.max(0, Math.round((Date.now() - t0) / 1000)) });
  }
  win.addEventListener('pagehide', leave);
  win.addEventListener('pageshow', function () { left = false; });
  doc.addEventListener('visibilitychange', function () {
    if (doc.visibilityState === 'hidden') leave(); else left = false;
  });

  var price = doc.getElementById('price');
  try { if (price && 'IntersectionObserver' in win) {
    var seen = false;
    var seenObs = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting && !seen) {
          seen = true;
          seenObs.disconnect();
          send('seen');
        }
      }
    }, { threshold: 0.5 });
    seenObs.observe(price);
  } } catch (e) {}

  var reduced = false;   // closeSheet and the scroll fade read it
  try { reduced = !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}

  /* ---------- the scroll fade: each row and the footer, once, the first time they enter the viewport ---------- */

  try { if (!reduced && 'IntersectionObserver' in win) {
    var reveals = doc.querySelectorAll('[data-reveal]');
    var revealObs = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isIntersecting) continue;
        entries[i].target.classList.add('in');
        revealObs.unobserve(entries[i].target);
      }
    });
    for (var rv = 0; rv < reveals.length; rv++) revealObs.observe(reveals[rv]);
  } } catch (e) {}

  /* ---------- sheet ---------- */

  var sheetRoot = doc.getElementById('sheet');
  var panel = doc.getElementById('sheet-panel');
  var steps = [doc.getElementById('step-1'), doc.getElementById('step-2'), doc.getElementById('step-3')];
  var planCards = doc.querySelectorAll('.plan[data-plan]');
  var holdButton = doc.getElementById('hold');
  var emailForm = doc.getElementById('email-form');
  var emailInput = doc.getElementById('email');
  var sendButton = emailForm.querySelector('button[type="submit"]');
  var doneEmails = doc.querySelectorAll('.done-email');
  var lastFocus = null;
  var scrollY = 0;
  var sheetOpen = false;
  var closeTimer = 0;
  var SETTLE_MS = 500;   // presses inside the sheet are dropped this long after it opens (see below)
  var openedAt = 0;
  var settleTimer = 0;

  /* Step 3 (done) sits inside the email step, as on the boards: it shows under the emptied field */
  function showStep(n) {
    for (var i = 0; i < steps.length; i++) steps[i].hidden = !((i + 1) === n || (n === 3 && i === 1));
    panel.setAttribute('aria-labelledby', 'sheet-title-' + (n === 3 ? 2 : n));
    panel.scrollTop = 0;
  }

  /* The done state: the emptied field and the button are disabled. While the field is empty the button only
     looks disabled (styles.css, :placeholder-shown), so an autofill that fires no input event never blocks it. */
  function setEmailState(done) {
    emailInput.disabled = done;
    sendButton.disabled = done;
  }

  function selectPlan(plan) {
    selectedPlan = plan;
    sheetRoot.setAttribute('data-picked', plan);   // the lines that depend on the plan (styles.css)
    for (var i = 0; i < planCards.length; i++) {
      var on = planCards[i].getAttribute('data-plan') === plan;
      planCards[i].setAttribute('aria-checked', on ? 'true' : 'false');
      planCards[i].setAttribute('tabindex', on ? '0' : '-1');
    }
  }

  function onPlanKey(ev) {
    var k = ev.key;
    var forward = k === 'ArrowDown' || k === 'ArrowRight' || k === 'Down' || k === 'Right';
    var back = k === 'ArrowUp' || k === 'ArrowLeft' || k === 'Up' || k === 'Left';
    if (!forward && !back) return;
    ev.preventDefault();
    var idx = -1;
    for (var i = 0; i < planCards.length; i++) if (planCards[i] === this) idx = i;
    if (idx < 0 || planCards.length < 2) return;
    var next = planCards[(idx + (forward ? 1 : planCards.length - 1)) % planCards.length];
    next.click();   // a keyboard choice is recorded exactly like a press
    try { next.focus(); } catch (e) {}
  }
  for (var c = 0; c < planCards.length; c++) planCards[c].addEventListener('keydown', onPlanKey);

  function openSheet() {
    if (sheetOpen) return;
    sheetOpen = true;
    openedAt = Date.now();
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = 0; }
    if (settleTimer) clearTimeout(settleTimer);
    sheetRoot.classList.remove('settled');
    settleTimer = setTimeout(function () {
      settleTimer = 0;
      if (sheetOpen) sheetRoot.classList.add('settled');   // observable: the guard window has passed
    }, SETTLE_MS);
    lastFocus = doc.activeElement;
    scrollY = win.pageYOffset || root.scrollTop || 0;
    doc.body.style.top = -scrollY + 'px';
    showStep(1);   // always step 1; the plan choice is kept across a reopen
    emailInput.value = '';
    emailInput.removeAttribute('aria-invalid');
    emailInput.classList.remove('shake');
    setEmailState(false);
    sheetRoot.hidden = false;
    root.classList.add('sheet-open');
    fitSheet();
    win.requestAnimationFrame(function () {
      win.requestAnimationFrame(function () {
        if (!sheetOpen) return;   // closed in the meantime: nothing to show or focus
        sheetRoot.classList.add('open');
        try { panel.focus({ preventScroll: true }); } catch (e) { panel.focus(); }
      });
    });
  }

  function closeSheet() {
    if (!sheetOpen) return;
    sheetOpen = false;
    if (settleTimer) { clearTimeout(settleTimer); settleTimer = 0; }
    sheetRoot.classList.remove('settled');
    sheetRoot.classList.remove('open');
    try { doc.activeElement && doc.activeElement.blur(); } catch (e) {}
    root.classList.remove('sheet-open');
    doc.body.style.top = '';
    try { win.scrollTo(0, scrollY); } catch (e) {}
    var done = function () {
      closeTimer = 0;
      // nothing in here may leave the sheet open
      try { sheetRoot.hidden = true; } catch (e) {}
      try { panel.style.bottom = ''; } catch (e) {}
      try { if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true }); } catch (e) {}
    };
    if (reduced) done(); else closeTimer = setTimeout(done, 320);
  }

  function fitSheet() {
    var vv = win.visualViewport;
    if (!vv) return;
    root.style.setProperty('--vvh', Math.round(vv.height) + 'px');
    var offset = Math.max(0, Math.round((win.innerHeight || vv.height) - (vv.height + vv.offsetTop)));
    panel.style.bottom = sheetOpen ? offset + 'px' : '';
  }

  if (win.visualViewport) {
    var fitRaf = 0;
    var onViewport = function () {
      if (!sheetOpen || fitRaf) return;
      fitRaf = win.requestAnimationFrame(function () { fitRaf = 0; fitSheet(); });
    };
    win.visualViewport.addEventListener('resize', onViewport);
    win.visualViewport.addEventListener('scroll', onViewport);
  }

  /* The sheet's button and the plan cards slide in under the spot where "Reserve 2 free weeks"
     was pressed, so the second half of a double tap would land on "Hold my spot" (or a card) and
     record a plan the visitor never chose. A press anywhere inside the sheet during its first
     SETTLE_MS is dropped here, in the capture phase, before any handler runs: no row, no step
     change, no close. Keyboard presses are not affected. */
  sheetRoot.addEventListener('click', function (ev) {
    if (!sheetOpen || Date.now() - openedAt >= SETTLE_MS) return;
    ev.stopPropagation();
    ev.preventDefault();
  }, true);

  sheetRoot.addEventListener('click', function (ev) {
    var t = ev.target;
    while (t && t !== sheetRoot) {
      if (t.hasAttribute && t.hasAttribute('data-close')) { ev.preventDefault(); closeSheet(); return; }
      t = t.parentNode;
    }
  });

  doc.addEventListener('keydown', function (ev) {
    if (!sheetOpen) return;
    if (ev.key === 'Escape' || ev.key === 'Esc') { closeSheet(); return; }
    if (ev.key === 'Tab') {
      var focusables = panel.querySelectorAll(
        'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), ' +
        'a[href]:not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])'
      );
      var list = [];
      for (var i = 0; i < focusables.length; i++) {
        var f = focusables[i];
        if (f.offsetParent !== null) list.push(f);
      }
      if (!list.length) return;
      var first = list[0], last = list[list.length - 1];
      if (ev.shiftKey && (doc.activeElement === first || doc.activeElement === panel)) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && doc.activeElement === last) { ev.preventDefault(); first.focus(); }
    }
  });

  /* Hold my spot: counts the preselected plan when no card was pressed this load */
  holdButton.addEventListener('click', function () {
    if (!planTapped) {
      planTapped = true;
      try { send('tap', { button: 'plan_' + selectedPlan, via: 'hold' }); } catch (e) {}
    }
    showStep(2);
    try { emailInput.focus(); } catch (e) {}   // inside the click: opens the iOS keyboard; fitSheet follows the viewport
  });

  function validEmail(v) {
    if (!v || v.length > 254) return false;
    if (emailInput.checkValidity && !emailInput.checkValidity()) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  emailForm.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var v = (emailInput.value || '').trim();
    if (!validEmail(v)) {
      emailInput.setAttribute('aria-invalid', 'true');
      emailInput.classList.remove('shake');
      void emailInput.offsetWidth; // restarts the shake on a repeat press
      emailInput.classList.add('shake');
      emailInput.focus();
      return;
    }
    emailInput.removeAttribute('aria-invalid');
    send('email', { email: v, plan: selectedPlan });
    try { emailInput.blur(); } catch (e) {}
    for (var d = 0; d < doneEmails.length; d++) doneEmails[d].textContent = v;
    emailInput.value = '';
    setEmailState(true);
    showStep(3);
    win.requestAnimationFrame(function () {
      try { panel.focus({ preventScroll: true }); } catch (e) {}
      fitSheet();
    });
  });

  emailInput.addEventListener('input', function () { emailInput.removeAttribute('aria-invalid'); emailInput.classList.remove('shake'); });
  emailInput.addEventListener('animationend', function () { emailInput.classList.remove('shake'); });
})();
