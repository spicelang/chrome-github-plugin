(function () {
  'use strict';

  const DEFAULTS = globalThis.SpiceGH.DEFAULT_SETTINGS;
  const $ = (id) => document.getElementById(id);
  let statusTimer = null;

  function showStatus(text) {
    $('status').textContent = text;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => ($('status').textContent = ''), 3000);
  }

  async function load() {
    const settings = await chrome.storage.sync.get(DEFAULTS);
    $('highlight').checked = settings.highlight;
    $('languageStats').checked = settings.languageStats;
    $('spiceColor').value = settings.spiceColor;
    const { token } = await chrome.storage.local.get('token');
    $('token').value = token || '';
  }

  for (const id of ['highlight', 'languageStats']) {
    $(id).addEventListener('change', (e) => chrome.storage.sync.set({ [id]: e.target.checked }));
  }
  $('spiceColor').addEventListener('change', (e) => chrome.storage.sync.set({ spiceColor: e.target.value }));
  $('resetColor').addEventListener('click', async () => {
    await chrome.storage.sync.set({ spiceColor: DEFAULTS.spiceColor });
    $('spiceColor').value = DEFAULTS.spiceColor;
  });

  $('saveToken').addEventListener('click', async () => {
    const token = $('token').value.trim();
    if (token) await chrome.storage.local.set({ token });
    else await chrome.storage.local.remove('token');
    // Cached responses may differ with the new token (e.g. private repositories)
    await chrome.runtime.sendMessage({ type: 'clearCache' });
    showStatus(token ? 'Token saved.' : 'Token removed.');
  });

  $('clearCache').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'clearCache' });
    showStatus('Cache cleared.');
  });

  load();
})();
