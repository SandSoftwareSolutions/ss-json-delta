# @sandsoftwaresolutions/json-delta

[![CI](https://github.com/SandSoftwareSolutions/ss-json-delta/actions/workflows/ci.yml/badge.svg)](https://github.com/SandSoftwareSolutions/ss-json-delta/actions/workflows/ci.yml)

Find out what changed between two JSON documents, as a standard **JSON Patch** (RFC 6902), and apply such a patch again. For audit logs ("who changed what"), undo, sync, and sending only the changes to an API. No dependencies.

## Install

```bash
npm install @sandsoftwaresolutions/json-delta
```

## Usage

```js
import { diff, apply, summarize } from "@sandsoftwaresolutions/json-delta";

const before = { name: "Kaj", phone: "0612345678", tags: ["a"] };
const after  = { name: "Kaj van S", tags: ["a", "b"] };

const patch = diff(before, after);
// [ { op: "replace", path: "/name", value: "Kaj van S" },
//   { op: "remove",  path: "/phone" },
//   { op: "add",     path: "/tags/1", value: "b" } ]

summarize(patch);              // "changed name, removed phone, added tags/1"
apply(before, patch);          // deep-equal to `after`; `before` itself is not changed
apply(after, diff(after, before));   // the way back: undo
```

Lists of records, compared by id so a reordered or inserted item gives small operations:

```js
diff(oldOrder, newOrder, { arrayKey: "id" });   // uses move / add / remove instead of replacing every item
```

## What you get

- **Standard format.** Operations `add`, `remove`, `replace`, `move`, `copy`, `test`, with JSON Pointer paths (`/a/b~1c/0`). Checked against the examples of RFC 6902 appendix A and against 900 random documents (`apply(a, diff(a, b))` always equals `b`).
- **Never changes your data.** `apply` works on a copy and the result shares nothing with the input or the patch.
- **All or nothing.** If one operation fails (a path that does not exist, a failing `test`, an array index out of range) you get a `PatchError` with the operation and its position, and you still have your original.
- **`test` operations** make a patch safe to apply later: `{ op: "test", path: "/version", value: 3 }` fails if someone changed it in between.
- **No prototype pollution.** `__proto__` in a path is refused.
- `equal(a, b)` is a deep comparison that ignores key order. `escapePointer`, `parsePointer` and `summarize` are there too.

## Know that

- Arrays are compared by position (unless you give `arrayKey`): changing the first item of a list of 1000 gives one `replace`, but inserting at the front without `arrayKey` shifts everything and gives many replacements.
- Only JSON values: no `undefined`, Dates or functions. Convert first.
