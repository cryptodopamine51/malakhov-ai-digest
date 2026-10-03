(() => {
  const theme = document.getElementById('archive-theme');
  if (theme) theme.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    theme.setAttribute('aria-label', next === 'dark' ? 'Светлая тема' : 'Тёмная тема');
    try { localStorage.setItem('theme', next); } catch (_) {}
  });
  // Hydration is unnecessary: use browser-native navigation and static files.
  document.querySelectorAll('img').forEach(img => img.addEventListener('error', () => {
    img.removeAttribute('srcset'); img.style.visibility = 'hidden';
  }, { once: true }));
  const progress = document.querySelector('[role="progressbar"]');
  if (progress) window.addEventListener('scroll', () => {
    const el = document.documentElement;
    const value = Math.max(0, Math.min(100, el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight) * 100));
    progress.style.width = value + '%'; progress.setAttribute('aria-valuenow', String(Math.round(value)));
  }, { passive: true });
  document.querySelectorAll('button').forEach(button => {
    const label = button.getAttribute('aria-label') || '';
    if (label === 'Предыдущая фотография' || label === 'Следующая фотография') {
      button.addEventListener('click', () => {
        const section = button.closest('section');
        const viewport = section && [...section.querySelectorAll('div')].find(e => e.className.includes('overflow-x-auto'));
        if (viewport) viewport.scrollBy({ left: (label === 'Предыдущая фотография' ? -1 : 1) * viewport.clientWidth, behavior: 'smooth' });
      });
    }
    if (label === 'Наверх') button.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  });
  const form = document.getElementById('archive-search');
  if (!form) return;
  const input = document.getElementById('archive-query');
  const status = document.getElementById('archive-search-status');
  const results = document.getElementById('archive-search-results');
  const scriptUrl = [...document.scripts].find(s => s.src.endsWith('/assets/archive.js')).src;
  const root = new URL('../', scriptUrl);
  let index;
  const search = async () => {
    const query = input.value.trim().slice(0, 200);
    const url = new URL(location.href);
    if (query) url.searchParams.set('q', query); else url.searchParams.delete('q');
    history.replaceState(null, '', url);
    results.replaceChildren();
    if (!query) { status.textContent = 'Введите запрос для поиска.'; return; }
    status.textContent = 'Поиск…';
    try {
      if (!index) {
        const response = await fetch(new URL('assets/search.json', root));
        if (!response.ok) throw new Error('Search index is unavailable');
        index = await response.json();
      }
      const terms = query.toLocaleLowerCase('ru').split(/\s+/).filter(Boolean);
      const matches = index.filter(a => terms.every(term => `${a.title} ${a.teaser} ${a.text} ${a.source}`.toLocaleLowerCase('ru').includes(term)));
      status.textContent = matches.length ? `Найдено материалов: ${matches.length}` : 'Ничего не найдено. Попробуйте другой запрос.';
      for (const article of matches) {
        const a = document.createElement('a');
        a.href = new URL(article.path.replace(/^\//, ''), root);
        a.className = 'block rounded border border-line p-5 hover:border-accent';
        const h = document.createElement('h2'); h.className = 'text-base font-semibold text-ink'; h.textContent = article.title;
        const p = document.createElement('p'); p.className = 'mt-3 text-sm leading-relaxed text-muted'; p.textContent = article.teaser;
        const source = document.createElement('p'); source.className = 'mt-3 text-sm text-muted'; source.textContent = article.source;
        a.append(h, p, source); results.append(a);
      }
    } catch (_) { status.textContent = 'Не удалось загрузить поиск. Материалы доступны в разделах и архиве по датам.'; }
  };
  input.value = new URLSearchParams(location.search).get('q') || '';
  form.addEventListener('submit', event => { event.preventDefault(); search(); });
  if (input.value) search();
})();
