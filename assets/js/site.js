// Home header: keep the name and title each on a single line.
//   1. Size the photo to be only as tall as the name + title block.
//   2. If the title doesn't fit beside the photo, move the photo ABOVE
//      so the titles get the full card width.
//   3. Only if it still doesn't fit, shrink the font until it does.
(function () {
  var head = document.querySelector('.home-head');
  if (!head) return;

  var titles = head.querySelector('.home-titles');
  var h1 = titles.querySelector('h1');
  var role = titles.querySelector('.role');
  var photo = head.querySelector('.photo');
  var MAX_H1 = 44;
  var MAX_ROLE = 18;

  function overflowing() {
    return (h1.scrollWidth - h1.clientWidth > 1) ||
           (role.scrollWidth - role.clientWidth > 1);
  }

  function layout() {
    head.classList.add('fit');          // single-line (nowrap)
    head.classList.remove('stacked');
    h1.style.fontSize = MAX_H1 + 'px';
    role.style.fontSize = MAX_ROLE + 'px';

    // Photo only as tall as the name + title.
    photo.style.height = titles.offsetHeight + 'px';

    if (overflowing()) {
      // Move the photo above; give the titles the full width.
      head.classList.add('stacked');
      photo.style.height = '';

      // Still too wide even at full width — shrink to fit.
      var scale = 1;
      while (overflowing() && scale > 0.5) {
        scale -= 0.02;
        h1.style.fontSize = (MAX_H1 * scale).toFixed(1) + 'px';
        role.style.fontSize = (MAX_ROLE * scale).toFixed(1) + 'px';
      }
    }
  }

  layout();
  window.addEventListener('resize', layout);
  window.addEventListener('load', layout);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
})();
