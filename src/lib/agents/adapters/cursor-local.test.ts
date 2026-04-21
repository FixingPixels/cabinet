import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildCursorArgs, cursorLocalAdapter } from "./cursor-local";

async function createExecutableScript(source: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cabinet-cursor-local-test-"));
  const scriptPath = path.join(dir, "fake-agent.sh");
  await fs.writeFile(scriptPath, source, "utf8");
  await fs.chmod(scriptPath, 0o755);
  return scriptPath;
}

test("buildCursorArgs sets headless defaults and optional automation flags", () => {
  const base = buildCursorArgs({}, "/tmp/ws");
  assert.deepEqual(base, [
    "-p",
    "--trust",
    "--output-format",
    "stream-json",
    "--stream-partial-output",
    "--workspace",
    "/tmp/ws",
  ]);

  const withModel = buildCursorArgs({ model: "composer-2" }, "/w");
  assert.ok(withModel.includes("--model"));
  assert.equal(withModel[withModel.indexOf("--model") + 1], "composer-2");

  const aggressive = buildCursorArgs(
    {
      force: true,
      approveMcps: true,
      trust: false,
      streamPartialOutput: false,
      workspace: "/override",
    },
    "/w"
  );
  assert.ok(!aggressive.includes("--trust"));
  assert.ok(!aggressive.includes("--stream-partial-output"));
  assert.ok(aggressive.includes("--force"));
  assert.ok(aggressive.includes("--approve-mcps"));
  assert.equal(aggressive[aggressive.indexOf("--workspace") + 1], "/override");
});

test("cursorLocalAdapter executes a structured stream-json run with prompt as argv", async () => {
  const scriptPath = await createExecutableScript(`#!/bin/sh
last=""
for arg do last=$arg; done
if [ "$last" != "Say hello" ]; then
  echo "expected last argv to be prompt, got: $last" >&2
  exit 2
fi
printf '%s\\n' \\
  '{"type":"system","subtype":"init","apiKeySource":"login","session_id":"00000000-0000-0000-0000-000000000001","model":"Composer 2","permissionMode":"default"}' \\
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"pong"}]},"session_id":"00000000-0000-0000-0000-000000000001"}' \\
  '{"type":"result","subtype":"success","is_error":false,"result":"pong","session_id":"00000000-0000-0000-0000-000000000001","usage":{"inputTokens":26271,"outputTokens":31,"cacheReadTokens":5056,"cacheWriteTokens":0}}'
printf '%s\\n' 'Meaningful stderr line' >&2
`);

  const chunks: Array<{ stream: "stdout" | "stderr"; chunk: string }> = [];
  const result = await cursorLocalAdapter.execute?.({
    runId: "run-1",
    adapterType: "cursor_local",
    config: { command: scriptPath },
    prompt: "Say hello",
    cwd: process.cwd(),
    onLog: async (stream, chunk) => {
      chunks.push({ stream, chunk });
    },
  });

  assert.ok(result);
  assert.equal(result.exitCode, 0);
  assert.equal(result.output, "pong");
  assert.equal(result.summary, "pong");
  assert.equal(result.provider, "cursor-cli");
  assert.equal(result.model, "Composer 2");
  assert.equal(result.billingType, "subscription");
  assert.equal(result.sessionId, "00000000-0000-0000-0000-000000000001");
  assert.deepEqual(result.usage, {
    inputTokens: 26271,
    outputTokens: 31,
    cachedInputTokens: 5056,
  });
  assert.deepEqual(chunks, [
    { stream: "stdout", chunk: "pong" },
    { stream: "stderr", chunk: "Meaningful stderr line\n" },
  ]);
});
