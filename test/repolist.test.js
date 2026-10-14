const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPage } = require('./helpers.js');
const linguist = require('../extension/shared/linguist.js');

const SETTINGS = { highlight: true, languageStats: true, spiceColor: '#9d0208' };

function stats(languages, spiceBytes) {
  const spice = { bytes: spiceBytes, files: 3, reassigned: {}, truncated: false };
  return { ok: true, stats: { languages, spice, merged: linguist.mergeLanguages(languages, spice) } };
}

const ITEM = (name, language) => `
<li itemprop="owns"><a href="/me/${name}" itemprop="name codeRepository">${name}</a>
  <div>${
    language
      ? `<span class="d-inline-block mr-3"><span class="repo-language-color" style="background-color: rgb(137, 224, 81)"></span><span itemprop="programmingLanguage">${language}</span></span>`
      : ''
  }<span>Updated <relative-time>now</relative-time></span></div></li>`;

async function runRepoList(window) {
  const { languages, repoList } = window.SpiceGH;
  const updated = new Promise((resolve) => languages.setUpdateHandler(resolve));
  repoList.run(SETTINGS);
  await updated;
  repoList.run(SETTINGS);
}

test('shows Spice as language if it is the majority, and restores on clear', async () => {
  const window = createPage(ITEM('shaker', 'Shell') + ITEM('other', 'Shell'), 'https://github.com/me?tab=repositories', (m) =>
    m.repo === 'shaker' ? stats({ Shell: 100 }, 900) : stats({ Shell: 100 }, 50),
  );
  await runRepoList(window);
  const langs = [...window.document.querySelectorAll('[itemprop="programmingLanguage"]')].map((e) => e.textContent);
  assert.deepEqual(langs, ['Spice', 'Shell']);
  assert.equal(window.document.querySelector('.repo-language-color').style.backgroundColor, 'rgb(157, 2, 8)');

  window.SpiceGH.repoList.clear(window.document);
  assert.equal(window.document.querySelector('[itemprop="programmingLanguage"]').textContent, 'Shell');
  assert.equal(window.document.querySelector('.repo-language-color').style.backgroundColor, 'rgb(137, 224, 81)');
});

test('adds a language to repositories GitHub shows none for', async () => {
  const window = createPage(ITEM('pure', null), 'https://github.com/me?tab=repositories', () => stats({}, 500));
  await runRepoList(window);
  const name = window.document.querySelector('[itemprop="programmingLanguage"]');
  assert.equal(name.textContent, 'Spice');
  assert.equal(name.closest("div").firstElementChild, name.parentElement);
});

const PINNED = (name, language) => `
<div class="pinned-item-list-item"><div><a href="/spicelang/${name}" class="Link"><span class="owner">spicelang</span>/<span class="repo">${name}</span></a></div>
  <p class="pinned-item-desc">desc</p>
  <p class="mb-0 f6">${
    language
      ? `<span class="d-inline-block mr-3"><span class="repo-language-color" style="background-color: rgb(0, 0, 0)"></span><span itemprop="programmingLanguage">${language}</span></span>`
      : ''
  }<a href="/spicelang/${name}/stargazers">88</a></p></div>`;

test('shows Spice in pinned repositories, with and without a GitHub language', async () => {
  const window = createPage(PINNED('spice', 'LLVM') + PINNED('pure', null), 'https://github.com/spicelang', () =>
    stats({ LLVM: 100 }, 900),
  );
  const { languages, repoList } = window.SpiceGH;
  const updated = new Promise((resolve) => languages.setUpdateHandler(resolve));
  repoList.run(SETTINGS);
  await updated;
  repoList.run(SETTINGS);
  const cards = [...window.document.querySelectorAll('.pinned-item-list-item')];
  for (const card of cards) {
    assert.equal(card.querySelector('[itemprop="programmingLanguage"]').textContent, 'Spice');
    assert.equal(card.querySelector('p.f6').firstElementChild.querySelector('[itemprop]').textContent, 'Spice');
  }
});
