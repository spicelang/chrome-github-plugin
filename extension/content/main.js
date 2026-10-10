/**
 * Entry point of the content script. GitHub is a single page application that renders lazily, so all features run
 * idempotently whenever the page changes.
 */
(function (root) {
  'use strict';

  const { highlight, languages, DEFAULT_SETTINGS } = root.SpiceGH;
  const settings = { ...DEFAULT_SETTINGS };
  let scheduled = null;

  function run() {
    scheduled = null;
    try {
      if (settings.highlight) highlight.run();
      if (settings.languageStats) languages.run(settings);
    } catch (e) {
      console.error('[Spice for GitHub]', e);
    }
  }

  function schedule() {
    if (scheduled === null) scheduled = setTimeout(run, 100);
  }

  languages.setUpdateHandler(schedule);

  chrome.storage.sync.get(DEFAULT_SETTINGS).then((stored) => {
    Object.assign(settings, stored);
    schedule();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in DEFAULT_SETTINGS) settings[key] = newValue === undefined ? DEFAULT_SETTINGS[key] : newValue;
    }
    if (!settings.highlight) highlight.clear();
    languages.clear(root.document);
    schedule();
  });

  new MutationObserver(schedule).observe(root.document.documentElement, { childList: true, subtree: true });
  // Events of GitHub's soft navigations bubble up to the window
  for (const event of ['turbo:load', 'turbo:render', 'pjax:end', 'popstate']) root.addEventListener(event, schedule);
})(globalThis);
