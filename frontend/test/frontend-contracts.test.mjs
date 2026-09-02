import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectImage,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_DIMENSION,
} from "../src/lib/image-validation.ts";
import {
  HIGHLIGHT_END,
  HIGHLIGHT_START,
  retainExistingSearchHits,
  splitHighlight,
  toFtsPhrase,
} from "../src/lib/search.ts";
import { formatRelative } from "../src/lib/utils.ts";

test("accepts PNG and JPEG by bytes, not filename", () => {
  const png = new Uint8Array(24);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  png.set([73, 72, 68, 82], 12);
  new DataView(png.buffer).setUint32(16, 800);
  new DataView(png.buffer).setUint32(20, 600);
  assert.deepEqual(inspectImage(png), {
    extension: ".png",
    mime: "image/png",
    width: 800,
    height: 600,
  });

  const jpeg = new Uint8Array(21);
  jpeg.set([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 2, 88, 3, 32]);
  assert.deepEqual(inspectImage(jpeg), {
    extension: ".jpg",
    mime: "image/jpeg",
    width: 800,
    height: 600,
  });
});

test("rejects disguised or oversized attachment inputs", () => {
  assert.throws(
    () => inspectImage(new TextEncoder().encode("<img src=x onerror=alert(1)>")),
    /valid PNG or JPEG/,
  );
  assert.equal(MAX_ATTACHMENT_BYTES, 25 * 1024 * 1024);
  assert.equal(MAX_ATTACHMENT_DIMENSION, 8_192);

  const tooWide = new Uint8Array(24);
  tooWide.set([137, 80, 78, 71, 13, 10, 26, 10]);
  tooWide.set([73, 72, 68, 82], 12);
  new DataView(tooWide.buffer).setUint32(16, MAX_ATTACHMENT_DIMENSION + 1);
  new DataView(tooWide.buffer).setUint32(20, 1);
  assert.throws(() => inspectImage(tooWide), /dimensions must be at most/);
});

test("FTS highlights stay text and queries are literal phrases", () => {
  const hostile = `<img src=x onerror=alert(1)> ${HIGHLIGHT_START}cat${HIGHLIGHT_END}`;
  assert.deepEqual(splitHighlight(hostile), [
    { text: "<img src=x onerror=alert(1)> ", highlighted: false },
    { text: "cat", highlighted: true },
  ]);
  assert.equal(toFtsPhrase('cat "photo"'), '"cat ""photo"""');
});

test("deleted chats cannot retain search snippets", () => {
  const hits = [
    { messageId: "m1", chatId: "kept", snippet: "one" },
    { messageId: "m2", chatId: "deleted", snippet: "secret" },
  ];
  assert.deepEqual(retainExistingSearchHits(hits, ["kept"]), [hits[0]]);
});

test("relative dates handle invalid and future timestamps", () => {
  assert.equal(formatRelative("not-a-date"), "Unknown date");
  const future = new Date(Date.now() + 86_400_000);
  assert.equal(formatRelative(future.toISOString()), future.toLocaleDateString());
});
