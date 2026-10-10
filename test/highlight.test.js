const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPage, countMutations, highlighted } = require('./helpers.js');

const CLASSIC_DIFF = `
<div class="file" data-tagsearch-path="src/main.spice">
  <div class="file-header" data-path="src/main.spice"></div>
  <table><tbody>
    <tr><td class="blob-num blob-num-hunk"></td><td class="blob-code blob-code-inner blob-code-hunk">@@ -1,4 +1,5 @@ f&lt;int&gt; main() {</td></tr>
    <tr><td class="blob-num"></td><td class="blob-code blob-code-context"><span id="l1" class="blob-code-inner"> * still in comment */</span></td></tr>
    <tr><td class="blob-num"></td><td class="blob-code blob-code-deletion"><span id="l2" class="blob-code-inner">int x = <span class="x x-first x-last">1</span>;</span></td></tr>
    <tr><td class="blob-num"></td><td class="blob-code blob-code-addition"><span id="l3" class="blob-code-inner">/* open</span></td></tr>
    <tr><td class="blob-num"></td><td class="blob-code blob-code-addition"><span id="l4" class="blob-code-inner">int y = 2;</span></td></tr>
    <tr><td class="blob-num"></td><td class="blob-code blob-code-deletion"><span id="l5" class="blob-code-inner">int z = 3;</span></td></tr>
  </tbody></table>
</div>
<div class="file" data-tagsearch-path="src/main.cpp">
  <table><tbody>
    <tr><td class="blob-code blob-code-addition"><span id="cpp" class="blob-code-inner">int y = 2;</span></td></tr>
  </tbody></table>
</div>`;

test('highlights classic diffs of Spice files only', async () => {
  const window = createPage(CLASSIC_DIFF, 'https://github.com/o/r/commit/abc');
  const $ = (id) => window.document.getElementById(id);
  window.SpiceGH.highlight.run();

  assert.deepEqual(highlighted($('l1')), ['comment: * still in comment */']);
  assert.deepEqual(highlighted($('l2')), ['keyword:int', 'number:1']);
  // Word diff markers are kept
  assert.equal($('l2').querySelector('.x .sgh-number').textContent, '1');
  assert.equal($('l2').textContent, 'int x = 1;');
  assert.deepEqual(highlighted($('l3')), ['comment:/* open']);
  // The comment opened in the new version continues, the old version is unaffected
  assert.deepEqual(highlighted($('l4')), ['comment:int y = 2;']);
  assert.deepEqual(highlighted($('l5')), ['keyword:int', 'number:3']);
  assert.deepEqual(highlighted($('cpp')), []);
  assert.equal(window.document.querySelector('.blob-code-hunk .sgh-tok'), null);

  assert.equal(await countMutations(window, () => window.SpiceGH.highlight.run()), 0, 'second run is a no-op');
});

test('highlights split React diffs with the path in the table label', () => {
  const html = `
  <div id="diff-content-parent">
   <div role="region" aria-labelledby="heading-1">
    <h3 id="heading-1"><code>other.cpp</code></h3>
    <table aria-label="Diff for: other.cpp"><tbody>
      <tr class="diff-line-row"><td class="diff-text-cell"><code class="diff-text"><div id="cpp" class="diff-text-inner">int x;</div></code></td></tr>
    </tbody></table>
   </div>
   <div role="region" aria-labelledby="heading-2">
    <h3 id="heading-2"><code>\u200esrc/old.spice → src/vector.spice\u200e</code></h3>
    <table aria-label="Diff for: src/old.spice → src/vector.spice"><tbody>
      <tr class="diff-line-row"><td class="diff-hunk-cell"><code class="diff-text-cell hunk"><div id="hunk" class="diff-text-inner">@@ -1,2 +1,2 @@ p foo()</div></code></td></tr>
      <tr class="diff-line-row">
        <td class="diff-line-number">1</td>
        <td class="diff-text-cell"><code class="diff-text deletion"><div id="left" class="diff-text-inner">p foo() {}</div></code></td>
        <td class="diff-line-number">1</td>
        <td class="diff-text-cell"><code class="diff-text addition"><div id="right" class="diff-text-inner">p bar() { /* x</div></code></td>
      </tr>
      <tr class="diff-line-row">
        <td class="diff-line-number">2</td>
        <td class="diff-text-cell"><code class="diff-text"><div id="left2" class="diff-text-inner">}</div></code></td>
        <td class="diff-line-number">2</td>
        <td class="diff-text-cell"><code class="diff-text"><div id="right2" class="diff-text-inner">*/ }</div></code></td>
      </tr>
    </tbody></table>
   </div>
  </div>`;
  const window = createPage(html, 'https://github.com/o/r/commit/abc');
  const $ = (id) => window.document.getElementById(id);
  window.SpiceGH.highlight.run();
  assert.deepEqual(highlighted($('left')), ['keyword:p', 'function:foo']);
  assert.deepEqual(highlighted($('right')), ['keyword:p', 'function:bar', 'comment:/* x']);
  assert.deepEqual(highlighted($('left2')), []);
  assert.deepEqual(highlighted($('right2')), ['comment:*/']);
  assert.deepEqual(highlighted($('hunk')), []);
  assert.deepEqual(highlighted($('cpp')), []);
});

