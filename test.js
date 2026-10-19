import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { apply, diff, equal, escapePointer, parsePointer, PatchError, summarize } from "./src/index.js";

// The examples of RFC 6902, appendix A.
test("RFC 6902 appendix A", () => {
  assert.deepEqual(apply({ foo: "bar" }, [{ op: "add", path: "/baz", value: "qux" }]), { foo: "bar", baz: "qux" }); // A.1
  assert.deepEqual(apply({ foo: ["bar", "baz"] }, [{ op: "add", path: "/foo/1", value: "qux" }]), { foo: ["bar", "qux", "baz"] }); // A.2
  assert.deepEqual(apply({ baz: "qux", foo: "bar" }, [{ op: "remove", path: "/baz" }]), { foo: "bar" }); // A.3
  assert.deepEqual(apply({ foo: ["bar", "qux", "baz"] }, [{ op: "remove", path: "/foo/1" }]), { foo: ["bar", "baz"] }); // A.4
  assert.deepEqual(apply({ baz: "qux", foo: "bar" }, [{ op: "replace", path: "/baz", value: "boo" }]), { baz: "boo", foo: "bar" }); // A.5
  assert.deepEqual(apply({ foo: { bar: "baz", waldo: "fred" }, qux: { corge: "grault" } }, [{ op: "move", from: "/foo/waldo", path: "/qux/thud" }]), { foo: { bar: "baz" }, qux: { corge: "grault", thud: "fred" } }); // A.6
  assert.deepEqual(apply({ foo: ["all", "grass", "cows", "eat"] }, [{ op: "move", from: "/foo/1", path: "/foo/3" }]), { foo: ["all", "cows", "eat", "grass"] }); // A.7
  assert.deepEqual(apply({ baz: "qux", foo: ["a", 2, "c"] }, [{ op: "test", path: "/baz", value: "qux" }, { op: "test", path: "/foo/1", value: 2 }]), { baz: "qux", foo: ["a", 2, "c"] }); // A.8
  assert.throws(() => apply({ baz: "qux" }, [{ op: "test", path: "/baz", value: "bar" }]), PatchError); // A.9
  assert.deepEqual(apply({ foo: "bar" }, [{ op: "add", path: "/child", value: { grandchild: {} } }]), { foo: "bar", child: { grandchild: {} } }); // A.10
  assert.deepEqual(apply({ foo: "bar" }, [{ op: "add", path: "/baz", value: "qux", xyz: 123 }]), { foo: "bar", baz: "qux" }); // A.11
  assert.throws(() => apply({ foo: "bar" }, [{ op: "add", path: "/baz/bat", value: "qux" }]), PatchError); // A.12
  assert.deepEqual(apply({ "/": 9, "~1": 10 }, [{ op: "test", path: "/~01", value: 10 }]), { "/": 9, "~1": 10 }); // A.14
  assert.throws(() => apply({ foo: "bar" }, [{ op: "test", path: "/foo", value: ["bar"] }]), PatchError);
  assert.deepEqual(apply({ foo: ["bar"] }, [{ op: "add", path: "/foo/-", value: ["abc", "def"] }]), { foo: ["bar", ["abc", "def"]] }); // A.16
  assert.deepEqual(apply({ foo: "bar" }, [{ op: "copy", from: "/foo", path: "/baz" }]), { foo: "bar", baz: "bar" });
});

test("the input is never changed, and the result shares nothing with it", () => {
  const doc = { a: { b: [1, 2] } };
  const out = apply(doc, [{ op: "add", path: "/a/b/-", value: 3 }]);
  assert.deepEqual(doc, { a: { b: [1, 2] } });
  out.a.b.push(99);
  assert.deepEqual(doc.a.b, [1, 2]);
  const value = { x: 1 };
  const added = apply({}, [{ op: "add", path: "/v", value }]);
  value.x = 2;
  assert.equal(added.v.x, 1);
});

test("a failing operation fails the whole patch with the operation and its position", () => {
  try {
    apply({ a: 1 }, [{ op: "replace", path: "/a", value: 2 }, { op: "remove", path: "/zzz" }]);
    assert.fail("should throw");
  } catch (e) {
    assert.ok(e instanceof PatchError);
    assert.equal(e.index, 1);
    assert.equal(e.op.op, "remove");
  }
  const bad = [[{ op: "nope", path: "/a" }], [{ path: "/a" }], [{ op: "add", path: "/a" }], [{ op: "move", path: "/a" }], [{ op: "remove", path: "" }], [{ op: "add", path: "/arr/5", value: 1 }], [{ op: "replace", path: "/arr/5", value: 1 }], [{ op: "add", path: "/arr/01", value: 1 }], [{ op: "add", path: "no-slash", value: 1 }], [{ op: "move", from: "/arr", path: "/arr/0" }]];
  for (const patch of bad) assert.throws(() => apply({ arr: [1] }, patch), PatchError, JSON.stringify(patch));
  assert.throws(() => apply({}, "not an array"), PatchError);
});

