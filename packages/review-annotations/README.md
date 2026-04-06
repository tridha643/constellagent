# @tridha643/review-annotations

**libSQL-backed inline review annotations** — a small CLI (`constell-annotate`) plus a TypeScript library for storing notes tied to file paths and line ranges in a local SQLite database. Designed for agent and human workflows (e.g. explaining *why* a line changed) and compatible with the [Constellagent](https://github.com/owengretzinger/constellagent) desktop app when both use the same project layout.

**You do not need Constellagent installed** to use this package. It runs standalone in any git repository.

## Requirements

- **Node.js** ≥ 18
- **`git`** on `PATH` (required for `add`; other commands work without a repo if you pass `--db` appropriately)
- For `add` without `--force`: a unified diff that includes the target file and line range. In standard git repos this is based on **`git diff HEAD`**; on tracked Graphite branches it includes both the branch delta and any local worktree changes.

## Install

```bash
npm install -g @tridha643/review-annotations
```

Verify:

```bash
constell-annotate --help
```

Use without a global install:

```bash
npx @tridha643/review-annotations --help
```

> The published binary name is **`constell-annotate`**, not the package name.

## Where data is stored

Annotations live in a **single SQLite file** opened via [`@libsql/client`](https://github.com/tursodatabase/libsql-client-ts) (`file:` URL). Resolution order:

1. **`--db <path>`** — use this file explicitly.
2. If the current directory is inside a **git** worktree **and** `<repo>/.constellagent/` exists → **`<repo>/.constellagent/review-annotations.db`** (same path the Constellagent app uses).
3. Otherwise → **`$XDG_DATA_HOME/constellagent/review-annotations.db`**, typically **`~/.local/share/constellagent/review-annotations.db`** on Linux/macOS (the directory is created as needed).

**Workspace scoping:** Rows are filtered by a **workspace id**. Defaults:

- Environment variable **`CONSTELLAGENT_WORKSPACE_ID`** if set, otherwise **`cli-local`**.
- Override per invocation: **`--workspace-id <id>`** (must match how you list/clear if you use a non-default id).

## CLI reference

Global flags (before or after the subcommand, parsed globally):

| Flag | Description |
|------|-------------|
| `--db <path>` | SQLite database file path |
| `--workspace-id <id>` | Workspace id for list/add/clear filtering |
| `--help` | Usage |

### `add`

Add an annotation. **Must be run from inside a git repository** (repository root is detected with `git rev-parse --show-toplevel`).

By default, the CLI validates against the current review diff. In a standard git repo this is **`git diff HEAD`**. On a tracked Graphite branch it uses the branch's Graphite parent as the base and also includes any local worktree changes, so both committed branch hunks and fresh local edits can be annotated. Use **`--force`** to skip that check (bulk notes, unusual bases, or empty diffs).

| Option | Description |
|--------|-------------|
| `--file <path>` | **Required.** Repo-relative path (as in the diff), e.g. `src/app.ts` |
| `--new-line <n>` or `n-m` | Line(s) on the **new** side of the diff |
| `--old-line <n>` or `n-m` | Line(s) on the **old** side (deletions); use instead of `--new-line` |
| `--summary <text>` | **Required.** Short message |
| `--rationale <text>` | Optional longer note |
| `--author <name>` | Optional author label (e.g. `codex`, `cursor`) — recommended for machine-authored notes |
| `--branch <name>` | Override branch detection for Graphite-aware diff selection |
| `--force` | Skip hunk validation |

**Example:**

```bash
constell-annotate add \
  --file src/server.ts \
  --new-line 42 \
  --summary "Bound request size here to avoid OOM" \
  --author "codex"
```

**JSON output:** On success, prints one JSON object with `id`, `file_path`, `side`, `line_start`, `line_end`.

**Edge cases:**

- No diff against `HEAD` / line not in a hunk → validation fails unless **`--force`**.
- Empty repository or no commits may limit `git diff HEAD` / `HEAD` resolution; use **`--force`** if needed.

### `list`

| Option | Description |
|--------|-------------|
| `--file <path>` | Filter by file |
| `--branch <name>` | Filter by stored branch |
| `--json` | JSON array output |
| `--include-stale` | With `--json`, annotate rows with a **`stale`** boolean using the current review diff (Graphite-aware when applicable) |

Human-readable default: prints file, line range, side, optional author, resolved state, summary, and id.

### `remove`

```bash
constell-annotate remove <id>
```

### `clear`

Deletes annotations matching filters (workspace + optional repo/file).

| Option | Description |
|--------|-------------|
| `--file <path>` | Limit to one file |
| `--branch <name>` | Limit to one stored branch |

### `clean-deleted`

Removes annotations for files that are deleted in the current review diff.

| Option | Description |
|--------|-------------|
| `--base <rev>` | Explicit diff base; otherwise uses Graphite parent when available, falling back to `HEAD` |
| `--dry-run` | Report matching deleted files without deleting annotations |
| `--json` | JSON output |

### `resolve` / `unresolve`

```bash
constell-annotate resolve <id>
constell-annotate unresolve <id>
```

## Programmatic API

The package exports TypeScript types and functions from the compiled **`dist/index.js`** (ESM).

```js
import {
  openAnnotationsDb,
  addAnnotation,
  listAnnotations,
  removeAnnotation,
  clearAnnotations,
  setResolved,
  parseUnifiedDiff,
  validateRangeInDiff,
  computeStaleFlags,
} from '@tridha643/review-annotations'
```

- **`openAnnotationsDb(dbPath)`** — open/create DB and ensure schema.
- **`addAnnotation(db, input, { force?, diffText? })`** — `diffText` should be unified diff text when not using `force`.
- **`listAnnotations(db, { workspace_id?, repo_root?, file_path? })`**
- **`removeAnnotation`**, **`clearAnnotations`**, **`setResolved`**

Use **`db.close()`** when done (the CLI closes the client in a `finally` block).

## Constellagent desktop

If you use the Constellagent app on the same machine and repo, annotations stored under **`.constellagent/review-annotations.db`** can show up in the **Review Changes** / diff UI. The CLI is the same data model: **author-tagged** rows (`--author`) are easy to distinguish from untagged “human” comments in that UI.

## Development (this monorepo)

```bash
cd packages/review-annotations
npm install
npm run build
npm test
```

## Publishing (maintainers)

Publishing uses the **`@tridha643`** scope on the [npm registry](https://www.npmjs.com/). You must:

1. Log in: `npm login`
2. Have **publish access** to the `@constellagent` organization (create the org at npmjs.com and add your user, or use an account that already owns the scope).
3. From this directory:

```bash
npm publish --access public
```

`prepublishOnly` runs `npm run build` so `dist/` is up to date. If `npm publish` returns **404**, the scope usually does not exist yet or your user is not a member — fix that on [npmjs.com](https://www.npmjs.com/) before retrying.

## License

ISC
