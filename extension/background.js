/**
 * Background service worker: fetches repository statistics from the GitHub API.
 *
 * Responses are cached in chrome.storage.local together with their ETag. Conditional requests answered with
 * 304 Not Modified do not count against the GitHub API rate limit, so revisiting a repository is cheap.
 */
importScripts('shared/linguist-data.js', 'shared/linguist.js');

const { computeSpiceStats, mergeLanguages } = self.SpiceGH.linguist;

const API = 'https://api.github.com';
const CACHE_PREFIX = 'api:';
// Within this time span, cached responses are used without asking the API again
const FRESH_MS = 5 * 60 * 1000;
// Cache entries that were not used for this time span are removed
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function getToken() {
  const { token } = await chrome.storage.local.get('token');
  return token ? token.trim() : null;
}

/**
 * Requests an API path, using the cache when possible.
 *
 * @param {string} path API path, e.g. /repos/owner/repo/languages
 * @param {object} [options]
 * @param {(body: any) => any} [options.transform] Reduces the response before it gets cached
 * @param {boolean} [options.raw] Requests the raw content instead of JSON
 * @param {(status: number) => any} [options.fallback] Returns a value for an error status instead of throwing
 */
async function cachedApi(path, { transform = (body) => body, raw = false, fallback } = {}) {
  const key = CACHE_PREFIX + path;
  const cached = (await chrome.storage.local.get(key))[key];
  if (cached && Date.now() - cached.time < FRESH_MS) return cached.value;

  const headers = {
    Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = await getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cached && cached.etag) headers['If-None-Match'] = cached.etag;

  let res;
  try {
    res = await fetch(API + path, { headers, cache: 'no-store' });
  } catch (e) {
    if (cached) return cached.value;
    throw new ApiError(0, `Network error: ${e.message}`);
  }

  if (res.status === 304 && cached) {
    await chrome.storage.local.set({ [key]: { ...cached, time: Date.now() } });
    return cached.value;
  }
  if (!res.ok) {
    if (fallback) {
      const value = fallback(res.status);
      if (value !== undefined) return value;
    }
    // Prefer stale data over no data when rate limited or when GitHub has issues
    if (cached && (res.status === 403 || res.status === 429 || res.status >= 500)) return cached.value;
    if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
      const reset = new Date(parseInt(res.headers.get('x-ratelimit-reset') || '0', 10) * 1000);
      throw new ApiError(res.status, `GitHub API rate limit exceeded until ${reset.toLocaleTimeString()}`);
    }
    throw new ApiError(res.status, `GitHub API returned ${res.status} for ${path}`);
  }

  const body = raw ? await res.text() : await res.json();
  const value = await transform(body);
  await chrome.storage.local.set({ [key]: { etag: res.headers.get('ETag'), time: Date.now(), value } });
  return value;
}

async function repoStats(owner, repo) {
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const [languages, spice] = await Promise.all([
    cachedApi(`${base}/languages`),
    cachedApi(`${base}/git/trees/HEAD?recursive=1`, {
      // Empty repositories respond with 409 Conflict
      fallback: (status) => (status === 409 ? { bytes: 0, files: 0, reassigned: {}, truncated: false } : undefined),
      transform: async (tree) => {
        const attributesEntry = tree.tree.find((e) => e.path === '.gitattributes' && e.type === 'blob');
        const attributes = attributesEntry
          ? await cachedApi(`${base}/git/blobs/${attributesEntry.sha}`, { raw: true })
          : '';
        return { ...computeSpiceStats(tree.tree, attributes), truncated: !!tree.truncated };
      },
    }),
  ]);
  return { languages, spice, merged: mergeLanguages(languages, spice) };
}

async function pruneCache() {
  const all = await chrome.storage.local.get(null);
  const stale = Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX) && Date.now() - all[k].time > MAX_AGE_MS);
  if (stale.length) await chrome.storage.local.remove(stale);
}

async function clearCache() {
  const all = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX)));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'repoStats') {
    repoStats(message.owner, message.repo).then(
      (stats) => sendResponse({ ok: true, stats }),
      (e) => sendResponse({ ok: false, error: e.message, status: e.status || 0 }),
    );
    return true; // Keep the channel open for the async response
  }
  if (message && message.type === 'clearCache') {
    clearCache().then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

chrome.runtime.onStartup.addListener(pruneCache);
chrome.runtime.onInstalled.addListener(pruneCache);
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