test("__proto__ in a path is refused and nothing is polluted", () => {
  for (const path of ["/__proto__/polluted", "/__proto__", "/a/__proto__/x"]) {
    assert.throws(() => apply({ a: {} }, [{ op: "add", path, value: 1 }]), PatchError, path);
  }
  assert.equal({}.polluted, undefined);
  assert.throws(() => apply({}, [{ op: "add", path: "/constructor/prototype/x", value: 1 }]), PatchError);
  assert.equal(Object.prototype.x, undefined);
  assert.deepEqual(apply({}, [{ op: "add", path: "/constructor", value: 1 }]), { constructor: 1 });
});

test("diff gives small, readable operations", () => {
  assert.deepEqual(diff({ a: 1, b: 2 }, { a: 1, b: 3, c: 4 }), [{ op: "replace", path: "/b", value: 3 }, { op: "add", path: "/c", value: 4 }]);
  assert.deepEqual(diff({ a: 1, b: 2 }, { b: 2 }), [{ op: "remove", path: "/a" }]);
  assert.deepEqual(diff({ x: { y: { z: 1 } } }, { x: { y: { z: 2 } } }), [{ op: "replace", path: "/x/y/z", value: 2 }]);
  assert.deepEqual(diff([1, 2, 3], [1, 2, 3, 4]), [{ op: "add", path: "/3", value: 4 }]);
  assert.deepEqual(diff([1, 2, 3, 4], [1, 2]), [{ op: "remove", path: "/3" }, { op: "remove", path: "/2" }]);
  assert.deepEqual(diff({ "a/b": 1, "c~d": 1 }, { "a/b": 2, "c~d": 1 }), [{ op: "replace", path: "/a~1b", value: 2 }]);
  assert.deepEqual(diff({ a: 1 }, { a: 1 }), []);
  assert.deepEqual(diff(1, 2), [{ op: "replace", path: "", value: 2 }]);
  assert.deepEqual(diff({ a: [1] }, { a: "text" }), [{ op: "replace", path: "/a", value: "text" }]);
});

test("key order does not matter", () => {
  assert.deepEqual(diff({ a: 1, b: 2 }, { b: 2, a: 1 }), []);
  assert.equal(equal({ a: [1, { x: 1, y: 2 }] }, { a: [1, { y: 2, x: 1 }] }), true);
  assert.equal(equal([1, 2], [2, 1]), false);
  assert.equal(equal(null, {}), false);
  assert.equal(equal(1, "1"), false);
});

