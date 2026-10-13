/**
 * Shows Spice as the primary language of repositories in repository lists (profiles, organizations, search results,
 * stars) and in pinned repositories if Spice makes up the majority of the code. GitHub shows its largest known language there, which is wrong
 * for Spice repositories, e.g. "Shell" for a repository with a few scripts and lots of Spice code.
 */
(function (root) {
  'use strict';

  const { SPICE } = root.SpiceGH.linguist;

  const ITEM_SELECTOR = 'a[itemprop~="codeRepository"]';
  // Pinned repositories of profiles and organizations have no itemprop, the first link of the card is the repository
  const PINNED_SELECTOR = '.pinned-item-list-item';
  const LANGUAGE_SELECTOR = '[itemprop="programmingLanguage"]';
  const MARK_ATTR = 'data-sgh-repo-lang';
  // Every repository costs API requests, so only a few are loaded at the same time
  const MAX_PENDING = 4;

  function repoOf(link) {
    const m = /^\/([^/]+)\/([^/]+?)\/?$/.exec(new URL(link.getAttribute('href'), root.location.href).pathname);
    return m ? { owner: m[1], repo: m[2], key: `${m[1]}/${m[2]}`.toLowerCase() } : null;
  }

  /** Finds all repository cards on the page: {repo, item}. */
  function findItems(doc) {
    const found = [];
    for (const link of doc.querySelectorAll(ITEM_SELECTOR)) {
      const item = link.closest('li, article');
      const repo = repoOf(link);
      if (repo && item) found.push({ repo, item });
    }
    for (const item of doc.querySelectorAll(PINNED_SELECTOR)) {
      const link = Array.from(item.querySelectorAll('a[href]')).find((a) => repoOf(a));
      const repo = link && repoOf(link);
      if (repo) found.push({ repo, item });
    }
    return found;
  }

  /** Returns the row of metadata (language, stars, ...) of a card, which has no language yet. */
  function metadataRow(item) {
    const time = item.querySelector('relative-time');
    if (time && time.parentElement !== item && time.parentElement.parentElement) return time.parentElement.parentElement;
    const stars = item.querySelector('a[href$="/stargazers"], a[href$="/forks"], a[href$="/network/members"]');
    return stars ? stars.parentElement : item.querySelector('p.f6');
  }

  /** Returns the element wrapping the colored dot and the name of the language of a list item, if there is one. */
  function languageWrapper(item) {
    const name = item.querySelector(LANGUAGE_SELECTOR);
    return name ? name.parentElement : null;
  }

  /** Creates the language element for repositories that GitHub shows without a language. */
  function createWrapper(doc, item) {
    const row = metadataRow(item);
    if (!row) return null;
    const wrapper = doc.createElement('span');
    wrapper.className = 'd-inline-block mr-3';
    wrapper.setAttribute(MARK_ATTR, 'created');
    const color = doc.createElement('span');
    color.className = 'repo-language-color';
    const name = doc.createElement('span');
    name.setAttribute('itemprop', 'programmingLanguage');
    // GitHub renders whitespace between the dot and the name
    wrapper.append(color, doc.createTextNode(' '), name);
    // The language comes first in the row of metadata, before stars, forks, etc.
    row.insertBefore(wrapper, row.firstChild);
    return wrapper;
  }

  function setLanguage(wrapper, name, color) {
    const nameEl = wrapper.querySelector(LANGUAGE_SELECTOR);
    const colorEl = wrapper.querySelector('.repo-language-color');
    if (wrapper.getAttribute(MARK_ATTR) !== 'created' && !wrapper.hasAttribute('data-sgh-original')) {
      const original = [nameEl.textContent, colorEl ? colorEl.style.backgroundColor : ''];
      wrapper.setAttribute('data-sgh-original', JSON.stringify(original));
    }
    nameEl.textContent = name;
    if (colorEl) colorEl.style.backgroundColor = color;
    if (wrapper.getAttribute(MARK_ATTR) !== 'created') wrapper.setAttribute(MARK_ATTR, SPICE);
  }

  function restore(wrapper) {
    if (wrapper.getAttribute(MARK_ATTR) === 'created') return wrapper.remove();
    const [name, color] = JSON.parse(wrapper.getAttribute('data-sgh-original'));
    wrapper.querySelector(LANGUAGE_SELECTOR).textContent = name;
    const colorEl = wrapper.querySelector('.repo-language-color');
    if (colorEl) colorEl.style.backgroundColor = color;
    wrapper.removeAttribute(MARK_ATTR);
    wrapper.removeAttribute('data-sgh-original');
  }

  function clear(doc) {
    for (const wrapper of doc.querySelectorAll(`[${MARK_ATTR}]`)) restore(wrapper);
  }

  function run(settings, doc = root.document) {
    const { requestStats, peekStats } = root.SpiceGH.languages;
    let pending = 0;
    for (const { repo, item } of findItems(doc)) {
      let entry = peekStats(repo);
      if (!entry) {
        if (pending >= MAX_PENDING) continue;
        entry = requestStats(repo);
      }
      if (!entry.result) {
        pending++;
        continue;
      }

      const { ok, stats } = entry.result;
      const wrapper = languageWrapper(item);
      const total = ok ? Object.values(stats.merged).reduce((a, b) => a + b, 0) : 0;
      if (!ok || total === 0 || stats.spice.bytes * 2 <= total) {
        if (wrapper && wrapper.hasAttribute(MARK_ATTR)) restore(wrapper);
        continue;
      }
      const target = wrapper || createWrapper(doc, item);
      if (target) setLanguage(target, SPICE, settings.spiceColor);
    }
  }

  (root.SpiceGH = root.SpiceGH || {}).repoList = { run, clear };
})(globalThis);
