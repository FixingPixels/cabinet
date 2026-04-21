import { cursorCliProvider } from "../providers/cursor-cli";
import { resolveCliCommand } from "../provider-cli";
import { providerStatusToEnvironmentTest } from "./environment";
import {
  consumeCursorStreamJson,
  createCursorStreamAccumulator,
  flushCursorStreamJson,
} from "./cursor-stream";
import type { AgentExecutionAdapter } from "./types";
import { ADAPTER_RUNTIME_PATH, runChildProcess } from "./utils";

function readStringConfig(
  config: Record<string, unknown>,
  key: string
): string | undefined {
  const value = config[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readBooleanConfig(
  config: Record<string, unknown>,
  key: string
): boolean | undefined {
  const value = config[key];
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

/** Base argv for headless `agent`; prompt is appended as the final positional argument. */
export function buildCursorArgs(
  config: Record<string, unknown>,
  workspace: string
): string[] {
  const args = ["-p"];

  if (readBooleanConfig(config, "trust") !== false) {
    args.push("--trust");
  }

  args.push("--output-format", "stream-json");

  if (readBooleanConfig(config, "streamPartialOutput") !== false) {
    args.push("--stream-partial-output");
  }

  const ws = readStringConfig(config, "workspace") || workspace;
  args.push("--workspace", ws);

  const model = readStringConfig(config, "model");
  if (model) {
    args.push("--model", model);
  }

  if (readBooleanConfig(config, "force") === true) {
    args.push("--force");
  }

  if (readBooleanConfig(config, "approveMcps") === true) {
    args.push("--approve-mcps");
  }

  return args;
}

function firstNonEmptyLine(text: string): string | null {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) || null
  );
}

export const cursorLocalAdapter: AgentExecutionAdapter = {
  type: "cursor_local",
  name: "Cursor Local",
  description:
    "Structured Cursor Agent CLI execution using stream-json output for live transcript updates and detached runs.",
  providerId: cursorCliProvider.id,
  executionEngine: "structured_cli",
  supportsDetachedRuns: true,
  supportsSessionResume: false,
  models: cursorCliProvider.models,
  async testEnvironment() {
    return providerStatusToEnvironmentTest(
      "cursor_local",
      await cursorCliProvider.healthCheck(),
      cursorCliProvider.installMessage
    );
  },
  async execute(ctx) {
    const command =
      readStringConfig(ctx.config, "command") || resolveCliCommand(cursorCliProvider);
    const args = [...buildCursorArgs(ctx.config, ctx.cwd), ctx.prompt];
    const accumulator = createCursorStreamAccumulator();

    await ctx.onMeta?.({
      adapterType: ctx.adapterType,
      command,
      commandArgs: args,
      cwd: ctx.cwd,
      env: {
        PATH: ADAPTER_RUNTIME_PATH,
      },
    });

    const result = await runChildProcess(command, args, {
      cwd: ctx.cwd,
      timeoutMs: ctx.timeoutMs,
      onSpawn: ctx.onSpawn,
      onStdout: (chunk) => {
        const display = consumeCursorStreamJson(accumulator, chunk);
        if (!display) return;
        void ctx.onLog("stdout", display);
      },
      onStderr: (chunk) => {
        if (!chunk) return;
        void ctx.onLog("stderr", chunk);
      },
    });

    const trailingDisplay = flushCursorStreamJson(accumulator);
    if (trailingDisplay) {
      await ctx.onLog("stdout", trailingDisplay);
    }

    const output =
      (accumulator.finalText && String(accumulator.finalText).trim()) ||
      accumulator.display.trim() ||
      null;
    const summaryLine = output ? firstNonEmptyLine(output)?.slice(0, 300) || null : null;

    return {
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      errorMessage:
        result.exitCode === 0
          ? null
          : result.stderr.trim() || output || "Cursor local execution failed.",
      usage: accumulator.usage,
      sessionId: accumulator.sessionId,
      provider: cursorCliProvider.id,
      model: accumulator.model || readStringConfig(ctx.config, "model") || null,
      billingType: accumulator.billingType || "unknown",
      summary: summaryLine,
      output,
    };
  },
};
