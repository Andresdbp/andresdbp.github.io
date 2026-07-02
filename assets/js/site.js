// Navigation: mobile menu toggle + Contact dropdown
(function () {
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.querySelector('.nav');
  var dropdown = document.querySelector('.dropdown');
  var dropBtn = dropdown ? dropdown.querySelector('.drop-btn') : null;

  if (toggle && nav) {
    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  if (dropdown && dropBtn) {
    dropBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      dropdown.classList.toggle('open');
    });
  }

  // Close the mobile menu after tapping a real navigation link
  if (nav) {
    nav.querySelectorAll('.nav-link, .cv-btn, .drop-menu a').forEach(function (a) {
      a.addEventListener('click', function () {
        nav.classList.remove('open');
        toggle && toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // Click outside closes the dropdown
  document.addEventListener('click', function (e) {
    if (dropdown && !dropdown.contains(e.target)) dropdown.classList.remove('open');
  });

  // Escape closes both
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      dropdown && dropdown.classList.remove('open');
      if (nav) {
        nav.classList.remove('open');
        toggle && toggle.setAttribute('aria-expanded', 'false');
      }
    }
  });
})();
