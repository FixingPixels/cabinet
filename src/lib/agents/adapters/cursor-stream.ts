import type { AdapterBillingType, AdapterUsageSummary } from "./types";

/** Cursor headless `stream-json` line (subset of fields we care about). */
interface CursorStreamPayload {
  type?: string;
  subtype?: string;
  session_id?: string;
  apiKeySource?: string;
  model?: string;
  message?: {
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
  };
  timestamp_ms?: number;
  result?: string;
  is_error?: boolean;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  request_id?: string;
  tool_call?: Record<string, unknown>;
}

export interface CursorStreamAccumulator {
  buffer: string;
  /** Full stdout display text (streaming + tool lines), for adapter `output`. */
  display: string;
  /**
   * Concatenation of assistant `text` chunks from lines that include `timestamp_ms`
   * (partial streaming). Used to skip the trailing consolidated `assistant` line.
   */
  partialAssistantBuffer: string;
  finalText?: string | null;
  sessionId?: string | null;
  model?: string | null;
  usage?: AdapterUsageSummary;
  billingType?: AdapterBillingType | null;
}

export function createCursorStreamAccumulator(): CursorStreamAccumulator {
  return {
    buffer: "",
    display: "",
    partialAssistantBuffer: "",
    finalText: null,
    sessionId: null,
    model: null,
    usage: undefined,
    billingType: null,
  };
}

function appendDisplay(
  accumulator: CursorStreamAccumulator,
  text: string
): string {
  if (!text) return "";
  accumulator.display = `${accumulator.display}${text}`;
  return text;
}

function extractAssistantText(payload: CursorStreamPayload): string {
  const content = payload.message?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text || "")
    .join("");
}

function parseUsage(
  raw: CursorStreamPayload["usage"]
): AdapterUsageSummary | undefined {
  if (!raw) return undefined;
  const inputTokens = raw.inputTokens;
  const outputTokens = raw.outputTokens;
  if (typeof inputTokens !== "number" || typeof outputTokens !== "number") {
    return undefined;
  }
  const cachedInputTokens =
    typeof raw.cacheReadTokens === "number" ? raw.cacheReadTokens : undefined;
  return {
    inputTokens,
    outputTokens,
    ...(typeof cachedInputTokens === "number" ? { cachedInputTokens } : {}),
  };
}

function billingFromApiKeySource(source?: string): AdapterBillingType | null {
  if (!source || typeof source !== "string") return null;
  if (source === "login") return "subscription";
  return "api";
}

function formatToolCallStarted(payload: CursorStreamPayload): string {
  if (payload.subtype !== "started") return "";
  const tc = payload.tool_call;
  if (!tc || typeof tc !== "object") {
    return "\n(tool call)\n";
  }

  const read = tc.readToolCall as
    | { args?: { path?: string; limit?: number } }
    | undefined;
  if (read?.args?.path && typeof read.args.path === "string") {
    return `\nread ${read.args.path}\n`;
  }

  const write = tc.writeToolCall as { args?: { path?: string } } | undefined;
  if (write?.args?.path && typeof write.args.path === "string") {
    return `\nwrite ${write.args.path}\n`;
  }

  return "\n(tool call)\n";
}

function captureMetadata(
  accumulator: CursorStreamAccumulator,
  payload: CursorStreamPayload
): void {
  if (typeof payload.session_id === "string" && payload.session_id.trim()) {
    accumulator.sessionId = payload.session_id;
  }

  if (payload.type === "system" && payload.subtype === "init") {
    if (typeof payload.model === "string" && payload.model.trim()) {
      accumulator.model = payload.model;
    }
    const billing = billingFromApiKeySource(payload.apiKeySource);
    if (billing) {
      accumulator.billingType = billing;
    }
  }

  if (payload.type === "result") {
    if (typeof payload.result === "string") {
      accumulator.finalText = payload.result;
    }
    const usage = parseUsage(payload.usage);
    if (usage) {
      accumulator.usage = usage;
    }
    if (typeof payload.session_id === "string" && payload.session_id.trim()) {
      accumulator.sessionId = payload.session_id;
    }
    accumulator.partialAssistantBuffer = "";
  }
}

