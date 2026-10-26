# 14b — Panel: the handle and Console

Spec rows S14-08 … S14-11. Paths: `src/panel/**`, `test/e2e/` (new `panel-v23.spec.mjs` on
the hostile host), README, floors, version.

Console: an `app` row uses the level's icon and the label `app`; the message column is
`type` then a one-line preview of `data`; the detail shows a JSON tree. The level chip group
gets **App** (`ConsoleLevel` chip value `'app'`); stored chips accept it. Search: `type` and
the data text. Specs red once; `npm run check`; sizes in the PR.