test("apply(a, diff(a, b)) is b, for many random documents", () => {
  let seed = 987654;
  const rand = (n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
  const value = (depth) => {
    const kind = rand(depth > 2 ? 4 : 7);
    if (kind === 0) return rand(5);
    if (kind === 1) return String.fromCharCode(97 + rand(3));
    if (kind === 2) return rand(2) === 0;
    if (kind === 3) return null;
    if (kind === 4 || kind === 5) return Array.from({ length: rand(5) }, () => value(depth + 1));
    return Object.fromEntries(Array.from({ length: rand(5) }, () => [["a", "b", "c/d", "e~f", "g"][rand(5)], value(depth + 1)]));
  };
  for (let round = 0; round < 500; round++) {
    const a = value(0);
    const b = rand(3) === 0 ? structuredClone(a) : value(0);
    assert.deepEqual(apply(a, diff(a, b)), b, `round ${round}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
  }
});

test("arrayKey makes reordered and inserted lists small, and still correct", () => {
  const before = { items: [{ id: 1, n: "a" }, { id: 2, n: "b" }, { id: 3, n: "c" }] };
  const after = { items: [{ id: 3, n: "c" }, { id: 1, n: "A" }, { id: 4, n: "d" }] };
  const patch = diff(before, after, { arrayKey: "id" });
  assert.deepEqual(apply(before, patch), after);
  assert.ok(patch.length <= 6, JSON.stringify(patch));
  assert.ok(patch.some((op) => op.op === "move"));
  const plain = diff(before, after);
  assert.deepEqual(apply(before, plain), after);
});

test("arrayKey with random record lists", () => {
  let seed = 4242;
  const rand = (n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
  const list = () => {
    const ids = [...new Set(Array.from({ length: rand(7) }, () => rand(9)))];
    return ids.map((id) => ({ id, v: rand(3) }));
  };
  for (let round = 0; round < 400; round++) {
    const a = list();
    const b = list();
    assert.deepEqual(apply(a, diff(a, b, { arrayKey: "id" })), b, `round ${round}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
  }
});

test("pointers and summaries", () => {
  assert.deepEqual(parsePointer("/a/b~1c/0/~0x"), ["a", "b/c", "0", "~x"]);
  assert.deepEqual(parsePointer(""), []);
  assert.equal(escapePointer("a/b~c"), "a~1b~0c");
  assert.throws(() => parsePointer("a/b"), PatchError);
  assert.equal(summarize([{ op: "replace", path: "/name", value: 1 }, { op: "remove", path: "/phone" }, { op: "add", path: "/tags/0", value: "x" }]), "changed name, removed phone, added tags/0");
});

test("arrayKey with duplicate or complex ids falls back to positions and the patch still gives the new document", () => {
  const cases = [
    [[{ id: 3, v: 1 }, { id: 5, v: 1 }, { id: 4, v: 2 }, { id: 3, v: 1 }, { id: 5, v: 0 }], [{ id: 4, v: 2 }, { id: 3, v: 1 }, { id: 5, v: 0 }, { id: 3, v: 1 }]],
    [[{ id: 2, v: 0 }, { id: 1, v: 1 }, { id: 4, v: 0 }, { id: 2, v: 0 }], [{ id: 2, v: 9 }, { id: 1, v: 1 }, { id: 4, v: 9 }, { id: 2, v: 0 }]],
    [[{ id: { a: 1 } }, { id: { a: 2 } }], [{ id: { a: 2 } }, { id: { a: 1 } }]]
  ];
  for (const [before, after] of cases) assert.deepEqual(apply({ l: before }, diff({ l: before }, { l: after }, { arrayKey: "id" })), { l: after });
});

test("adding to a document whose parent is a number, string or null is a PatchError, not a TypeError", () => {
  for (const doc of [5, "s", null, true]) assert.throws(() => apply(doc, [{ op: "add", path: "/a", value: 1 }]), PatchError);
});

test("random documents: apply(a, diff(a, b)) equals b, with and without arrayKey (plus the patch round-trips through JSON)", () => {
  const pick = (n) => randomBytes(1)[0] % n;
  const keys = ["a", "b", "c", "/", "~", "0", "id", "toString", "constructor"];
  const gen = (depth = 0) => {
    switch (pick(depth > 3 ? 4 : 7)) {
      case 0: return null;
      case 1: return pick(3);
      case 2: return ["a", "~", "/", ""][pick(4)];
      case 3: return pick(2) === 0;
      case 4: return Array.from({ length: pick(5) }, () => gen(depth + 1));
      default: {
        const o = {};
        for (let i = pick(5); i > 0; i--) o[keys[pick(keys.length)]] = gen(depth + 1);
        return o;
      }
    }
  };
  const mutate = (v, depth = 0) => {
    if (pick(4) === 0) return gen(depth);
    if (Array.isArray(v)) {
      const r = v.map((x) => mutate(x, depth + 1));
      if (pick(3) === 0) r.splice(pick(r.length + 1), pick(2), gen(depth + 1));
      if (pick(5) === 0) r.reverse();
      return r;
    }
    if (v && typeof v === "object") {
      const o = {};
      for (const k of Object.keys(v)) if (pick(6)) o[k] = mutate(v[k], depth + 1);
      if (pick(3) === 0) o[keys[pick(keys.length)]] = gen(depth + 1);
      return o;
    }
    return v;
  };
  for (let i = 0; i < 1500; i++) {
    const a = gen();
    const b = pick(5) ? mutate(a) : gen();
    for (const options of [{}, { arrayKey: "id" }]) {
      const patch = JSON.parse(JSON.stringify(diff(a, b, options)));
      assert.ok(equal(apply(a, patch), b), JSON.stringify({ a, b, options, patch }));
    }
  }
});

test("a path through an own '__proto__' key of the document is refused, and indexes at or beyond the end of an array are errors for remove, replace, test and move", () => {
  const doc = JSON.parse('{"__proto__":{"a":1},"list":[1,2]}');
  assert.throws(() => apply(doc, [{ op: "add", path: "/__proto__/b", value: 2 }]), PatchError);
  assert.throws(() => apply(doc, [{ op: "replace", path: "/__proto__/a", value: 2 }]), PatchError);
  assert.equal({}.b, undefined);
  for (const op of [{ op: "remove", path: "/list/2" }, { op: "replace", path: "/list/2", value: 0 }, { op: "test", path: "/list/2", value: 0 }, { op: "move", from: "/list/2", path: "/x" }, { op: "copy", from: "/list/2", path: "/x" }]) {
    assert.throws(() => apply(doc, [op]), PatchError, JSON.stringify(op));
  }
  assert.deepEqual(apply({ list: [1, 2] }, [{ op: "add", path: "/list/2", value: 3 }]), { list: [1, 2, 3] });
  assert.throws(() => apply({ a: { b: 1 } }, [{ op: "move", from: "/a", path: "/a/b/c" }]), /into itself/);
});
