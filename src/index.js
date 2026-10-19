/** Thrown when a patch cannot be applied. `op` is the operation that failed, `index` its position in the patch. */
export class PatchError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "PatchError";
    Object.assign(this, details);
  }
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const FORBIDDEN = new Set(["__proto__"]);

/** Escapes one segment for a JSON Pointer (RFC 6901): `~` becomes `~0`, `/` becomes `~1`. */
export const escapePointer = (segment) => String(segment).replace(/~/g, "~0").replace(/\//g, "~1");

/** Splits a JSON Pointer into segments: `"/a/b~1c/0"` gives `["a", "b/c", "0"]`; `""` is the whole document. */
export function parsePointer(pointer) {
  if (pointer === "") return [];
  if (typeof pointer !== "string" || !pointer.startsWith("/")) throw new PatchError(`"${pointer}" is not a JSON Pointer (it must start with /)`);
  return pointer.slice(1).split("/").map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/** Whether two JSON values are equal, regardless of the order of object keys. */
export function equal(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && equal(a[k], b[k]));
  }
  return false;
}

/**
 * The difference between two JSON values as a JSON Patch (RFC 6902): a list of `add`, `remove` and `replace` operations that turn
 * `before` into `after`. Objects are compared by key. Arrays are compared by position, except that items added or removed at the
 * end are reported as such; for lists of records, compare by id yourself first (`arrayKey` below does this for you).
 * Option `arrayKey`: a property name that identifies the items of arrays of objects (`"id"`), so a reordered or middle-inserted list
 * gives small operations instead of many replacements. It is used for arrays where every item has a distinct string, number, boolean or
 * null id; any other array (a missing id, a duplicate id, an object as id) is compared by position.
 */
export function diff(before, after, { arrayKey } = {}) {
  const ops = [];
  walk(before, after, "", ops, arrayKey);
  return ops;
}

function walk(a, b, path, ops, arrayKey) {
  if (equal(a, b)) return;
  if (isObject(a) && isObject(b)) {
    for (const key of Object.keys(a)) {
      if (!Object.hasOwn(b, key)) ops.push({ op: "remove", path: `${path}/${escapePointer(key)}` });
      else walk(a[key], b[key], `${path}/${escapePointer(key)}`, ops, arrayKey);
    }
    for (const key of Object.keys(b)) if (!Object.hasOwn(a, key)) ops.push({ op: "add", path: `${path}/${escapePointer(key)}`, value: b[key] });
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (arrayKey && hasUniqueKeys(a, arrayKey) && hasUniqueKeys(b, arrayKey)) {
      byKey(a, b, path, ops, arrayKey);
      return;
    }
    const common = Math.min(a.length, b.length);
    for (let i = 0; i < common; i++) walk(a[i], b[i], `${path}/${i}`, ops, arrayKey);
    for (let i = a.length - 1; i >= b.length; i--) ops.push({ op: "remove", path: `${path}/${i}` }); // from the end, so the indexes stay valid
    for (let i = a.length; i < b.length; i++) ops.push({ op: "add", path: `${path}/${i}`, value: b[i] });
    return;
  }
  ops.push({ op: "replace", path, value: b });
}