function consumeCursorEvent(
  accumulator: CursorStreamAccumulator,
  line: string
): string {
  const trimmed = line.trim();
  if (!trimmed) return "";

  try {
    const payload = JSON.parse(trimmed) as CursorStreamPayload;
    const t = payload.type;

    if (!t) {
      return "";
    }

    if (t === "system" && payload.subtype === "init") {
      captureMetadata(accumulator, payload);
      return "";
    }

    if (t === "user") {
      accumulator.partialAssistantBuffer = "";
      if (typeof payload.session_id === "string" && payload.session_id.trim()) {
        accumulator.sessionId = payload.session_id;
      }
      return "";
    }

    if (t === "assistant") {
      captureMetadata(accumulator, payload);
      const text = extractAssistantText(payload);
      if (!text) return "";

      if (typeof payload.timestamp_ms === "number") {
        accumulator.partialAssistantBuffer = `${accumulator.partialAssistantBuffer}${text}`;
        return appendDisplay(accumulator, text);
      }

      if (accumulator.partialAssistantBuffer) {
        if (text === accumulator.partialAssistantBuffer) {
          accumulator.partialAssistantBuffer = "";
          return "";
        }
        accumulator.partialAssistantBuffer = "";
      }

      return appendDisplay(accumulator, text);
    }

    if (t === "tool_call") {
      captureMetadata(accumulator, payload);
      if (payload.subtype === "started") {
        return appendDisplay(accumulator, formatToolCallStarted(payload));
      }
      return "";
    }

    if (t === "result") {
      captureMetadata(accumulator, payload);
      return "";
    }

    captureMetadata(accumulator, payload);
    return "";
  } catch {
    return "";
  }
}

export function consumeCursorStreamJson(
  accumulator: CursorStreamAccumulator,
  chunk: string
): string {
  accumulator.buffer = `${accumulator.buffer}${chunk}`;
  const lines = accumulator.buffer.split(/\r?\n/);
  accumulator.buffer = lines.pop() || "";

  let display = "";
  for (const line of lines) {
    display += consumeCursorEvent(accumulator, line);
  }

  return display;
}

export function flushCursorStreamJson(
  accumulator: CursorStreamAccumulator
): string {
  if (!accumulator.buffer) {
    return "";
  }

  const buffered = accumulator.buffer;
  accumulator.buffer = "";
  return consumeCursorEvent(accumulator, buffered);
}

/** Strip ANSI (invalid API key warnings and similar use color codes on stderr; see spike). */
function stripCursorStderrAnsi(line: string): string {
  return line.replace(
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ""
  );
}

/**
 * Lines to drop entirely (confirmed noisy from real CLI runs). Keep empty until we capture
 * stable patterns; ANSI stripping applies to all non-suppressed lines first.
 */
const CURSOR_STDERR_NOISE_PATTERNS: RegExp[] = [];

export interface CursorStderrAccumulator {
  buffer: string;
}

export function createCursorStderrAccumulator(): CursorStderrAccumulator {
  return { buffer: "" };
}

function shouldSuppressCursorStderrLine(trimmedPlain: string): boolean {
  if (!trimmedPlain) return true;
  return CURSOR_STDERR_NOISE_PATTERNS.some((pattern) =>
    pattern.test(trimmedPlain)
  );
}

function consumeCursorStderrLine(line: string): string {
  const plain = stripCursorStderrAnsi(line);
  const trimmed = plain.trim();
  if (shouldSuppressCursorStderrLine(trimmed)) {
    return "";
  }

  return plain.endsWith("\n") ? plain : `${plain}\n`;
}

export function consumeCursorStderr(
  accumulator: CursorStderrAccumulator,
  chunk: string
): string {
  accumulator.buffer = `${accumulator.buffer}${chunk}`;
  const lines = accumulator.buffer.split(/\r?\n/);
  accumulator.buffer = lines.pop() || "";

  let display = "";
  for (const line of lines) {
    display += consumeCursorStderrLine(line);
  }

  return display;
}

export function flushCursorStderr(
  accumulator: CursorStderrAccumulator
): string {
  if (!accumulator.buffer) {
    return "";
  }

  const buffered = accumulator.buffer;
  accumulator.buffer = "";
  return consumeCursorStderrLine(buffered);
}

export function filterCursorStderr(stderr: string): string {
  const accumulator = createCursorStderrAccumulator();
  const display = consumeCursorStderr(accumulator, stderr);
  const trailing = flushCursorStderr(accumulator);
  return `${display}${trailing}`.trim();
}
