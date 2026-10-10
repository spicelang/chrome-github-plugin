const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tokenize, tokenizeLines } = require('../extension/shared/tokenizer.js');

const SAMPLE = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.spice'), 'utf8');

function typesOf(line) {
  return tokenize(line)
    .tokens.filter((t) => t.type !== 'plain' && t.type !== 'operator')
    .map((t) => `${t.type}:${t.text}`);
}

/** Collects Spice sources of a local checkout of the Spice repository, if available. */
function spiceRepoFiles() {
  const repo = process.env.SPICE_REPO || path.join(__dirname, '..', '..', 'spice');
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'deps' || entry.name.startsWith('cmake-build')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.spice')) files.push(full);
    }
  };
  if (fs.existsSync(path.join(repo, 'std'))) walk(repo);
  return files;
}

test('tokens concatenate to the input', () => {
  const sources = [SAMPLE, '', '/* unterminated', '"unterminated', "'", '#![', '0x', 'a 🌶 b', '/**/ x'];
  for (const src of sources) {
    assert.equal(tokenize(src).tokens.map((t) => t.text).join(''), src);
  }
});

test('classifies keywords, types, functions and literals', () => {
  assert.deepEqual(typesOf('public f<int> foo<T>(const T& x) {'), [
    'keyword:public', 'keyword:f', 'keyword:int', 'function:foo', 'type:T', 'keyword:const', 'type:T',
  ]);
  assert.deepEqual(typesOf('heap Vector<T>* v = nil<heap Vector<T>*>;'), [
    'keyword:heap', 'type:Vector', 'type:T', 'constant:nil', 'keyword:heap', 'type:Vector', 'type:T',
  ]);
  assert.deepEqual(typesOf('printf("%d\\n", sizeof<T>() + 1.5e3 + 12s + 0b101l + 0x1Ful);'), [
    'builtin:printf', 'string:"%d', 'escape:\\n', 'string:"', 'builtin:sizeof', 'type:T', 'number:1.5e3',
    'number:12s', 'number:0b101l', 'number:0x1Ful',
  ]);
  assert.deepEqual(typesOf('return this.len;'), ['keyword:return', 'self:this', 'plain:len'].filter((t) => !t.startsWith('plain')));
  assert.deepEqual(typesOf('f<int> main() {}'), ['keyword:f', 'keyword:int', 'function:main']);
  assert.deepEqual(typesOf('case Kind::GLOBAL_DECLARED_TWICE: T x = MAX;'), [
    'keyword:case', 'type:Kind', 'constant:GLOBAL_DECLARED_TWICE', 'type:T', 'constant:MAX',
  ]);
  assert.deepEqual(typesOf("char c = '\\'';"), ['keyword:char', "string:'", "escape:\\'", "string:'"]);
});

test('highlights attribute keys but not their values', () => {
  assert.deepEqual(typesOf('#![core.compiler.mangle = false, test]'), [
    'attribute:#!', 'attribute:core', 'attribute:compiler', 'attribute:mangle', 'constant:false', 'attribute:test',
  ]);
  assert.deepEqual(typesOf('#[test] f<int> x() {}'), ['attribute:#', 'attribute:test', 'keyword:f', 'keyword:int', 'function:x']);
});

test('doc comments contain doc tags', () => {
  assert.deepEqual(typesOf('/** Text @param x email@example.com */'), [
    'doc:/** Text ', 'doctag:@param', 'doc: x email@example.com */',
  ]);
});

test('block comment state carries over lines', () => {
  const first = tokenize('int x; /* start');
  assert.equal(first.state.inComment, 'block');
  const second = tokenize('still comment */ int y;', first.state);
  assert.equal(second.tokens[0].type, 'comment');
  assert.equal(second.tokens[0].text, 'still comment */');
  assert.equal(second.state.inComment, null);
  assert.equal(tokenize('/** doc').state.inComment, 'doc');
});

test('tokenizeLines splits tokens at line breaks', () => {
  const lines = tokenizeLines('/* a\r\nb */\nint x;');
  assert.equal(lines.length, 3);
  assert.deepEqual(lines[0], [{ type: 'comment', text: '/* a' }]);
  assert.deepEqual(lines[1], [{ type: 'comment', text: 'b */' }]);
  assert.equal(lines[2][0].type, 'keyword');
});

test('Spice repository sources: lossless and line-wise consistent', (t) => {
  const files = spiceRepoFiles();
  if (files.length === 0) return t.skip('Spice repository not found (set SPICE_REPO)');
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    assert.equal(tokenize(src).tokens.map((x) => x.text).join(''), src, file);
    // Tokenizing line by line with the carried state must give the same result as tokenizing the whole file
    const whole = tokenizeLines(src).map((line) => line.filter((x) => x.type !== 'plain').map((x) => `${x.type}:${x.text}`));
    let state = null;
    src.split('\n').forEach((line, i) => {
      const res = tokenize(line.replace(/\r$/, ''), state);
      state = res.state;
      const actual = res.tokens.filter((x) => x.type !== 'plain').map((x) => `${x.type}:${x.text}`);
      assert.deepEqual(actual, whole[i], `${file}:${i + 1}`);
    });
  }
});
