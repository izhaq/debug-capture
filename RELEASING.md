# Releasing

How to cut a new version of `debug-capture`. A release is **one tarball**
(`debug-capture-<version>.tgz`) with a SHA-256 checksum, attached to a GitHub
Release of this repository. There is no npm registry: `package.json` is
`private: true` on purpose, so `npm publish` refuses. Hosts download the
tarball and install it from their `vendor/` folder
([`docs/host-setup.md`](docs/host-setup.md)).

Versions follow semver: `2.3.0`, and pre-releases like `2.4.0-alpha.0` while a
spec is still in progress.

## 1. Set the version (on a branch)

The version lives in **three** places. `npm run build` fails when
`package.json` and the code differ (HLD `D-42`: Settings › About shows it).

| File                               | Where                                        |
| ---------------------------------- | -------------------------------------------- |
| `package.json`                     | `"version"`                                  |
| `package-lock.json`                | `"version"` at the top and in `packages[""]` |
| `src/contract/capture-contract.ts` | `export const DEBUG_CAPTURE_VERSION = '…'`   |

```bash
git checkout main && git pull
git checkout -b release/v2.3.0
npm version 2.3.0 --no-git-tag-version   # package.json + package-lock.json
# then edit DEBUG_CAPTURE_VERSION in src/contract/capture-contract.ts by hand
grep -rn "2.3.0" package.json package-lock.json src/contract/capture-contract.ts
```

Also update the docs that name the version: the tarball name in `README.md`
(Install) and the numbers in `docs/specs/HANDOFF.md`.

## 2. Check

- **Floors.** `test/unit/spec-floor.json` and `test/e2e-floor.json` must equal
  the current counts (they are raised by each PR that adds tests). A release
  adds no tests, so they should already be right.
- **All checks**, on the pinned Chromium and on the station browser:

  ```bash
  npm ci
  npm run check
  eval "$(scripts/chrome-146.sh ~/.cache/debug-capture-chrome-146)"
  npm run check        # Chrome 146.0.7680.72 (NFR-COMP-01)
  ```

Open a PR `build(debug-capture v2): release 2.3.0` into `main` with the
numbers (unit and e2e counts, the `npm run size` table, both browsers). The
owner merges it.

## 3. Pack (from `main`, after the merge)

Build the tarball from the merged commit, so the tag and the file match:

```bash
git checkout main && git pull
npm ci && npm run build
npm pack                                   # → debug-capture-2.3.0.tgz
sha256sum debug-capture-2.3.0.tgz > debug-capture-2.3.0.tgz.sha256
cat debug-capture-2.3.0.tgz.sha256
```

The build is reproducible (`npm pack` fixes the file times, esbuild output is
stable), so the same commit gives the same checksum on any machine with the
same lockfile.

## 4. Tag

```bash
git tag -a v2.3.0 -m "debug-capture 2.3.0"
git push origin v2.3.0
```

Tags are `v<version>`, on the merge commit in `main`.

## 5. Publish the GitHub Release

On GitHub: **Releases › Draft a new release**

1. **Tag:** `v2.3.0` (the one you pushed).
2. **Title:** `debug-capture 2.3.0`.
3. **Notes:** what changed (link the spec folders), the sizes, and the checksum
   line from the `.sha256` file.
4. **Attach:** `debug-capture-2.3.0.tgz` and `debug-capture-2.3.0.tgz.sha256`.
5. Tick **Set as a pre-release** for `-alpha` / `-beta` versions only.
6. **Publish release.**

Or with the GitHub CLI:

```bash
gh release create v2.3.0 debug-capture-2.3.0.tgz debug-capture-2.3.0.tgz.sha256 \
  --title "debug-capture 2.3.0" --notes-file notes.md
```

The download link is then
`https://github.com/izhaq/debug-capture/releases/download/v2.3.0/debug-capture-2.3.0.tgz`.

## 6. Tell the hosts

Give the tarball name, the checksum and the link. Each host follows
[`docs/host-setup.md` › Update](docs/host-setup.md#update-to-a-new-version).
