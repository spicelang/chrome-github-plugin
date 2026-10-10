const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const EXTENSION = path.join(__dirname, '..', 'extension');

/** Loads the service worker into a sandbox with mocked chrome and fetch APIs. */
function loadBackground(routes) {
  const storage = {};
  const requests = [];
  let listener = null;
  const sandbox = {
    console,
    URL,
    Date,
    chrome: {
      storage: {
        local: {
          get: async (key) => {
            if (key === null) return { ...storage };
            return key in storage ? { [key]: storage[key] } : {};
          },
          set: async (items) => Object.assign(storage, items),
          remove: async (keys) => [].concat(keys).forEach((k) => delete storage[k]),
        },
      },
      runtime: {
        onMessage: { addListener: (fn) => (listener = fn) },
        onStartup: { addListener() {} },
        onInstalled: { addListener() {} },
        openOptionsPage() {},
      },
      action: { onClicked: { addListener() {} } },
    },
    fetch: async (url, init) => {
      const { pathname, search } = new URL(url);
      requests.push({ path: pathname + search, headers: init.headers });
      const route = routes[pathname + search];
      if (!route) return response(404, { message: 'Not Found' });
      return route(init.headers);
    },
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.importScripts = (...files) => {
    for (const file of files) vm.runInContext(fs.readFileSync(path.join(EXTENSION, file), 'utf8'), sandbox);
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(EXTENSION, 'background.js'), 'utf8'), sandbox);

  const send = (message) =>
    new Promise((resolve) => {
      listener(message, {}, (r) => resolve(JSON.parse(JSON.stringify(r))));
    });
  return { send, requests, storage };
}

function response(status, body, headers = {}) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => h.get(k.toLowerCase()) ?? null },
    json: async () => body,
    text: async () => body,
  };
}

const TREE = {
  truncated: false,
  tree: [
    { path: '.gitattributes', type: 'blob', mode: '100644', sha: 'attrsha', size: 30 },
    { path: 'src/main.spice', type: 'blob', mode: '100644', sha: 'a', size: 300 },
    { path: 'src/gen.spice', type: 'blob', mode: '100644', sha: 'b', size: 700 },
    { path: 'CMakeLists.txt', type: 'blob', mode: '100644', sha: 'c', size: 100 },
  ],
};

function routesFor(repo) {
  return {
    [`/repos/${repo}/languages`]: (h) =>
      h['If-None-Match'] === '"l1"' ? response(304) : response(200, { CMake: 100 }, { ETag: '"l1"' }),
    [`/repos/${repo}/git/trees/HEAD?recursive=1`]: (h) =>
      h['If-None-Match'] === '"t1"' ? response(304) : response(200, TREE, { ETag: '"t1"' }),
    [`/repos/${repo}/git/blobs/attrsha`]: (h) => {
      assert.equal(h.Accept, 'application/vnd.github.raw');
      return response(200, 'src/gen.spice linguist-generated\n', { ETag: '"b1"' });
    },
  };
}

test('computes repository statistics and caches them with ETags', async () => {
  const bg = loadBackground(routesFor('o/r'));
  const first = await bg.send({ type: 'repoStats', owner: 'o', repo: 'r' });
  assert.equal(first.ok, true);
  assert.deepEqual(first.stats.merged, { Spice: 300, CMake: 100 });
  assert.equal(first.stats.spice.files, 1);
  assert.equal(bg.requests.length, 3);

  // Fresh cache entries are served without requests
  await bg.send({ type: 'repoStats', owner: 'o', repo: 'r' });
  assert.equal(bg.requests.length, 3);

  // Stale entries are revalidated with conditional requests
  for (const key of Object.keys(bg.storage)) bg.storage[key].time = 0;
  const third = await bg.send({ type: 'repoStats', owner: 'o', repo: 'r' });
  assert.deepEqual(third.stats.merged, { Spice: 300, CMake: 100 });
  const revalidations = bg.requests.slice(3);
  assert.deepEqual(revalidations.map((r) => r.headers['If-None-Match']).sort(), ['"l1"', '"t1"']);
});

test('handles empty and inaccessible repositories', async () => {
  const bg = loadBackground({
    '/repos/o/empty/languages': () => response(200, {}),
    '/repos/o/empty/git/trees/HEAD?recursive=1': () => response(409, { message: 'Git Repository is empty.' }),
  });
  const empty = await bg.send({ type: 'repoStats', owner: 'o', repo: 'empty' });
  assert.equal(empty.ok, true);
  assert.equal(empty.stats.spice.bytes, 0);

  const missing = await bg.send({ type: 'repoStats', owner: 'o', repo: 'private' });
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 404);
});

test('sends the token and reports rate limits', async () => {
  const bg = loadBackground({
    '/repos/o/r/languages': () =>
      response(403, { message: 'rate limit' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '0' }),
  });
  bg.storage.token = ' github_pat_test ';
  const result = await bg.send({ type: 'repoStats', owner: 'o', repo: 'r' });
  assert.equal(result.ok, false);
  assert.match(result.error, /rate limit/);
  assert.equal(bg.requests[0].headers.Authorization, 'Bearer github_pat_test');
});
