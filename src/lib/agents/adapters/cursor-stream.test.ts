import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  consumeCursorStreamJson,
  createCursorStreamAccumulator,
  flushCursorStreamJson,
} from "./cursor-stream";

function fixturePath(name: string): string {
  return path.join(process.cwd(), "test/fixtures/cursor-stream", name);
}

function feedWholeNdjson(accumulator: ReturnType<typeof createCursorStreamAccumulator>, raw: string): string {
  let out = "";
  out += consumeCursorStreamJson(accumulator, raw);
  out += flushCursorStreamJson(accumulator);
  return out;
}

test("cursor stream: trivial success fixture", () => {
  const raw = readFileSync(fixturePath("trivial-success.ndjson"), "utf8");
  const acc = createCursorStreamAccumulator();
  const streamed = feedWholeNdjson(acc, raw);

  assert.equal(streamed, "\npong");
  assert.equal(acc.display, "\npong");
  assert.equal(acc.finalText, "\npong");
  assert.equal(acc.sessionId, "00000000-0000-0000-0000-000000000001");
  assert.equal(acc.model, "Composer 2");
  assert.equal(acc.billingType, "subscription");
  assert.deepEqual(acc.usage, {
    inputTokens: 100,
    outputTokens: 10,
    cachedInputTokens: 0,
  });
});

test("cursor stream: partial streaming skips duplicate consolidated assistant line", () => {
  const raw = readFileSync(fixturePath("partial-stream.ndjson"), "utf8");
  const acc = createCursorStreamAccumulator();
  const streamed = feedWholeNdjson(acc, raw);

  assert.equal(streamed, "Hello there friend");
  assert.equal(acc.display, "Hello there friend");
  assert.equal(acc.finalText, "Hello there friend");
  assert.deepEqual(acc.usage, {
    inputTokens: 50,
    outputTokens: 7,
    cachedInputTokens: 0,
  });
});

test("cursor stream: tool read fixture", () => {
  const raw = readFileSync(fixturePath("tool-read.ndjson"), "utf8");
  const acc = createCursorStreamAccumulator();
  const streamed = feedWholeNdjson(acc, raw);

  assert.equal(
    streamed,
    "\nread /tmp/workspace/package.json\nexample"
  );
  assert.equal(acc.finalText, "example");
});

test("cursor stream: tolerates malformed and unknown JSON lines without throwing", () => {
  const acc = createCursorStreamAccumulator();
  const lines = [
    '{"type":"system","subtype":"init","session_id":"s-init","model":"M","apiKeySource":"login"}',
    "not valid json {{{",
    '{"type":"experimental","session_id":"s-exp"}',
    '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"ok"}]},"session_id":"s-exp"}',
    '{"type":"result","subtype":"success","result":"ok","session_id":"s-exp","usage":{"inputTokens":1,"outputTokens":2}}',
  ];
  const raw = `${lines.join("\n")}\n`;

  assert.doesNotThrow(() => {
    feedWholeNdjson(acc, raw);
  });

  assert.equal(acc.sessionId, "s-exp");
  assert.equal(acc.display, "ok");
  assert.equal(acc.finalText, "ok");
});

test("cursor stream: newline buffering across chunks", () => {
  const raw = readFileSync(fixturePath("trivial-success.ndjson"), "utf8");
  const acc = createCursorStreamAccumulator();
  let streamed = "";
  for (let i = 0; i < raw.length; i += 11) {
    streamed += consumeCursorStreamJson(acc, raw.slice(i, i + 11));
  }
  streamed += flushCursorStreamJson(acc);

  assert.equal(streamed, "\npong");
  assert.equal(acc.display, "\npong");
});
