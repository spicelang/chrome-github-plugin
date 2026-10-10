/**
 * Syntax highlighting of Spice code on GitHub.
 *
 * Supported locations:
 * - File and blame views of *.spice files (React code view)
 * - Diffs of *.spice files (commits, compare views, pull requests, classic and React diff views)
 * - Permalink snippets and gists of *.spice files
 * - Markdown code blocks with the language spice (```spice)
 *
 * Code is highlighted in place by splitting text nodes and wrapping tokens in spans. This keeps GitHub's own markup
 * (e.g. word-level diff markers or code navigation) intact.
 */
(function (root) {
  'use strict';

  const { tokenize } = root.SpiceGH.tokenizer;

  const TOKEN_CLASS = 'sgh-tok';
  // Token types that are rendered without color
  const UNSTYLED = new Set(['plain', 'operator']);
  const SPICE_PATH = /\.spice$/i;
  const MARKDOWN_SELECTOR = [
    'pre[lang="spice" i]',
    'pre[lang="spicelang" i]',
    'pre > code.language-spice',
    '.highlight-source-spice > pre',
  ].join(',');
  const DIFF_LINE_SELECTOR = '.blob-code-inner, .diff-text-inner';
  const FILE_CONTAINER_SELECTOR =
    '[data-tagsearch-path], [data-file-path], .file, [id^="diff-"], [role="region"][aria-labelledby], .blob-wrapper';
  // Anchors of single files are hashes of the path, e.g. diff-0534891f..., other ids like diff-content-parent are not
  const FILE_ANCHOR_ID = /^diff-[0-9a-f]{16,}$/;
  const HUNK_SELECTOR = '.blob-code-hunk, [class*="hunk" i]';

  // ------------------------------------------------------------------------------------------------------------------
  // DOM helpers
  // ------------------------------------------------------------------------------------------------------------------

  /** Returns the text of a code element. GitHub sometimes renders code via data-code-text attributes and CSS. */
  function getText(el) {
    const text = el.textContent;
    if (text.length > 0 || !el.querySelector('[data-code-text]')) return text;
    return Array.from(el.querySelectorAll('[data-code-text]'))
      .filter((n) => !n.querySelector('[data-code-text]'))
      .map((n) => n.getAttribute('data-code-text'))
      .join('');
  }

  function isDone(el, text) {
    return el.dataset.sgh === text;
  }

  /** Removes highlighting from a previous run as well as GitHub's own highlighting (e.g. via linguist overrides). */
  function resetHighlighting(el) {
    for (const span of el.querySelectorAll(`span.${TOKEN_CLASS}`)) {
      if (span.hasAttribute('data-code-text')) continue;
      span.replaceWith(...span.childNodes);
    }
    for (const node of el.querySelectorAll('[class*="pl-"]')) {
      for (const cls of Array.from(node.classList)) if (cls.startsWith('pl-')) node.classList.remove(cls);
    }
    el.normalize();
  }

  /** Wraps the tokens in place by splitting the text nodes of the element. */
  function applyInPlace(el, tokens) {
    const ranges = [];
    let offset = 0;
    for (const token of tokens) {
      if (!UNSTYLED.has(token.type)) ranges.push({ start: offset, end: offset + token.text.length, type: token.type });
      offset += token.text.length;
    }
    if (ranges.length === 0) return;

    const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    let pos = 0;
    let first = 0;
    for (const node of nodes) {
      const nodeStart = pos;
      const nodeEnd = pos + node.data.length;
      pos = nodeEnd;
      while (first < ranges.length && ranges[first].end <= nodeStart) first++;
      // Collect overlapping ranges and process them back to front, so that splitting keeps earlier offsets valid
      const overlapping = [];
      for (let i = first; i < ranges.length && ranges[i].start < nodeEnd; i++) overlapping.push(ranges[i]);
      for (let i = overlapping.length - 1; i >= 0; i--) {
        const r = overlapping[i];
        const start = Math.max(r.start, nodeStart) - nodeStart;
        const end = Math.min(r.end, nodeEnd) - nodeStart;
        if (end <= start) continue;
        const middle = start > 0 ? node.splitText(start) : node;
        if (end - start < middle.data.length) middle.splitText(end - start);
        const span = el.ownerDocument.createElement('span');
        span.className = `${TOKEN_CLASS} sgh-${r.type}`;
        middle.replaceWith(span);
        span.appendChild(middle);
      }
    }
  }

  /** Replaces the children with token spans that render their text via the data-code-text attribute. */
  function applyCodeText(el, tokens) {
    const doc = el.ownerDocument;
    const spans = tokens.map((token) => {
      const span = doc.createElement('span');
      span.className = UNSTYLED.has(token.type) ? `${TOKEN_CLASS} sgh-dct` : `${TOKEN_CLASS} sgh-dct sgh-${token.type}`;
      span.setAttribute('data-code-text', token.text);
      return span;
    });
    el.replaceChildren(...spans);
  }

  /**
   * Highlights a single element with the given lexer state.
   *
   * @returns {{inComment: string|null}} Lexer state after the element's text
   */
  function highlightElement(el, text, state) {
    const result = tokenize(text, state);
    if (isDone(el, text)) return result.state;
    const usesCodeText = el.textContent.length === 0 && text.length > 0;
    if (usesCodeText) {
      applyCodeText(el, result.tokens);
    } else {
      resetHighlighting(el);
      applyInPlace(el, result.tokens);
    }
    el.dataset.sgh = text;
    return result.state;
  }

  // ------------------------------------------------------------------------------------------------------------------
  // File and blame views
  // ------------------------------------------------------------------------------------------------------------------

  function isSpiceFileView(loc) {
    return /^\/[^/]+\/[^/]+\/(blob|blame)\/.+/.test(loc.pathname) && SPICE_PATH.test(decodeURIComponent(loc.pathname));
  }

  let sourceCache = { text: null, states: null };

  /** Returns the full source of the displayed file, if GitHub exposes it in the DOM. */
  function getFullSource(doc) {
    const textarea = doc.getElementById('read-only-cursor-text-area');
    if (textarea && textarea.value) return textarea.value;
    const embedded = doc.querySelector('script[data-target="react-app.embeddedData"]');
    if (embedded) {
      try {
        const lines = JSON.parse(embedded.textContent)?.payload?.blob?.rawLines;
        if (Array.isArray(lines)) return lines.join('\n');
      } catch (e) {
        // Ignore malformed or unexpected payloads
      }
    }
    return null;
  }

  /** Computes the lexer state at the start of every line, so that each line can be highlighted independently. */
  function lineStates(source) {
    if (sourceCache.text === source) return sourceCache.states;
    const states = [];
    let state = { inComment: null };
    for (const line of source.split('\n')) {
      states.push(state);
      state = tokenize(line, state).state;
    }
    sourceCache = { text: source, states };
    return states;
  }

  function lineNumberOf(el) {
    const own = el.dataset.lineNumber || (/^LC(\d+)$/.exec(el.id) || [])[1];
    if (own) return parseInt(own, 10);
    const holder = el.closest('[data-line-number]');
    return holder ? parseInt(holder.dataset.lineNumber, 10) : null;
  }

  function highlightFileView(doc) {
    let lines = Array.from(doc.querySelectorAll('.react-file-line'));
    if (lines.length === 0) {
      lines = Array.from(doc.querySelectorAll('.react-code-text, td.blob-code[id^="LC"]')).filter(
        (el) => !el.querySelector('.react-file-line'),
      );
    }
    const dirty = lines.map((el) => [el, getText(el)]).filter(([el, text]) => !isDone(el, text));
    if (dirty.length === 0) return;

    const source = getFullSource(doc);
    let states = source !== null ? lineStates(source) : null;
    if (!states) {
      // Derive the states from the rendered lines, which works as long as all lines are rendered
      states = [];
      let state = { inComment: null };
      for (const el of lines) {
        const n = lineNumberOf(el);
        if (n !== states.length + 1) break;
        states.push(state);
        state = tokenize(getText(el), state).state;
      }
    }
    for (const [el, text] of dirty) {
      const n = lineNumberOf(el);
      const state = n && states[n - 1] ? states[n - 1] : { inComment: null };
      highlightElement(el, text, state);
    }
  }

  // ------------------------------------------------------------------------------------------------------------------
  // Diffs, permalink snippets and gists
  // ------------------------------------------------------------------------------------------------------------------

  const PATH_ATTRIBUTES = ['data-tagsearch-path', 'data-file-path', 'data-path'];
  const PATH_TEXT_CANDIDATES =
    'h3, h4, .gist-blob-name, [class*="file-name" i], [class*="filename" i], [class*="header" i] a, a[title], ' +
    'span[title], code';

  function cleanPath(text) {
    return (text || '').replace(/[\u200e\u200f\u200b]/g, '').trim();
  }

  /** Extracts the (new) path from labels like "src/a.spice" or "old.spice → new.spice". */
  function pathFromLabel(label) {
    const parts = cleanPath(label).split(/\s+(?:→|->)\s+/);
    return parts[parts.length - 1] || null;
  }

  /** Resolves the file path of a diff or snippet container. */
  function resolvePath(container) {
    if (container.id && container.id.startsWith('diff-') && !FILE_ANCHOR_ID.test(container.id)) return null;
    if (container.matches('[role="region"][aria-labelledby]')) {
      const label = container.ownerDocument.getElementById(container.getAttribute('aria-labelledby'));
      const path = label ? pathFromLabel(label.textContent) : null;
      return path && /\.[A-Za-z0-9_+-]+$/.test(path) ? path : null;
    }
    for (const attr of PATH_ATTRIBUTES) {
      const value = container.getAttribute(attr);
      if (value) return value;
    }
    const withAttr = container.querySelector(PATH_ATTRIBUTES.map((a) => `[${a}]`).join(','));
    if (withAttr) {
      for (const attr of PATH_ATTRIBUTES) if (withAttr.getAttribute(attr)) return withAttr.getAttribute(attr);
    }
    // Permalink snippets link to the file in their header
    if (container.classList.contains('blob-wrapper') && container.parentElement) {
      const link = container.parentElement.querySelector('a[href*="/blob/"]');
      if (link) return decodeURIComponent(new URL(link.href, 'https://github.com').pathname);
    }
    // React diff views render the path as text in the file header
    for (const node of container.querySelectorAll(PATH_TEXT_CANDIDATES)) {
      if (node.closest('table, pre, .blob-wrapper')) continue;
      const text = cleanPath(node.getAttribute('title') || node.textContent);
      if (/^\S+\.[A-Za-z0-9_+-]+$/.test(text)) return text;
    }
    return null;
  }

  function classesUpTo(el, stop) {
    let classes = '';
    for (let n = el; n && n !== stop; n = n.parentElement) {
      classes += ' ' + (typeof n.className === 'string' ? n.className : '');
      if (n.tagName === 'TD') break;
    }
    return classes;
  }

  /** Determines to which side of a diff (old/new/both) a line belongs. */
  function diffSides(el) {
    const cell = el.closest('td');
    const row = cell && cell.parentElement;
    if (row) {
      const codeCells = Array.from(row.children).filter(
        (c) => c.matches(DIFF_LINE_SELECTOR) || c.querySelector(DIFF_LINE_SELECTOR),
      );
      if (codeCells.length === 2) return codeCells.indexOf(cell) === 0 ? ['old'] : ['new'];
    }
    const classes = classesUpTo(el, row);
    if (/(deletion|deleted|removed)/i.test(classes)) return ['old'];
    if (/(addition|added|inserted)/i.test(classes)) return ['new'];
    return ['new', 'old'];
  }

  function startsHunk(el) {
    const row = el.closest('tr');
    const prev = row && row.previousElementSibling;
    if (!row) return false;
    if (!prev) return true;
    return prev.matches(HUNK_SELECTOR) || prev.querySelector(HUNK_SELECTOR) !== null;
  }

  /** Guess for lines at the start of a hunk, which may be inside of a block comment that started above. */
  function guessState(text) {
    return /^\s*\*(\s|\/|$)/.test(text) ? { inComment: 'block' } : { inComment: null };
  }

  function highlightDiffs(doc) {
    const lines = Array.from(doc.querySelectorAll(DIFF_LINE_SELECTOR)).filter((el) => {
      if (el.querySelector(DIFF_LINE_SELECTOR) || el.matches(HUNK_SELECTOR)) return false;
      const cell = el.closest('td');
      return !cell || !cell.matches(HUNK_SELECTOR);
    });
    if (lines.length === 0) return;

    // Group the lines by file and keep only Spice files
    const pathCache = new Map();
    const files = new Map();
    const fileOf = (el) => {
      // React diff tables are labeled with the file path
      const table = el.closest('table[aria-label]');
      const label = table && /^Diff for:\s*(.+)$/.exec(table.getAttribute('aria-label'));
      if (label) return [table, pathFromLabel(label[1])];
      // Walk up until a container with a resolvable path is found
      const parentContainer = (c) => c.parentElement && c.parentElement.closest(FILE_CONTAINER_SELECTOR);
      for (let c = el.closest(FILE_CONTAINER_SELECTOR); c; c = parentContainer(c)) {
        if (!pathCache.has(c)) pathCache.set(c, resolvePath(c));
        if (pathCache.get(c)) return [c, pathCache.get(c)];
      }
      return [null, null];
    };
    for (const el of lines) {
      const [container, path] = fileOf(el);
      if (!container || !SPICE_PATH.test(path)) continue;
      if (!files.has(container)) files.set(container, []);
      files.get(container).push(el);
    }

    for (const fileLines of files.values()) {
      const texts = fileLines.map(getText);
      if (fileLines.every((el, i) => isDone(el, texts[i]))) continue;
      // Track the lexer state separately for the old and the new version of the file
      const states = { old: null, new: null };
      fileLines.forEach((el, i) => {
        const text = texts[i];
        if (startsHunk(el)) states.old = states.new = null;
        const sides = diffSides(el);
        const state = states[sides[0]] || guessState(text);
        const next = highlightElement(el, text, state);
        for (const side of sides) states[side] = next;
      });
    }
  }

  // ------------------------------------------------------------------------------------------------------------------
  // Markdown code blocks
  // ------------------------------------------------------------------------------------------------------------------

  function highlightMarkdown(doc) {
    for (const block of doc.querySelectorAll(MARKDOWN_SELECTOR)) {
      const el = block.tagName === 'PRE' ? block.querySelector(':scope > code') || block : block;
      const text = getText(el);
      if (isDone(el, text)) continue;
      highlightElement(el, text, null);
    }
  }

  // ------------------------------------------------------------------------------------------------------------------

  function run(doc = root.document, loc = root.location) {
    if (isSpiceFileView(loc)) highlightFileView(doc);
    highlightDiffs(doc);
    highlightMarkdown(doc);
  }

  /** Removes all highlighting, e.g. when the feature gets disabled. Data-code-text lines are restored by GitHub. */
  function clear(doc = root.document) {
    for (const el of doc.querySelectorAll('[data-sgh]')) {
      resetHighlighting(el);
      delete el.dataset.sgh;
    }
  }

  (root.SpiceGH = root.SpiceGH || {}).highlight = { run, clear };
})(globalThis);
