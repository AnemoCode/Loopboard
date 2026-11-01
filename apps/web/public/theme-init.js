// Applies the saved theme before first paint (kept external so the CSP needs no inline scripts).
try {
  var t = localStorage.getItem('theme') || 'system';
  var dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
} catch (e) {}
