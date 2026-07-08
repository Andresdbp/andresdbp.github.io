// ============ Single-page portfolio: tabs, theme, mobile contacts ============
(function () {
  var TABS = ['about', 'resume', 'research', 'resources'];

  // ---------- Tab switching ----------
  var links = Array.prototype.slice.call(document.querySelectorAll('.nav-link'));
  var pages = Array.prototype.slice.call(document.querySelectorAll('article[data-page]'));

  function showTab(name, push) {
    if (TABS.indexOf(name) === -1) name = 'about';
    links.forEach(function (l) { l.classList.toggle('active', l.dataset.tab === name); });
    pages.forEach(function (p) { p.classList.toggle('active', p.dataset.page === name); });
    if (push && history.replaceState) history.replaceState(null, '', '#' + name);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  links.forEach(function (l) {
    l.addEventListener('click', function () { showTab(l.dataset.tab, true); });
  });

  window.addEventListener('hashchange', function () {
    showTab((location.hash || '').replace('#', ''), false);
  });

  // initial tab from hash (e.g. index.html#research)
  var initial = (location.hash || '').replace('#', '');
  if (TABS.indexOf(initial) !== -1) showTab(initial, false);

  // ---------- Theme toggle ----------
  var themeBtn = document.getElementById('themeToggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
      var next = cur === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) { }
    });
  }

  // ---------- Mobile contacts toggle ----------
  var sidebar = document.getElementById('sidebar');
  var cToggle = document.getElementById('contactsToggle');
  if (sidebar && cToggle) {
    cToggle.addEventListener('click', function () {
      var open = sidebar.classList.toggle('contacts-open');
      cToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      cToggle.querySelector('span').textContent = open ? 'Hide Contacts' : 'Show Contacts';
      cToggle.querySelector('i').className = open ? 'bi bi-chevron-up' : 'bi bi-chevron-down';
    });
  }
})();

// Suppress transitions during window resize to prevent breakpoint ghosting
(function () {
  var t;
  window.addEventListener('resize', function () {
    document.body.classList.add('no-transition');
    clearTimeout(t);
    t = setTimeout(function () { document.body.classList.remove('no-transition'); }, 150);
  });
})();
