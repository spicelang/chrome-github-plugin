/**
 * Spice tokenizer for syntax highlighting.
 *
 * The token rules follow the lexer in the Spice compiler (src-host/Spice.g4). The tokenizer is lossless: concatenating
 * the text of all returned tokens always yields the input string again. This allows highlighting DOM nodes in place.
 *
 * Block comments and attribute lists may span multiple lines. To highlight code line by line (e.g. in diffs), pass the
 * state returned for the previous line as `state` argument when tokenizing the next line.
 */
(function (root) {
  'use strict';

  const KEYWORDS = new Set([
    // Control flow
    'if', 'else', 'switch', 'case', 'default', 'for', 'foreach', 'do', 'while', 'break', 'continue', 'fallthrough',
    'return', 'assert', 'unsafe',
    // Declarations
    'f', 'p', 'type', 'struct', 'interface', 'union', 'enum', 'alias', 'operator', 'ext', 'import', 'as', 'cast',
    // Qualifiers
    'const', 'signed', 'unsigned', 'inline', 'public', 'heap', 'compose',
    // Reserved for future use
    'new', 'yield', 'stash', 'pick', 'sync', 'class',
  ]);
  const PRIMITIVE_TYPES = new Set(['double', 'int', 'short', 'long', 'byte', 'char', 'string', 'bool', 'dyn']);
  const CONSTANTS = new Set(['true', 'false', 'nil']);
  const BUILTINS = new Set(['printf', 'sizeof', 'alignof', 'typeid', 'len', 'panic', 'syscall']);
  const SELF = new Set(['this']);

  // Ordered by length, so that the longest operator wins
  const OPERATORS = [
    '<<=', '>>=', '...', '#!',
    '||', '&&', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '>=', '<=', '==', '!=', '->', '::',
    '|', '^', '&', '+', '-', '*', '/', '%', '!', '~', '>', '<', '=', '?', ':', '#',
  ];
  const PUNCTUATION = new Set(['{', '}', '(', ')', '[', ']', ';', ',', '.']);

  const RE_WHITESPACE = /[ \t\r\n\f\v ]+/y;
  const RE_IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/y;
  const RE_DOUBLE = /[0-9]*\.[0-9]+(?:[eE][+-]?[0-9]+)?/y;
  const RE_INTEGER = /(?:0[bB][01]+|0[xXhH][0-9a-fA-F]+|0[oO][0-7]+|(?:0[dD])?[0-9]+)u?[sl]?/y;
  const RE_ESCAPE = /\\(?:x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|[0-7]{1,3}|.)/y;
  const RE_DOC_TAG = /@[A-Za-z]+/y;
  // Generic type list after an identifier, e.g. the <T, int*> in `sizeof<T>()` or `foo<T>(...)`
  const RE_GENERIC_CALL = /<[\w\s,*&\[\]:|<>]*>\s*\(/y;

  function matchAt(re, src, pos) {
    re.lastIndex = pos;
    const m = re.exec(src);
    return m ? m[0] : null;
  }

  function isFunctionName(src, pos) {
    let i = pos;
    while (i < src.length && (src[i] === ' ' || src[i] === '\t')) i++;
    if (src[i] === '(') return true;
    if (src[i] !== '<') return false;
    // Balanced generic argument list followed by a parenthesis
    let depth = 0;
    for (let j = i; j < src.length; j++) {
      const c = src[j];
      if (c === '<') depth++;
      else if (c === '>') {
        if (--depth === 0) return matchAt(RE_GENERIC_CALL, src, i) !== null && /^\s*\(/.test(src.slice(j + 1, j + 64));
      } else if (!/[\w\s,*&\[\]:|]/.test(c)) return false;
    }
    return false;
  }

  /**
   * @typedef {object} LexerState
   * @property {'block'|'doc'|null} inComment Kind of the block comment that is open at the end of the source
   * @property {number} [attrDepth] Bracket depth inside of an attribute list
   * @property {boolean} [attrKey] Whether the next identifier inside of an attribute list is a key
   */

  /**
   * Tokenizes the given Spice source code.
   *
   * @param {string} src Source code
   * @param {LexerState} [state] Lexer state at the start of the source
   * @returns {{tokens: {type: string, text: string}[], state: LexerState}}
   */
  function tokenize(src, state) {
    const tokens = [];
    let pos = 0;
    let inComment = (state && state.inComment) || null;
    // Bracket depth inside of an attribute list and whether the next identifier is an attribute key
    let attrDepth = (state && state.attrDepth) || 0;
    let attrKey = !!(state && state.attrKey);

    const push = (type, text) => {
      if (!text) return;
      const last = tokens[tokens.length - 1];
      if (last && last.type === type && type !== 'plain') last.text += text;
      else tokens.push({ type, text });
    };

    // Lexes a (doc) comment body up to and including the closing '*/' or the end of the input
    const lexCommentBody = (kind) => {
      const type = kind === 'doc' ? 'doc' : 'comment';
      const end = src.indexOf('*/', pos);
      const stop = end === -1 ? src.length : end + 2;
      if (kind === 'doc') {
        // Highlight tags like @param inside doc comments
        let i = pos;
        while (i < stop) {
          const at = src.indexOf('@', i);
          if (at === -1 || at >= stop) break;
          const tag = matchAt(RE_DOC_TAG, src, at);
          const validTag = tag && (at === 0 || /[\s*]/.test(src[at - 1]));
          if (validTag) {
            push(type, src.slice(i, at));
            push('doctag', tag);
            i = at + tag.length;
          } else {
            push(type, src.slice(i, at + 1));
            i = at + 1;
          }
        }
        push(type, src.slice(i, stop));
      } else {
        push(type, src.slice(pos, stop));
      }
      pos = stop;
      inComment = end === -1 ? kind : null;
    };

    if (inComment) lexCommentBody(inComment);

    while (pos < src.length) {
      const c = src[pos];

      // Whitespace
      const ws = matchAt(RE_WHITESPACE, src, pos);
      if (ws) {
        push('plain', ws);
        pos += ws.length;
        continue;
      }

      // Comments
      if (c === '/' && src[pos + 1] === '/') {
        const nl = src.indexOf('\n', pos);
        const stop = nl === -1 ? src.length : nl;
        push('comment', src.slice(pos, stop));
        pos = stop;
        continue;
      }
      if (c === '/' && src[pos + 1] === '*') {
        // '/**/' is an empty block comment, not the start of a doc comment
        const isDoc = src[pos + 2] === '*' && src[pos + 3] !== '/';
        const opener = isDoc ? '/**' : '/*';
        push(isDoc ? 'doc' : 'comment', opener);
        pos += opener.length;
        lexCommentBody(isDoc ? 'doc' : 'block');
        continue;
      }

      // String and char literals
      if (c === '"' || c === '\'') {
        let i = pos + 1;
        push('string', c);
        while (i < src.length && src[i] !== c && src[i] !== '\n') {
          if (src[i] === '\\') {
            const esc = matchAt(RE_ESCAPE, src, i);
            if (esc) {
              push('escape', esc);
              i += esc.length;
              continue;
            }
          }
          push('string', src[i]);
          i++;
        }
        if (src[i] === c) {
          push('string', c);
          i++;
        }
        pos = i;
        continue;
      }

      // Numbers (doubles before integers, since a double may start with a digit as well)
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[pos + 1] || ''))) {
        const num = matchAt(RE_DOUBLE, src, pos) || matchAt(RE_INTEGER, src, pos);
        if (num) {
          push('number', num);
          pos += num.length;
          continue;
        }
      }

      // Identifiers and keywords
      const ident = matchAt(RE_IDENTIFIER, src, pos);
      if (ident) {
        const after = pos + ident.length;
        let type;
        if (attrDepth > 0 && attrKey) type = 'attribute';
        else if (PRIMITIVE_TYPES.has(ident)) type = 'keyword';
        else if (KEYWORDS.has(ident)) type = 'keyword';
        else if (CONSTANTS.has(ident)) type = 'constant';
        else if (SELF.has(ident)) type = 'self';
        else if (BUILTINS.has(ident) && isFunctionName(src, after)) type = 'builtin';
        else if (ident === 'main' || (/^[a-z_]/.test(ident) && isFunctionName(src, after))) type = 'function';
        else if (/^[A-Z][A-Z0-9_]+$/.test(ident)) type = 'constant'; // Enum items and constants like MAX_SIZE
        else if (/^[A-Z]/.test(ident)) type = 'type';
        else type = 'plain';
        push(type, ident);
        pos = after;
        continue;
      }

      // Attributes: #[...] and #![...]
      if (c === '#') {
        const preamble = src[pos + 1] === '!' ? '#!' : '#';
        push('attribute', preamble);
        pos += preamble.length;
        if (src[pos] === '[') {
          push('plain', '[');
          pos++;
          attrDepth = 1;
          attrKey = true;
        }
        continue;
      }
      if (attrDepth > 0) {
        // Attribute values are highlighted as regular code, keys after each comma
        if (c === '[') attrDepth++;
        else if (c === ']') attrDepth--;
        else if (c === '=') attrKey = false;
        else if (c === ',') attrKey = true;
      }

      // Operators and punctuation
      const op = OPERATORS.find((o) => src.startsWith(o, pos));
      if (op) {
        push('operator', op);
        pos += op.length;
        continue;
      }
      if (PUNCTUATION.has(c)) {
        push('plain', c);
        pos++;
        continue;
      }

      // Unknown character (or non-BMP character): emit as plain text, keeping surrogate pairs together
      const code = src.codePointAt(pos);
      const ch = String.fromCodePoint(code);
      push('plain', ch);
      pos += ch.length;
    }

    return { tokens, state: { inComment, attrDepth, attrKey } };
  }

  /**
   * Tokenizes multi-line source and splits the tokens at line breaks.
   *
   * @param {string} src Source code
   * @returns {{type: string, text: string}[][]} Tokens per line (without the line breaks)
   */
  function tokenizeLines(src) {
    const { tokens } = tokenize(src);
    const lines = [[]];
    for (const token of tokens) {
      const parts = token.text.split('\n');
      parts.forEach((part, i) => {
        if (i > 0) lines.push([]);
        if (part) lines[lines.length - 1].push({ type: token.type, text: part.replace(/\r$/, '') });
      });
    }
    return lines;
  }

  const api = { tokenize, tokenizeLines, KEYWORDS, PRIMITIVE_TYPES, CONSTANTS, BUILTINS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.SpiceGH = root.SpiceGH || {}).tokenizer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
