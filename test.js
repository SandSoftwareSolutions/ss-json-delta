import assert from "node:assert/strict";
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
