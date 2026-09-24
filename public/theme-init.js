// Runs before first paint so the page never flashes the wrong theme.
(function () {
  var pref = 'system';
  try {
    pref = localStorage.getItem('cj:theme') || 'system';
  } catch {
    /* storage unavailable: follow the system */
  }
  var dark = pref === 'dark' || (pref !== 'light' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
