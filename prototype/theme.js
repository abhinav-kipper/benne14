// Theme switch for the prototype: ?theme=light (passed on to embedded screens).
(function () {
  var t = new URLSearchParams(location.search).get('theme');
  if (!t) return;
  document.documentElement.setAttribute('data-theme', t);
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('iframe[src]').forEach(function (f) {
      var s = f.getAttribute('src'); f.setAttribute('src', s + (s.indexOf('?') < 0 ? '?' : '&') + 'theme=' + t);
    });
  });
})();
