const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const CONTENT_SCRIPTS = [
  'shared/settings.js',
  'shared/tokenizer.js',
  'shared/linguist-data.js',
  'shared/linguist.js',
  'content/highlight.js',
  'content/languages.js',
  'content/repolist.js',
];
const sources = CONTENT_SCRIPTS.map((file) => fs.readFileSync(path.join(__dirname, '..', 'extension', file), 'utf8'));

/**
 * Creates a DOM with the content scripts (except the entry point) loaded.
 *
 * @param {string} html Body HTML
 * @param {string} url Page URL
 * @param {(message: object) => any} [onMessage] Handler for chrome.runtime.sendMessage
 */
function createPage(html, url, onMessage = () => undefined) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url, runScripts: 'outside-only' });
  const { window } = dom;
  window.chrome = { runtime: { sendMessage: async (message) => onMessage(message) } };
  for (const source of sources) window.eval(source);
  return window;
}

/** Counts the DOM mutations caused by fn. */
async function countMutations(window, fn) {
  const records = [];
  const observer = new window.MutationObserver((r) => records.push(...r));
  observer.observe(window.document.body, { childList: true, subtree: true, characterData: true, attributes: true });
  fn();
  await new Promise((resolve) => setTimeout(resolve, 0));
  records.push(...observer.takeRecords());
  observer.disconnect();
  return records.length;
}

/** Returns "type:text" for all highlighted tokens inside of an element. */
function highlighted(el) {
  return Array.from(el.querySelectorAll('.sgh-tok'))
    .filter((span) => [...span.classList].some((c) => c.startsWith('sgh-') && c !== 'sgh-tok' && c !== 'sgh-dct'))
    .map((span) => {
      const type = [...span.classList].find((c) => c.startsWith('sgh-') && c !== 'sgh-tok' && c !== 'sgh-dct');
      return `${type.slice(4)}:${span.getAttribute('data-code-text') ?? span.textContent}`;
    });
}

module.exports = { createPage, countMutations, highlighted };
