const { test } = require('node:test');
const assert = require('node:assert/strict');
const linguist = require('../extension/shared/linguist.js');

const { globToRegex, computeSpiceStats, mergeLanguages, displayEntries, formatPercent } = linguist;

const blob = (path, size) => ({ path, size, type: 'blob', mode: '100644' });

test('glob patterns follow gitattributes semantics', () => {
  const cases = [
    ['*.spice', 'a/b/c.spice', true],
    ['*.spice', 'c.spice', true],
    ['/*.spice', 'a/c.spice', false],
    ['/*.spice', 'c.spice', true],
    ['src/*.spice', 'src/a.spice', true],
    ['src/*.spice', 'src/sub/a.spice', false],
    ['src/*.spice', 'x/src/a.spice', false],
    ['src/**', 'src/sub/a.spice', true],
    ['**/gen/*.spice', 'a/b/gen/x.spice', true],
    ['**/gen/*.spice', 'gen/x.spice', true],
    ['a/**/b.spice', 'a/b.spice', true],
    ['a/**/b.spice', 'a/x/y/b.spice', true],
    ['test?.spice', 'test1.spice', true],
    ['test[0-9].spice', 'test5.spice', true],
    ['test[!0-9].spice', 'test5.spice', false],
  ];
  for (const [pattern, path, expected] of cases) {
    assert.equal(globToRegex(pattern).test(path), expected, `${pattern} vs ${path}`);
  }
});

test('counts Spice files and skips vendored, documentation, symlinks and submodules', () => {
  const tree = [
    blob('src/main.spice', 100),
    blob('std/data/vector.spice', 50),
    blob('docs/example.spice', 1000),
    blob('node_modules/x/y.spice', 1000),
    blob('src/main.cpp', 999),
    { path: 'link.spice', type: 'blob', mode: '120000', size: 10 },
    { path: 'sub.spice', type: 'commit', mode: '160000' },
    { path: 'dir.spice', type: 'tree', mode: '040000' },
  ];
  assert.deepEqual(computeSpiceStats(tree, ''), { bytes: 150, files: 2, reassigned: {} });
});

test('respects linguist attributes in .gitattributes', () => {
  const tree = [
    blob('src/main.spice', 100),
    blob('third_party/lib.spice', 10),
    blob('docs/example.spice', 20),
    blob('gen/out.spice', 30),
    blob('src/legacy.sp', 40),
    blob('compat/old.spice', 5),
  ];
  const attributes = [
    '# comment',
    'third_party/** linguist-vendored',
    'docs/** -linguist-documentation',
    'gen/*.spice linguist-generated=true',
    '*.sp linguist-language=spice',
    'compat/*.spice linguist-detectable=false',
  ].join('\n');
  assert.deepEqual(computeSpiceStats(tree, attributes), { bytes: 160, files: 3, reassigned: {} });
});

test('moves bytes of .spice files that GitHub counts as another language', () => {
  const tree = [blob('a.spice', 100), blob('b.spice', 50)];
  const stats = computeSpiceStats(tree, '*.spice linguist-language=cpp');
  assert.deepEqual(stats, { bytes: 150, files: 2, reassigned: { 'C++': 150 } });
  assert.deepEqual(mergeLanguages({ 'C++': 200, Python: 120 }, stats), { Spice: 150, Python: 120, 'C++': 50 });
});

test('display entries group invisible languages into Other', () => {
  const merged = mergeLanguages({ 'C++': 600, Python: 200, Shell: 50, Dockerfile: 50 }, { bytes: 100, reassigned: {} });
  const entries = displayEntries(merged, new Set(['C++', 'Python']));
  assert.deepEqual(
    entries.map((e) => [e.name, formatPercent(e.percent)]),
    [['C++', '60.0%'], ['Python', '20.0%'], ['Spice', '10.0%'], ['Other', '10.0%']],
  );
  assert.deepEqual(
    displayEntries(mergeLanguages({}, { bytes: 42, reassigned: {} }), null).map((e) => [e.name, e.percent]),
    [['Spice', 100]],
  );
});
