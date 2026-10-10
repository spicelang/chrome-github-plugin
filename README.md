# Spice for GitHub

A Chrome extension that brings the [Spice programming language](https://www.spicelang.com) to GitHub until
[GitHub Linguist](https://github.com/github-linguist/linguist) supports it natively:

- **Syntax highlighting** for Spice code
  - file and blame views of `*.spice` files
  - diffs in commits, compare views and pull requests (classic and new diff view)
  - permalink snippets in issues and pull requests, gists
  - Markdown code blocks marked as ` ```spice ` in READMEs, issues, comments, etc.
- **Language statistics**: Spice is added to the language bar in the sidebar of repositories. Repositories without
  any language known to GitHub (e.g. pure Spice repositories) get a new "Languages" section.

The highlighting uses GitHub's own syntax theme colors, so it matches the selected light/dark theme.

## Installation

1. Clone this repository.
2. Open `chrome://extensions`, enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `extension` directory.

Click the extension icon to open the options: toggle the features, choose the Spice color for the language bar and
optionally set a GitHub token.

### GitHub token (optional)

The language statistics are computed with the GitHub REST API. Without a token, GitHub allows 60 requests per hour
and only public repositories can be analyzed. Responses are cached and revalidated with conditional requests, which
do not count against the limit, so this is usually enough for browsing. For private repositories or heavy use, create
a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) with read-only
**Contents** permission. The token is stored locally (`chrome.storage.local`) and only sent to `api.github.com`.

## How it works

### Syntax highlighting

`extension/shared/tokenizer.js` is a lossless tokenizer following the lexer rules of the Spice compiler
(`src-host/Spice.g4`). The content script finds Spice code in the page and wraps the tokens in place by splitting text
nodes, so GitHub's own markup (word-level diff markers, code navigation) stays intact. Block comments and attribute
lists spanning multiple lines are handled via the lexer state: in file views it is computed from the full file
source, in diffs it is tracked separately for the old and new version of the file. Since GitHub renders lazily and
navigates without page reloads, a `MutationObserver` re-runs the (idempotent) highlighting whenever the page changes.

### Language statistics

The background service worker fetches `GET /repos/{owner}/{repo}/languages` (the bytes per language GitHub knows) and
the recursive git tree of the default branch, which contains the size of every file. The Spice bytes are computed
like Linguist would:

- `*.spice` files are counted, symlinks and submodules are not
- vendored paths (e.g. `node_modules/`, `third_party/`) and documentation paths (e.g. `docs/`, `examples/`) are
  excluded, using Linguist's own `vendor.yml` and `documentation.yml` patterns
- the root `.gitattributes` is respected: `linguist-vendored`, `linguist-documentation`, `linguist-generated`,
  `linguist-detectable` and `linguist-language`
- `.spice` files mapped to another language via `linguist-language` (a common workaround to get highlighting) are
  moved from that language to Spice, so they are not counted twice

The languages GitHub displayed by name stay visible, the rest is grouped into "Other", like on GitHub.

Limitations compared to Linguist: content-based detection of generated files is not possible without downloading
every file, nested `.gitattributes` files are ignored, and for very large repositories the GitHub API truncates the
tree (the Spice entry's tooltip notes this).

## Development

```sh
npm install      # installs jsdom for the DOM tests
npm test         # runs the tests (the tokenizer is also checked against ../spice if present, or $SPICE_REPO)
npm run update-linguist   # regenerates extension/shared/linguist-data.js from upstream Linguist
```

The extension has no build step: the files in `extension/` are loaded as they are. After a change, click the reload
button of the extension in `chrome://extensions` and reload the GitHub tab.

Project layout:

| Path                                | Purpose                                                          |
| ----------------------------------- | ---------------------------------------------------------------- |
| `extension/manifest.json`           | Manifest V3                                                      |
| `extension/background.js`           | GitHub API access and caching                                    |
| `extension/content/highlight.js`    | Syntax highlighting of files, diffs, snippets and Markdown       |
| `extension/content/languages.js`    | Language bar in the repository sidebar                           |
| `extension/content/main.js`         | Content script entry point, settings and change observation      |
| `extension/shared/tokenizer.js`     | Spice tokenizer                                                  |
| `extension/shared/linguist.js`      | Linguist-like file classification, `.gitattributes` and merging  |
| `extension/shared/linguist-data.js` | Generated: language colors, aliases, vendor/documentation paths |
| `extension/options/`                | Options page                                                     |

## License

MIT, see [LICENSE](LICENSE).
