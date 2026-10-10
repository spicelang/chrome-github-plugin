/**
 * Adds Spice to the language statistics in the sidebar of repository pages.
 *
 * GitHub's own language list is hidden and replaced by a list that includes Spice. Languages GitHub displayed by name
 * stay visible, the rest is grouped into "Other" like on GitHub. Repositories without any language known to GitHub
 * have no language section at all, so in this case a new section is added to the sidebar.
 */
(function (root) {
  'use strict';

  const { SPICE, displayEntries, formatPercent, colors } = root.SpiceGH.linguist;

  const LIST_CLASS = 'sgh-langs';
  const HOST_CLASS = 'sgh-langs-host';
  const CREATED_ATTR = 'data-sgh-created';
  const OTHER_COLOR = '#ededed';
  const FALLBACK_COLOR = '#cccccc';
  const RESERVED_OWNERS = new Set([
    'about', 'account', 'codespaces', 'collections', 'dashboard', 'enterprise', 'explore', 'features', 'issues',
    'login', 'marketplace', 'new', 'notifications', 'orgs', 'organizations', 'pricing', 'pulls', 'search', 'settings',
    'sponsors', 'topics', 'trending', 'users',
  ]);

  // Statistics per repository: {result, time}
  const statsCache = new Map();
  const STATS_TTL_MS = 5 * 60 * 1000;
  // Called when statistics finished loading, so that the page gets updated
  let onUpdate = () => {};

  /** Returns owner and repo name if the current page is a repository overview page. */
  function currentRepo(loc) {
    const m = /^\/([^/]+)\/([^/]+?)(?:\/tree\/.*)?\/?$/.exec(loc.pathname);
    if (!m || RESERVED_OWNERS.has(m[1].toLowerCase())) return null;
    return { owner: m[1], repo: m[2], key: `${m[1]}/${m[2]}`.toLowerCase() };
  }

  /** Finds sidebar headings with the given text, ignoring rendered markdown like READMEs. */
  function findHeadings(doc, text) {
    return Array.from(doc.querySelectorAll('h2')).filter(
      (h) => h.textContent.trim() === text && !h.closest('.markdown-body, article'),
    );
  }

  function isVisible(el) {
    return typeof el.checkVisibility === 'function' ? el.checkVisibility() : true;
  }

  function requestStats(repo) {
    let entry = statsCache.get(repo.key);
    if (!entry || (entry.result && Date.now() - entry.time > STATS_TTL_MS)) {
      const next = { result: null, time: Date.now() };
      // Keep showing the previous result while refreshing
      if (entry && entry.result) next.result = entry.result;
      entry = next;
      chrome.runtime
        .sendMessage({ type: 'repoStats', owner: repo.owner, repo: repo.repo })
        .catch((e) => ({ ok: false, error: e.message }))
        .then((response) => {
          if (!response || !response.ok) {
            console.warn(`[Spice for GitHub] Could not load language stats: ${response && response.error}`);
          }
          entry.result = response || { ok: false, error: 'No response' };
          entry.time = Date.now();
          onUpdate();
        });
      statsCache.set(repo.key, entry);
    }
    return entry;
  }

  /** Reads the language names GitHub displays in its language section (ignoring our own list). */
  function visibleLanguageNames(section, languages) {
    const texts = new Set();
    for (const el of section.querySelectorAll('*')) {
      if (el.closest(`.${LIST_CLASS}`) || el.children.length > 0) continue;
      const text = el.textContent.trim();
      texts.add(text);
      texts.add(text.replace(/\s*\d+(\.\d+)?%$/, ''));
    }
    const names = new Set(Object.keys(languages).filter((name) => texts.has(name)));
    return { names, hasOther: texts.has('Other') };
  }

  /** Creates a new "Languages" section in the sidebar, modeled after the "About" section. */
  function createSection(doc) {
    // GitHub renders a second "About" section for narrow screens, which is hidden on wide screens
    const abouts = findHeadings(doc, 'About');
    const about = abouts.find(isVisible) || abouts[0];
    if (!about || !about.parentElement) return null;
    let unit = about.parentElement;
    // The classic layout wraps each sidebar section in a table-like row
    if (unit.parentElement && unit.parentElement.classList.contains('BorderGrid-row')) unit = unit.parentElement;
    const container = unit.parentElement;
    if (!container) return null;

    const clone = unit.cloneNode(true);
    const heading = Array.from(clone.querySelectorAll('h2')).find((h) => h.textContent.trim() === 'About');
    if (!heading) return null;
    for (const sibling of Array.from(heading.parentElement.children)) if (sibling !== heading) sibling.remove();
    heading.textContent = 'Languages';
    for (const el of [clone, ...clone.querySelectorAll('[id]')]) el.removeAttribute('id');
    clone.setAttribute(CREATED_ATTR, '');
    container.appendChild(clone);
    return heading.parentElement;
  }

  function el(doc, tag, className, attrs = {}) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }

  function dot(doc, color) {
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'sgh-dot');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.color = color;
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M8 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z');
    path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
    return svg;
  }

  function languageLink(repo, name) {
    const base = `https://github.com/${repo.owner}/${repo.repo}`;
    if (name === SPICE) {
      const query = `repo:${repo.owner}/${repo.repo} path:*.spice`;
      return `https://github.com/search?type=code&q=${encodeURIComponent(query)}`;
    }
    return `${base}/search?l=${encodeURIComponent(name.toLowerCase())}`;
  }

  function colorOf(name, settings) {
    if (name === SPICE) return settings.spiceColor;
    if (name === 'Other') return OTHER_COLOR;
    return colors[name] || FALLBACK_COLOR;
  }

  function renderList(doc, repo, entries, stats, settings) {
    const wrapper = el(doc, 'div', LIST_CLASS, { 'data-sgh-repo': repo.key });
    const bar = el(doc, 'span', 'sgh-bar', { role: 'img', 'aria-label': 'Language statistics' });
    for (const entry of entries) {
      const segment = el(doc, 'span', 'sgh-segment', {
        title: `${entry.name} ${formatPercent(entry.percent)}`,
        'aria-label': `${entry.name} ${entry.percent.toFixed(1)}`,
      });
      segment.style.width = `${entry.percent}%`;
      segment.style.backgroundColor = colorOf(entry.name, settings);
      bar.appendChild(segment);
    }
    wrapper.appendChild(bar);

    const list = el(doc, 'ul', 'sgh-list');
    for (const entry of entries) {
      const item = el(doc, 'li', 'sgh-item');
      const inner =
        entry.name === 'Other'
          ? el(doc, 'span', 'sgh-entry')
          : el(doc, 'a', 'sgh-entry', { href: languageLink(repo, entry.name) });
      inner.appendChild(dot(doc, colorOf(entry.name, settings)));
      const name = el(doc, 'span', 'sgh-name');
      name.textContent = entry.name;
      const percent = el(doc, 'span', 'sgh-percent');
      percent.textContent = formatPercent(entry.percent);
      inner.append(name, percent);
      if (entry.name === SPICE) {
        const files = stats.spice.files;
        inner.title =
          `${files} Spice file${files === 1 ? '' : 's'}, ${entry.bytes.toLocaleString()} bytes` +
          (stats.spice.truncated ? ' (repository too large, the numbers are incomplete)' : '') +
          ' – added by Spice for GitHub';
      }
      item.appendChild(inner);
      list.appendChild(item);
    }
    wrapper.appendChild(list);
    return wrapper;
  }

  function removeAll(doc) {
    for (const node of doc.querySelectorAll(`.${LIST_CLASS}`)) node.remove();
    for (const node of doc.querySelectorAll(`[${CREATED_ATTR}]`)) node.remove();
    for (const node of doc.querySelectorAll(`.${HOST_CLASS}`)) node.classList.remove(HOST_CLASS);
  }

  function run(settings, doc = root.document, loc = root.location) {
    const repo = currentRepo(loc);
    // Clean up after soft navigations to other pages or repositories
    for (const node of doc.querySelectorAll(`.${LIST_CLASS}`)) {
      if (!repo || node.getAttribute('data-sgh-repo') !== repo.key) removeAll(doc);
    }
    if (!repo) return;

    const headings = findHeadings(doc, 'Languages').filter((h) => !h.closest(`[${CREATED_ATTR}]`));
    if (headings.length === 0 && findHeadings(doc, 'About').length === 0) return; // Not loaded yet or no overview page

    const response = requestStats(repo).result;
    if (!response) return; // Still loading, onUpdate triggers another run
    if (!response.ok || response.stats.spice.bytes === 0) {
      // Nothing to add, show GitHub's original statistics
      removeAll(doc);
      return;
    }
    const stats = response.stats;

    if (headings.length > 0) {
      // GitHub shows its own language statistics, replace them
      for (const node of doc.querySelectorAll(`[${CREATED_ATTR}]`)) node.remove();
      for (const heading of headings) {
        const section = heading.parentElement;
        const { names, hasOther } = visibleLanguageNames(section, stats.languages);
        // GitHub loads the language list lazily, wait until it is there
        if (names.size === 0 && !hasOther && Object.keys(stats.languages).length > 0) continue;
        renderInto(doc, section, repo, displayEntries(stats.merged, names), stats, settings);
      }
      return;
    }
    const created = doc.querySelector(`[${CREATED_ATTR}]`);
    const section = created ? created.querySelector('h2').parentElement : createSection(doc);
    if (section) renderInto(doc, section, repo, displayEntries(stats.merged, null), stats, settings);
  }

  function renderInto(doc, section, repo, entries, stats, settings) {
    const signature = JSON.stringify([repo.key, settings.spiceColor, entries.map((e) => [e.name, e.bytes])]);
    const existing = section.querySelector(`:scope > .${LIST_CLASS}`);
    if (existing && existing.dataset.signature === signature && section.classList.contains(HOST_CLASS)) return;

    const list = renderList(doc, repo, entries, stats, settings);
    list.dataset.signature = signature;
    if (existing) existing.replaceWith(list);
    else section.appendChild(list);
    section.classList.add(HOST_CLASS);
  }

  function setUpdateHandler(handler) {
    onUpdate = handler;
  }

  (root.SpiceGH = root.SpiceGH || {}).languages = { run, clear: removeAll, currentRepo, setUpdateHandler };
})(globalThis);
