/** Settings shared by the content scripts and the options page. They are stored in chrome.storage.sync. */
(function (root) {
  'use strict';

  const DEFAULT_SETTINGS = {
    highlight: true,
    languageStats: true,
    spiceColor: '#9d0208',
  };

  (root.SpiceGH = root.SpiceGH || {}).DEFAULT_SETTINGS = DEFAULT_SETTINGS;
})(globalThis);
