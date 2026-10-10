/**
 * Approximation of GitHub Linguist's repository language statistics for Spice files.
 *
 * Linguist excludes vendored, documentation and generated files from the statistics and respects overrides in
 * .gitattributes. We replicate the path-based parts of that logic (content-based heuristics are not possible without
 * downloading every file).
 */
(function (root) {
  'use strict';

  const data =
    typeof module === 'object' && module.exports ? require('./linguist-data.js') : root.SpiceGH.linguistData;

  const SPICE = 'Spice';
  const SPICE_EXTENSION = /\.spice$/i;
  const SYMLINK_MODE = '120000';

  const vendorRegexes = data.vendor.map(([p, f]) => new RegExp(p, f));
  const documentationRegexes = data.documentation.map(([p, f]) => new RegExp(p, f));

  /** Converts a gitattributes/gitignore glob pattern to a regex matching full repository paths. */
  function globToRegex(pattern) {
    let anchored = false;
    if (pattern.startsWith('/')) {
      anchored = true;
      pattern = pattern.slice(1);
    } else if (pattern.includes('/')) {
      anchored = true;
    }
    let re = '';
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];
      if (c === '*') {
        if (pattern[i + 1] === '*') {
          const atStart = i === 0 || pattern[i - 1] === '/';
          const atEnd = i + 2 === pattern.length || pattern[i + 2] === '/';
          if (atStart && atEnd) {
            if (i + 2 === pattern.length) re += '.*'; // trailing /** matches everything inside
            else {
              re += '(?:.*/)?'; // leading **/ or inner /**/ matches zero or more directories
              i++; // skip the slash after **
            }
            i++;
            continue;
          }
          i++; // two consecutive stars elsewhere behave like a single one
        }
        re += '[^/]*';
      } else if (c === '?') {
        re += '[^/]';
      } else if (c === '[') {
        const end = pattern.indexOf(']', i + 2);
        if (end === -1) {
          re += '\\[';
          continue;
        }
        let cls = pattern.slice(i + 1, end);
        if (cls.startsWith('!')) cls = '^' + cls.slice(1);
        re += '[' + cls.replace(/\\/g, '\\\\') + ']';
        i = end;
      } else if (c === '\\' && i + 1 < pattern.length) {
        re += pattern[++i].replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      } else {
        re += c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      }
    }
    return new RegExp((anchored ? '^' : '(?:^|/)') + re + '$');
  }

  /**
   * Parses a .gitattributes file.
   *
   * @param {string} text File content
   * @returns {{regex: RegExp, attrs: Object<string, string|boolean|null>}[]} Rules in file order
   */
  function parseGitattributes(text) {
    const rules = [];
    for (const rawLine of (text || '').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith('[attr]')) continue;
      const [pattern, ...specs] = line.split(/\s+/);
      // Patterns ending with a slash only match directories, which never applies to file attributes
      if (pattern.endsWith('/') || pattern.startsWith('!')) continue;
      const attrs = {};
      for (const spec of specs) {
        if (spec.startsWith('-')) attrs[spec.slice(1)] = false;
        else if (spec.startsWith('!')) attrs[spec.slice(1)] = null;
        else if (spec.includes('=')) {
          const eq = spec.indexOf('=');
          attrs[spec.slice(0, eq)] = spec.slice(eq + 1);
        } else attrs[spec] = true;
      }
      rules.push({ regex: globToRegex(pattern), attrs });
    }
    return rules;
  }

  /** Resolves the attributes for a path. Later rules override earlier ones, like in git. */
  function attributesFor(rules, path) {
    const attrs = {};
    for (const rule of rules) {
      if (rule.regex.test(path)) Object.assign(attrs, rule.attrs);
    }
    return attrs;
  }

  /** Interprets a linguist boolean attribute; returns undefined if it is not set. */
  function boolAttr(value) {
    if (value === undefined || value === null) return undefined;
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return undefined;
  }

  /** Builds a lookup from lower-case language names and aliases to canonical language names. */
  function canonicalLanguageName(name) {
    const lower = String(name).toLowerCase().replace(/_/g, ' ');
    if (lower === 'spice') return SPICE;
    return data.aliases[lower] || data.aliases[lower.replace(/ /g, '-')] || name;
  }

  /**
   * Computes the Spice byte count of a repository tree.
   *
   * @param {{path: string, type: string, mode: string, size?: number}[]} tree Entries of the recursive git tree
   * @param {string} [gitattributes] Content of the root .gitattributes file
   * @returns {{bytes: number, files: number, reassigned: Object<string, number>}} Spice bytes and files, plus bytes
   *          of .spice files that GitHub attributes to other languages because of linguist-language overrides
   */
  function computeSpiceStats(tree, gitattributes) {
    const rules = parseGitattributes(gitattributes);
    const result = { bytes: 0, files: 0, reassigned: {} };
    for (const entry of tree) {
      if (entry.type !== 'blob' || entry.mode === SYMLINK_MODE) continue;
      const path = entry.path;
      const attrs = rules.length ? attributesFor(rules, path) : {};
      const override = typeof attrs['linguist-language'] === 'string' ? attrs['linguist-language'] : null;
      const isSpiceFile = SPICE_EXTENSION.test(path);
      const overrideLanguage = override ? canonicalLanguageName(override) : null;
      if (!isSpiceFile && overrideLanguage !== SPICE) continue;

      const vendored = boolAttr(attrs['linguist-vendored']) ?? vendorRegexes.some((re) => re.test(path));
      const documentation =
        boolAttr(attrs['linguist-documentation']) ?? documentationRegexes.some((re) => re.test(path));
      const generated = boolAttr(attrs['linguist-generated']) ?? false;
      const detectable = boolAttr(attrs['linguist-detectable']) ?? true;
      if (vendored || documentation || generated || !detectable) continue;

      const size = entry.size || 0;
      if (overrideLanguage && overrideLanguage !== SPICE) {
        // A common workaround is to let GitHub highlight .spice files as another language. Those bytes are counted
        // for the other language by GitHub, so we move them over to Spice.
        result.reassigned[overrideLanguage] = (result.reassigned[overrideLanguage] || 0) + size;
      }
      result.bytes += size;
      result.files++;
    }
    return result;
  }

  /**
   * Merges the language bytes reported by the GitHub API with the Spice statistics.
   *
   * @param {Object<string, number>} languages Response of GET /repos/{owner}/{repo}/languages
   * @param {{bytes: number, reassigned: Object<string, number>}} spice Result of computeSpiceStats
   * @returns {Object<string, number>} Language bytes including Spice, sorted descending
   */
  function mergeLanguages(languages, spice) {
    const merged = Object.assign({}, languages);
    for (const [lang, bytes] of Object.entries(spice.reassigned || {})) {
      if (merged[lang] === undefined) continue;
      merged[lang] -= bytes;
      if (merged[lang] <= 0) delete merged[lang];
    }
    if (spice.bytes > 0) merged[SPICE] = (merged[SPICE] || 0) + spice.bytes;
    return Object.fromEntries(Object.entries(merged).sort((a, b) => b[1] - a[1]));
  }

  /**
   * Computes the entries to display in the language bar. Languages GitHub displayed by name stay visible, all others
   * are grouped into "Other", like on GitHub.
   *
   * @param {Object<string, number>} merged Result of mergeLanguages
   * @param {Set<string>|null} visibleNames Language names GitHub displayed, or null to display all languages
   * @returns {{name: string, bytes: number, percent: number}[]}
   */
  function displayEntries(merged, visibleNames) {
    const total = Object.values(merged).reduce((a, b) => a + b, 0);
    if (total === 0) return [];
    const entries = [];
    let otherBytes = 0;
    for (const [name, bytes] of Object.entries(merged)) {
      if (name === SPICE || !visibleNames || visibleNames.has(name)) entries.push({ name, bytes });
      else otherBytes += bytes;
    }
    if (otherBytes > 0) entries.push({ name: 'Other', bytes: otherBytes });
    return entries.map((e) => ({ ...e, percent: (e.bytes / total) * 100 }));
  }

  /** Formats a percentage like GitHub does, e.g. 42.1% */
  function formatPercent(percent) {
    return `${percent.toFixed(1)}%`;
  }

  const api = {
    SPICE,
    globToRegex,
    parseGitattributes,
    attributesFor,
    canonicalLanguageName,
    computeSpiceStats,
    mergeLanguages,
    displayEntries,
    formatPercent,
    colors: data.colors,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.SpiceGH = root.SpiceGH || {}).linguist = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
