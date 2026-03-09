export type MarkdownBlock = {
  headingChain: string[];
  startLine: number;
  endLine: number;
  kind: "paragraph" | "code" | "list" | "table" | "blockquote";
  text: string;
};

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const FENCE_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;

function parseFrontmatter(text: string): { body: string; lineOffset: number } {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { body: normalized, lineOffset: 0 };
  }
  const lines = normalized.split("\n");
  let endIdx = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") {
      endIdx = i;
      break;
    }
  }
  if (endIdx < 0) {
    return { body: normalized, lineOffset: 0 };
  }
  return {
    body: lines.slice(endIdx + 1).join("\n"),
    lineOffset: endIdx + 1,
  };
}

function flushParagraph(
  blocks: MarkdownBlock[],
  headingStack: Array<[number, string]>,
  paraLines: string[],
  paraStart: number | null,
  currentLine: number,
): { paraLines: string[]; paraStart: number | null } {
  if (paraLines.length > 0 && paraStart !== null) {
    const text = paraLines.join("\n").trim();
    if (text) {
      blocks.push({
        headingChain: headingStack.map((h) => h[1]),
        startLine: paraStart,
        endLine: currentLine - 1,
        kind: "paragraph",
        text,
      });
    }
  }
  return { paraLines: [], paraStart: null };
}

export function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const { body, lineOffset } = parseFrontmatter(text);
  const lines = body.split("\n");

  const blocks: MarkdownBlock[] = [];
  const headingStack: Array<[number, string]> = [];

  let paraLines: string[] = [];
  let paraStart: number | null = null;

  let inCode = false;
  let fenceChar = "";
  let fenceLen = 0;
  let codeLines: string[] = [];
  let codeStart: number | null = null;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] || "";
    const lineNo = i + 1 + lineOffset;

    if (!inCode) {
      const m = line.match(FENCE_RE);
      if (m) {
        ({ paraLines, paraStart } = flushParagraph(blocks, headingStack, paraLines, paraStart, lineNo));
        inCode = true;
        fenceChar = m[2][0] || "`";
        fenceLen = m[2].length;
        codeStart = lineNo;
        codeLines = [line];
        i += 1;
        continue;
      }
    }

    if (inCode) {
      codeLines.push(line);
      const close = line.match(FENCE_RE);
      if (close && close[2][0] === fenceChar && close[2].length >= fenceLen) {
        blocks.push({
          headingChain: headingStack.map((h) => h[1]),
          startLine: codeStart ?? lineNo,
          endLine: lineNo,
          kind: "code",
          text: codeLines.join("\n"),
        });
        inCode = false;
        codeLines = [];
        codeStart = null;
        fenceChar = "";
        fenceLen = 0;
      }
      i += 1;
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      ({ paraLines, paraStart } = flushParagraph(blocks, headingStack, paraLines, paraStart, lineNo));
      const level = heading[1].length;
      const title = (heading[2] || "").trim();
      while (headingStack.length > 0 && headingStack[headingStack.length - 1][0] >= level) {
        headingStack.pop();
      }
      headingStack.push([level, title]);
      i += 1;
      continue;
    }

    const stripped = line.trim();

    if (stripped.startsWith(">")) {
      ({ paraLines, paraStart } = flushParagraph(blocks, headingStack, paraLines, paraStart, lineNo));
      const quoteLines = [line];
      let j = i + 1;
      while (j < lines.length) {
        const nxt = (lines[j] || "").trim();
        if (!nxt || nxt.startsWith(">")) {
          quoteLines.push(lines[j] || "");
          j += 1;
          continue;
        }
        break;
      }
      blocks.push({
        headingChain: headingStack.map((h) => h[1]),
        startLine: lineNo,
        endLine: lineNo + quoteLines.length - 1,
        kind: "blockquote",
        text: quoteLines.join("\n").trim(),
      });
      i = j;
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && TABLE_SEPARATOR_RE.test(lines[i + 1] || "")) {
      ({ paraLines, paraStart } = flushParagraph(blocks, headingStack, paraLines, paraStart, lineNo));
      const tableLines = [line, lines[i + 1] || ""];
      let j = i + 2;
      while (j < lines.length) {
        const nxt = lines[j] || "";
        if (!nxt.trim() || !nxt.includes("|")) break;
        tableLines.push(nxt);
        j += 1;
      }
      blocks.push({
        headingChain: headingStack.map((h) => h[1]),
        startLine: lineNo,
        endLine: lineNo + tableLines.length - 1,
        kind: "table",
        text: tableLines.join("\n").trim(),
      });
      i = j;
      continue;
    }

    const isList = /^[-*]\s+/.test(stripped) || /^\d+\.\s+/.test(stripped);
    if (isList) {
      ({ paraLines, paraStart } = flushParagraph(blocks, headingStack, paraLines, paraStart, lineNo));
      const listLines = [line];
      let j = i + 1;
      while (j < lines.length) {
        const nxt = lines[j] || "";
        const nxtStripped = nxt.trim();
        if (!nxtStripped) {
          listLines.push(nxt);
          j += 1;
          continue;
        }
        if (/^[-*]\s+/.test(nxtStripped) || /^\d+\.\s+/.test(nxtStripped) || nxt.startsWith("  ") || nxt.startsWith("\t")) {
          listLines.push(nxt);
          j += 1;
          continue;
        }
        break;
      }
      blocks.push({
        headingChain: headingStack.map((h) => h[1]),
        startLine: lineNo,
        endLine: lineNo + listLines.length - 1,
        kind: "list",
        text: listLines.join("\n").trim(),
      });
      i = j;
      continue;
    }

    if (!stripped) {
      ({ paraLines, paraStart } = flushParagraph(blocks, headingStack, paraLines, paraStart, lineNo));
      i += 1;
      continue;
    }

    if (paraStart === null) paraStart = lineNo;
    paraLines.push(line);
    i += 1;
  }

  const lastLine = lines.length + lineOffset + 1;
  ({ paraLines, paraStart } = flushParagraph(blocks, headingStack, paraLines, paraStart, lastLine));

  if (inCode && codeLines.length > 0) {
    blocks.push({
      headingChain: headingStack.map((h) => h[1]),
      startLine: codeStart ?? lastLine,
      endLine: lastLine,
      kind: "code",
      text: codeLines.join("\n"),
    });
  }

  return blocks;
}