// Every item is an object with a plain (string, number, boolean or null) value for `key`, and no two items share that value.
// With duplicate or complex keys the items cannot be matched one to one, so the arrays are compared by position instead.
function hasUniqueKeys(array, key) {
  const seen = new Set();
  for (const x of array) {
    if (!isObject(x) || !Object.hasOwn(x, key)) return false;
    const id = x[key];
    if (id !== null && typeof id === "object") return false;
    if (seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

function byKey(a, b, path, ops, key) {
  const wanted = new Set(b.map((x) => x[key]));
  // Remove what is gone (from the end), then walk through the new list adding and changing in order.
  const working = [...a];
  for (let i = working.length - 1; i >= 0; i--) {
    if (!wanted.has(working[i][key])) {
      ops.push({ op: "remove", path: `${path}/${i}` });
      working.splice(i, 1);
    }
  }
  b.forEach((item, index) => {
    const at = working.findIndex((x) => equal(x[key], item[key]));
    if (at === -1) {
      ops.push({ op: "add", path: `${path}/${index}`, value: item });
      working.splice(index, 0, item);
    } else {
      if (at !== index) {
        ops.push({ op: "move", from: `${path}/${at}`, path: `${path}/${index}` });
        working.splice(index, 0, working.splice(at, 1)[0]);
      }
      walk(working[index], item, `${path}/${index}`, ops, key);
    }
  });
}

const clone = (v) => structuredClone(v);

function resolveParent(doc, segments, op, index) {
  let current = doc;
  for (let i = 0; i < segments.length - 1; i++) {
    const s = segments[i];
    if (FORBIDDEN.has(s)) throw new PatchError(`the path segment "${s}" is not allowed`, { op, index });
    current = Array.isArray(current) ? current[arrayIndex(current, s, false, op, index)] : isObject(current) && Object.hasOwn(current, s) ? current[s] : undefined;
    if (current === undefined || current === null || typeof current !== "object") throw new PatchError(`the path ${JSON.stringify(op.path)} does not exist`, { op, index });
  }
  return current;
}

function arrayIndex(array, segment, allowEnd, op, index) {
  if (segment === "-" && allowEnd) return array.length;
  if (!/^(0|[1-9]\d*)$/.test(segment)) throw new PatchError(`"${segment}" is not an array index`, { op, index });
  const n = Number(segment);
  if (n > array.length || (n === array.length && !allowEnd)) throw new PatchError(`index ${n} is out of range (the array has ${array.length} items)`, { op, index });
  return n;
}

function getAt(doc, pointer, op, index) {
  let current = doc;
  for (const s of parsePointer(pointer)) {
    if (FORBIDDEN.has(s)) throw new PatchError(`the path segment "${s}" is not allowed`, { op, index });
    if (Array.isArray(current)) current = current[arrayIndex(current, s, false, op, index)];
    else if (isObject(current) && Object.hasOwn(current, s)) current = current[s];
    else throw new PatchError(`the path ${JSON.stringify(pointer)} does not exist`, { op, index });
  }
  return current;
}

function addAt(doc, pointer, value, op, index) {
  const segments = parsePointer(pointer);
  if (segments.length === 0) return clone(value);
  const parent = resolveParent(doc, segments, { ...op, path: pointer }, index);
  const last = segments[segments.length - 1];
  if (FORBIDDEN.has(last)) throw new PatchError(`the path segment "${last}" is not allowed`, { op, index });
  if (parent === null || typeof parent !== "object") throw new PatchError(`the path ${JSON.stringify(pointer)} does not exist (the parent is not an object or array)`, { op, index });
  if (Array.isArray(parent)) parent.splice(arrayIndex(parent, last, true, op, index), 0, clone(value));
  else Object.defineProperty(parent, last, { value: clone(value), enumerable: true, writable: true, configurable: true });
  return doc;
}

function removeAt(doc, pointer, op, index) {
  const segments = parsePointer(pointer);
  if (segments.length === 0) throw new PatchError("the whole document cannot be removed", { op, index });
  const parent = resolveParent(doc, segments, { ...op, path: pointer }, index);
  const last = segments[segments.length - 1];
  if (Array.isArray(parent)) return { doc, removed: parent.splice(arrayIndex(parent, last, false, op, index), 1)[0] };
  if (!isObject(parent) || !Object.hasOwn(parent, last)) throw new PatchError(`the path ${JSON.stringify(pointer)} does not exist`, { op, index });
  const removed = parent[last];
  delete parent[last];
  return { doc, removed };
}

/**
 * Applies a JSON Patch (RFC 6902) and returns the new document. The input is never changed. Supports add, remove, replace, move,
 * copy and test. If any operation fails the whole patch fails with a `PatchError` (the document is not half changed because you
 * keep your original). `__proto__` in a path is refused.
 */
export function apply(document, patch) {
  if (!Array.isArray(patch)) throw new PatchError("a patch must be an array of operations");
  let doc = clone(document);
  patch.forEach((op, index) => {
    if (!isObject(op) || typeof op.op !== "string" || typeof op.path !== "string") throw new PatchError("every operation needs an op and a path", { op, index });
    switch (op.op) {
      case "add":
        if (!("value" in op)) throw new PatchError("add needs a value", { op, index });
        doc = addAt(doc, op.path, op.value, op, index);
        break;
      case "remove":
        removeAt(doc, op.path, op, index);
        break;
      case "replace": {
        if (!("value" in op)) throw new PatchError("replace needs a value", { op, index });
        if (parsePointer(op.path).length === 0) doc = clone(op.value);
        else {
          getAt(doc, op.path, op, index);
          const segments = parsePointer(op.path);
          const parent = resolveParent(doc, segments, op, index);
          const last = segments[segments.length - 1];
          if (Array.isArray(parent)) parent[arrayIndex(parent, last, false, op, index)] = clone(op.value);
          else Object.defineProperty(parent, last, { value: clone(op.value), enumerable: true, writable: true, configurable: true });
        }
        break;
      }
      case "move": {
        if (typeof op.from !== "string") throw new PatchError("move needs a from", { op, index });
        if (op.path.startsWith(`${op.from}/`)) throw new PatchError("a value cannot be moved into itself", { op, index });
        const { removed } = removeAt(doc, op.from, op, index);
        doc = addAt(doc, op.path, removed, op, index);
        break;
      }
      case "copy": {
        if (typeof op.from !== "string") throw new PatchError("copy needs a from", { op, index });
        doc = addAt(doc, op.path, getAt(doc, op.from, op, index), op, index);
        break;
      }
      case "test":
        if (!equal(getAt(doc, op.path, op, index), op.value)) throw new PatchError(`the value at ${JSON.stringify(op.path)} is not what the patch expects`, { op, index });
        break;
      default:
        throw new PatchError(`unknown operation "${op.op}"`, { op, index });
    }
  });
  return doc;
}

/** A one-line description for logs: `changed name, removed phone, added tags/0`. */
export function summarize(patch) {
  const verbs = { add: "added", remove: "removed", replace: "changed", move: "moved", copy: "copied", test: "checked" };
  return patch.map((op) => `${verbs[op.op] ?? op.op} ${parsePointer(op.path).join("/") || "(everything)"}`).join(", ");
}
