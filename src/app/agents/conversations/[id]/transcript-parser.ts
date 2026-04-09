export type Block =
  | { type: "text"; content: string }
  | { type: "diff"; header: string; lines: DiffLine[] }
  | { type: "code"; lang: string; content: string }
  | { type: "cabinet"; fields: { label: string; value: string }[] }
  | { type: "structured"; label: string; value: string }
  | { type: "tokens"; value: string };

export type DiffLine = { kind: "add" | "remove" | "hunk" | "header" | "plain"; text: string };

const DIFF_START = /^diff --git /;
const STRUCTURED_RE = /^(SUMMARY|CONTEXT|CONTEXT_UPDATE|ARTIFACT|DECISION|LEARNING|GOAL_UPDATE|MESSAGE_TO)\s*(?:\[([^\]]*)\])?:\s*(.*)$/;
const TOKENS_RE = /^[\d,]+$/;

function preprocess(text: string): string {
  return text
    .split("\n")
    .flatMap((line) => {
      if (DIFF_START.test(line)) return [line];
      const idx = line.indexOf("diff --git a/");
      if (idx > 0) {
        return [line.substring(0, idx), line.substring(idx)];
      }
      return [line];
    })
    .join("\n");
}

function isDiffStart(line: string): boolean {
  return DIFF_START.test(line);
}

function isDiffContentLine(line: string): boolean {
  if (line.startsWith("+") || line.startsWith("-")) return true;
  if (line.startsWith("@@")) return true;
  if (/^(index |new file|deleted file|old mode|new mode|similarity|rename|copy)/.test(line)) return true;
  if (line.startsWith("+++") || line.startsWith("---")) return true;
  return false;
}

function parseDiffBlock(lines: string[], startIdx: number): { block: Block; endIdx: number } {
  const header = lines[startIdx];
  const diffLines: DiffLine[] = [];
  let i = startIdx + 1;

  while (i < lines.length) {
    const line = lines[i];
    if (isDiffStart(line)) break;

    if (line.startsWith("+++") || line.startsWith("---")) {
      diffLines.push({ kind: "header", text: line });
    } else if (line.startsWith("@@")) {
      diffLines.push({ kind: "hunk", text: line });
    } else if (line.startsWith("+")) {
      diffLines.push({ kind: "add", text: line });
    } else if (line.startsWith("-")) {
      diffLines.push({ kind: "remove", text: line });
    } else if (/^(index |new file|deleted file|old mode|new mode|similarity|rename|copy)/.test(line)) {
      diffLines.push({ kind: "header", text: line });
    } else if (line.startsWith(" ") || line === "") {
      const hasHunks = diffLines.some((d) => d.kind === "hunk");
      if (hasHunks) {
        diffLines.push({ kind: "plain", text: line });
      } else {
        diffLines.push({ kind: "header", text: line });
      }
    } else {
      break;
    }
    i++;
  }

  return { block: { type: "diff", header, lines: diffLines }, endIdx: i };
}

function parseCodeBlock(lines: string[], startIdx: number): { block: Block; endIdx: number } | null {
  const match = lines[startIdx].match(/^```(\w*)$/);
  if (!match) return null;

  const lang = match[1] || "text";
  const codeLines: string[] = [];
  let i = startIdx + 1;

  while (i < lines.length) {
    if (lines[i] === "```") {
      const nonEmpty = codeLines.filter((l) => l.trim());
      const allStructured = nonEmpty.length > 0 && nonEmpty.every((l) => STRUCTURED_RE.test(l));

      if (allStructured) {
        const fields = nonEmpty.map((l) => {
          const m = l.match(STRUCTURED_RE)!;
          return { label: m[2] ? `${m[1]} [${m[2]}]` : m[1], value: m[3] };
        });
        return { block: { type: "cabinet", fields }, endIdx: i + 1 };
      }

      return { block: { type: "code", lang, content: codeLines.join("\n") }, endIdx: i + 1 };
    }
    codeLines.push(lines[i]);
    i++;
  }

  return null;
}

function parseStructuredLine(line: string): Block | null {
  const match = line.match(/^(SUMMARY|CONTEXT|CONTEXT_UPDATE|ARTIFACT|DECISION|LEARNING|GOAL_UPDATE|MESSAGE_TO)\s*(?:\[([^\]]*)\])?:\s+(.*)$/);
  if (!match) return null;
  const label = match[2] ? `${match[1]} [${match[2]}]` : match[1];
  return { type: "structured", label, value: match[3] };
}

export function parseTranscript(raw: string): Block[] {
  const text = preprocess(raw);
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let textBuf: string[] = [];

  function flushText() {
    if (textBuf.length > 0) {
      const content = textBuf.join("\n").trim();
      if (!content) { textBuf = []; return; }

      const nonEmpty = textBuf.filter((l) => l.trim());
      const diffLikeCount = nonEmpty.filter((l) => isDiffContentLine(l)).length;
      if (nonEmpty.length > 0 && diffLikeCount / nonEmpty.length >= 0.5) {
        const diffLines: DiffLine[] = textBuf
          .filter((l) => l.trim())
          .map((l) => {
            if (l.startsWith("+")) return { kind: "add" as const, text: l };
            if (l.startsWith("-")) return { kind: "remove" as const, text: l };
            if (l.startsWith("@@")) return { kind: "hunk" as const, text: l };
            return { kind: "plain" as const, text: l };
          });
        blocks.push({ type: "diff", header: "", lines: diffLines });
      } else {
        blocks.push({ type: "text", content });
      }
      textBuf = [];
    }
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (isDiffStart(line)) {
      flushText();
      const result = parseDiffBlock(lines, i);
      blocks.push(result.block);
      i = result.endIdx;
      continue;
    }

    if (/^```/.test(line)) {
      const result = parseCodeBlock(lines, i);
      if (result) {
        flushText();
        blocks.push(result.block);
        i = result.endIdx;
        continue;
      }
    }

    const structured = parseStructuredLine(line);
    if (structured) {
      flushText();
      blocks.push(structured);
      i++;
      continue;
    }

    if (TOKENS_RE.test(line.trim()) && i >= lines.length - 3) {
      flushText();
      blocks.push({ type: "tokens", value: line.trim() });
      i++;
      continue;
    }

    textBuf.push(line);
    i++;
  }

  flushText();
  return blocks;
}
