/* Site behaviour: theme toggle, mobile menu, current-section link,
   copy-email button, CV availability, and deep links that open their target.
   No dependencies. Content lives in index.html; nothing here needs editing
   for routine updates. */
(function () {
  'use strict';

  var doc = document.documentElement;
  var lightQuery = window.matchMedia('(prefers-color-scheme: light)');

  var store = {
    get: function (key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } },
    set: function (key, value) { try { window.localStorage.setItem(key, value); } catch (e) { /* storage unavailable */ } }
  };

  function onMediaChange(query, handler) {
    if (query.addEventListener) query.addEventListener('change', handler);
    else if (query.addListener) query.addListener(handler);
  }

  /* ---------- Theme (dark first; light follows the system or the toggle) ---------- */
  var themeButton = document.querySelector('[data-theme-toggle]');

  function effectiveTheme() {
    var set = doc.getAttribute('data-theme');
    if (set === 'light' || set === 'dark') return set;
    return lightQuery.matches ? 'light' : 'dark';
  }

  function syncThemeButton() {
    if (!themeButton) return;
    var current = effectiveTheme();
    themeButton.setAttribute('data-current', current);
    themeButton.setAttribute('aria-label', current === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  }

  function announceTheme() { document.dispatchEvent(new CustomEvent('site:themechange')); }

  if (themeButton) {
    themeButton.addEventListener('click', function () {
      var next = effectiveTheme() === 'dark' ? 'light' : 'dark';
      doc.setAttribute('data-theme', next);
      store.set('theme', next);
      syncThemeButton();
      announceTheme();
    });
  }
  onMediaChange(lightQuery, function () { syncThemeButton(); announceTheme(); });
  syncThemeButton();

  /* ---------- Mobile menu ---------- */
  var nav = document.querySelector('[data-nav]');
  var navToggle = document.querySelector('[data-nav-toggle]');

  function setMenu(open) {
    if (!nav || !navToggle) return;
    nav.toggleAttribute('data-open', open);
    navToggle.setAttribute('aria-expanded', String(open));
  }
  if (navToggle) {
    navToggle.addEventListener('click', function () { setMenu(navToggle.getAttribute('aria-expanded') !== 'true'); });
  }
  if (nav) {
    nav.addEventListener('click', function (event) { if (event.target.closest('a')) setMenu(false); });
  }
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && navToggle && navToggle.getAttribute('aria-expanded') === 'true') {
      setMenu(false);
      navToggle.focus();
    }
  });
  document.addEventListener('click', function (event) {
    if (nav && nav.hasAttribute('data-open') && !nav.contains(event.target)) setMenu(false);
  });

  /* ---------- Current section in the nav ---------- */
  var sectionToLink = { research: '#research', next: '#research', publications: '#publications', about: '#about', contact: '#contact' };
  var navLinks = Array.prototype.slice.call(document.querySelectorAll('.nav-list a[href^="#"]'));

  function markCurrent(id) {
    var href = id ? sectionToLink[id] : null;
    navLinks.forEach(function (a) {
      if (href && a.getAttribute('href') === href) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
  }

  if ('IntersectionObserver' in window) {
    var visible = {};
    var watched = Object.keys(sectionToLink).map(function (id) { return document.getElementById(id); }).filter(Boolean);
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) { visible[entry.target.id] = entry.isIntersecting; });
      var current = null;
      watched.forEach(function (section) { if (visible[section.id]) current = section.id; });
      markCurrent(current);
    }, { rootMargin: '-40% 0px -55% 0px' });
    watched.forEach(function (section) { observer.observe(section); });
  }

  /* ---------- Deep links open what they point at ---------- */
  function revealTarget(hash, flash) {
    if (!hash || hash.length < 2) return;
    var target = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (!target) return;
    var details = target.matches('details') ? [target] : [];
    var inner = target.querySelector(':scope details.xp-more');
    if (inner) details.push(inner);
    var parent = target.closest('details');
    if (parent) details.push(parent);
    details.forEach(function (d) { d.open = true; });
    if (flash && target.classList.contains('xp')) {   // a colour wash, shortened by the reduced-motion rule
      target.classList.remove('is-target');
      void target.offsetWidth; // restart the highlight
      target.classList.add('is-target');
    }
  }
  document.addEventListener('click', function (event) {
    var link = event.target.closest('a[href^="#"]');
    if (link) revealTarget(link.getAttribute('href'), true);
  });
  window.addEventListener('hashchange', function () { revealTarget(window.location.hash, true); });
  revealTarget(window.location.hash, false);

  /* ---------- Copy email ---------- */
  var copyStatus = document.querySelector('[data-copy-status]');
  Array.prototype.forEach.call(document.querySelectorAll('[data-copy]'), function (button) {
    var label = button.querySelector('[data-copy-label]') || button;
    var original = label.textContent;
    var timer = null;

    function reset() { label.textContent = original; button.removeAttribute('data-state'); }
    function selectSource() {
      var source = document.querySelector('[data-copy-source]');
      if (!source || !window.getSelection) return;
      var range = document.createRange();
      range.selectNodeContents(source);
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }

    button.addEventListener('click', function () {
      var text = button.getAttribute('data-copy');
      clearTimeout(timer);
      function done() {
        label.textContent = 'Copied';
        button.setAttribute('data-state', 'done');
        if (copyStatus) copyStatus.textContent = 'Email address copied.';
        timer = setTimeout(reset, 2200);
      }
      function fallback() {
        selectSource();
        label.textContent = 'Address selected';
        if (copyStatus) copyStatus.textContent = 'Email address selected. Copy it with your keyboard.';
        timer = setTimeout(reset, 3000);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
      else fallback();
    });
  });

  /* ---------- CV availability ----------
     CV links start as email requests, so nothing points at a missing file.
     Once cv/Zhuoxuan_Li_CV.pdf is published, they become downloads and the
     header gains a CV link. */
  var cvLinks = Array.prototype.slice.call(document.querySelectorAll('[data-cv-link]'));
  var cvNav = document.querySelector('[data-cv-nav]');
  function cvReady() {
    cvLinks.forEach(function (a) {
      var href = a.getAttribute('data-cv-href');
      var text = a.getAttribute('data-cv-ready-label');
      var label = a.querySelector('[data-cv-label]');
      if (href) a.setAttribute('href', href);
      if (label && text) label.textContent = text;
    });
    if (cvNav) cvNav.hidden = false;
  }
  if (cvLinks.length && /^https?:$/.test(window.location.protocol) && window.fetch) {
    window.fetch(cvLinks[0].getAttribute('data-cv-href'), { method: 'HEAD', cache: 'no-store' })
      .then(function (response) { if (response.ok) cvReady(); })
      .catch(function () { /* stays an email request */ });
  }
})();
