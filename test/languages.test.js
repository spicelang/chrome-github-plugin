const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPage } = require('./helpers.js');
const linguist = require('../extension/shared/linguist.js');

const SETTINGS = { highlight: true, languageStats: true, spiceColor: '#9d0208' };

function stats(languages, spiceBytes) {
  const spice = { bytes: spiceBytes, files: 3, reassigned: {}, truncated: false };
  return { ok: true, stats: { languages, spice, merged: linguist.mergeLanguages(languages, spice) } };
}

/** Runs the language feature until the statistics are loaded and rendered. */
async function runLanguages(window) {
  const { languages } = window.SpiceGH;
  const updated = new Promise((resolve) => languages.setUpdateHandler(resolve));
  languages.run(SETTINGS);
  await updated;
  languages.run(SETTINGS);
}

function renderedEntries(doc) {
  return Array.from(doc.querySelectorAll('.sgh-langs .sgh-entry')).map(
    (e) => `${e.querySelector('.sgh-name').textContent} ${e.querySelector('.sgh-percent').textContent}`,
  );
}

const SIDEBAR = (languagesSection) => `
<div class="Layout-sidebar"><div class="sidebar">
  <div class="SidebarSection"><h2 class="Heading">About</h2><p>A programming language</p></div>
  ${languagesSection}
</div></div>`;

test('adds Spice to an existing language section and keeps GitHub grouping', async () => {
  const html = SIDEBAR(`
    <div class="SidebarSection"><h2 class="Heading"><span>Languages</span></h2>
      <div class="original"><span class="bar"></span><ul>
        <li><a href="#"><span>C++</span> <span>66.7%</span></a></li>
        <li><a href="#"><span>Python</span> <span>22.2%</span></a></li>
        <li><span>Other</span> <span>11.1%</span></li>
      </ul></div>
    </div>`);
  const messages = [];
  const window = createPage(html, 'https://github.com/spicelang/spice', (m) => {
    messages.push(m);
    return stats({ 'C++': 600, Python: 200, Shell: 50, Makefile: 50 }, 100);
  });
  await runLanguages(window);
  const doc = window.document;

  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [{ type: 'repoStats', owner: 'spicelang', repo: 'spice' }]);
  assert.deepEqual(renderedEntries(doc), ['C++ 60.0%', 'Python 20.0%', 'Spice 10.0%', 'Other 10.0%']);
  const section = doc.querySelector('.sgh-langs').parentElement;
  assert.ok(section.classList.contains('sgh-langs-host'), 'original list gets hidden');
  assert.ok(section.querySelector('.original'), 'original list stays in the DOM');
  const spice = [...doc.querySelectorAll('.sgh-segment')].find((s) => s.title.startsWith('Spice'));
  assert.equal(spice.style.width, '10%');
  const spiceLink = [...doc.querySelectorAll('a.sgh-entry')].find((a) => a.textContent.startsWith('Spice'));
  assert.match(spiceLink.href, /path%3A\*\.spice/);

  // Re-running does not re-render
  const list = doc.querySelector('.sgh-langs');
  window.SpiceGH.languages.run(SETTINGS);
  assert.equal(doc.querySelector('.sgh-langs'), list);
});

test('creates a language section for pure Spice repositories', async () => {
  const readme = '<article class="markdown-body"><h2>About</h2><h2>Languages</h2><p>Spice</p></article>';
  const window = createPage(readme + SIDEBAR(''), 'https://github.com/me/spice-only', () => stats({}, 4242));
  await runLanguages(window);
  const doc = window.document;
  assert.deepEqual(renderedEntries(doc), ['Spice 100.0%']);
  const headings = [...doc.querySelectorAll('.sidebar h2')].map((h) => h.textContent);
  assert.deepEqual(headings, ['About', 'Languages']);
  assert.equal(doc.querySelectorAll('.sidebar > .SidebarSection').length, 2);
  assert.equal(doc.querySelector('[data-sgh-created] p'), null, 'content of the cloned About section is removed');
  assert.equal(doc.querySelector('.markdown-body .sgh-langs'), null, 'README headings are ignored');
});

test('leaves repositories without Spice untouched', async () => {
  const window = createPage(SIDEBAR(''), 'https://github.com/o/no-spice', () => stats({ Go: 100 }, 0));
  await runLanguages(window);
  assert.equal(window.document.querySelector('.sgh-langs'), null);
  assert.equal(window.document.querySelectorAll('h2').length, 1);
});

test('only runs on repository overview pages', () => {
  const { currentRepo } = createPage('', 'https://github.com/').SpiceGH.languages;
  const at = (path) => currentRepo(new URL(`https://github.com${path}`));
  assert.equal(at('/o/r').key, 'o/r');
  assert.equal(at('/o/r/').key, 'o/r');
  assert.equal(at('/o/r/tree/main').key, 'o/r');
  assert.equal(at('/o/r/blob/main/x.spice'), null);
  assert.equal(at('/o'), null);
  assert.equal(at('/settings/profile'), null);
});