test('resolves paths from labelled regions when tables have no label', () => {
  const html = `
  <div id="diff-content-parent">
    <div role="region" aria-labelledby="h"><h3 id="h">a/b.spice</h3>
      <table><tbody><tr><td class="diff-text-cell"><code class="diff-text"><div id="l" class="diff-text-inner">int x;</div></code></td></tr></tbody></table>
    </div>
  </div>`;
  const window = createPage(html, 'https://github.com/o/r/commit/abc');
  window.SpiceGH.highlight.run();
  assert.deepEqual(highlighted(window.document.getElementById('l')), ['keyword:int']);
});

test('highlights file views using the full source for the lexer state', async () => {
  const html = `
  <textarea id="read-only-cursor-text-area">/* a\nb */\nint x;</textarea>
  <div class="react-code-lines">
    <div class="react-code-text"><div id="LC2" class="react-file-line html-div" data-line-number="2">b */</div></div>
    <div class="react-code-text"><div id="LC3" class="react-file-line html-div" data-line-number="3"><span data-code-text="int x;"></span></div></div>
  </div>`;
  const window = createPage(html, 'https://github.com/o/r/blob/feature/branch/src/x.spice');
  const $ = (id) => window.document.getElementById(id);
  window.SpiceGH.highlight.run();
  assert.deepEqual(highlighted($('LC2')), ['comment:b */']);
  // Lines rendered via data-code-text keep using it
  assert.deepEqual(highlighted($('LC3')), ['keyword:int']);
  assert.equal($('LC3').textContent, '');
  assert.equal(await countMutations(window, () => window.SpiceGH.highlight.run()), 0, 'second run is a no-op');
});

test('does not touch file views of other languages', () => {
  const html = `<div class="react-file-line" id="LC1" data-line-number="1">int x;</div>`;
  const window = createPage(html, 'https://github.com/o/r/blob/main/x.cpp');
  window.SpiceGH.highlight.run();
  assert.deepEqual(highlighted(window.document.getElementById('LC1')), []);
});

test('replaces GitHub highlighting of .spice files mapped to another language', () => {
  const html = `<div class="react-file-line" id="LC1" data-line-number="1"><span class="pl-k">int</span> <span class="pl-en">foo</span>();</div>`;
  const window = createPage(html, 'https://github.com/o/r/blob/main/x.spice');
  const line = window.document.getElementById('LC1');
  window.SpiceGH.highlight.run();
  assert.deepEqual(highlighted(line), ['keyword:int', 'function:foo']);
  assert.equal(line.querySelector('[class*="pl-"]'), null);
  assert.equal(line.textContent, 'int foo();');
});

test('highlights markdown code blocks with the spice language', () => {
  const html = `
  <div class="markdown-body">
    <pre lang="spice"><code id="spice">f&lt;int&gt; main() {\n  /* multi\n  line */\n  return 0;\n}</code></pre>
    <pre lang="cpp"><code id="cpp">int x;</code></pre>
  </div>`;
  const window = createPage(html, 'https://github.com/o/r');
  window.SpiceGH.highlight.run();
  const spice = window.document.getElementById('spice');
  assert.deepEqual(highlighted(spice), [
    'keyword:f', 'keyword:int', 'function:main', 'comment:/* multi\n  line */', 'keyword:return', 'number:0',
  ]);
  assert.equal(spice.textContent, 'f<int> main() {\n  /* multi\n  line */\n  return 0;\n}');
  assert.deepEqual(highlighted(window.document.getElementById('cpp')), []);
});

test('highlights permalink snippets', () => {
  const html = `
  <div class="border rounded-2">
    <p><a href="https://github.com/o/r/blob/0123/src/main.spice#L1-L2">src/main.spice</a></p>
    <div class="blob-wrapper"><table><tbody>
      <tr><td class="blob-num" data-line-number="1"></td><td id="s1" class="blob-code blob-code-inner">import "std/io";</td></tr>
    </tbody></table></div>
  </div>`;
  const window = createPage(html, 'https://github.com/o/r/issues/1');
  window.SpiceGH.highlight.run();
  assert.deepEqual(highlighted(window.document.getElementById('s1')), ['keyword:import', 'string:"std/io"']);
});
