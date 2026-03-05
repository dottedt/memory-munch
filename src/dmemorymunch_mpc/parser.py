from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

import yaml


HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
FENCE_RE = re.compile(r"^( {0,3})(`{3,}|~{3,})(.*)$")
TABLE_SEPARATOR_RE = re.compile(r"^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$")


@dataclass(slots=True)
class MarkdownBlock:
    heading_chain: list[str]
    start_line: int
    end_line: int
    kind: str
    text: str


def parse_frontmatter(text: str) -> tuple[dict[str, Any], str, int]:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    if not normalized.startswith("---\n"):
        return {}, normalized, 0

    # OpenClaw-compatible: detect closing delimiter as a standalone line.
    lines = normalized.split("\n")
    end_line_idx: int | None = None
    for idx in range(1, len(lines)):
        if lines[idx].strip() == "---":
            end_line_idx = idx
            break
    if end_line_idx is None:
        return {}, normalized, 0

    raw = "\n".join(lines[1:end_line_idx])
    parsed = yaml.safe_load(raw) or {}
    if not isinstance(parsed, dict):
        raise ValueError("Frontmatter must be a mapping")

    body = "\n".join(lines[end_line_idx + 1 :])
    line_offset = end_line_idx + 1
    return parsed, body, line_offset


def _flush_paragraph(
    blocks: list[MarkdownBlock],
    heading_chain: list[str],
    para_lines: list[str],
    para_start: int | None,
    current_line: int,
) -> tuple[list[str], int | None]:
    if para_lines and para_start is not None:
        text = "\n".join(para_lines).strip()
        if text:
            blocks.append(
                MarkdownBlock(
                    heading_chain=list(heading_chain),
                    start_line=para_start,
                    end_line=current_line - 1,
                    kind="paragraph",
                    text=text,
                )
            )
    return [], None


def parse_markdown_blocks(text: str) -> tuple[dict[str, Any], list[MarkdownBlock]]:
    frontmatter, body, line_offset = parse_frontmatter(text)
    lines = body.splitlines()

    blocks: list[MarkdownBlock] = []
    heading_stack: list[tuple[int, str]] = []

    para_lines: list[str] = []
    para_start: int | None = None

    in_code = False
    fence_char = ""
    fence_len = 0
    code_lines: list[str] = []
    code_start: int | None = None

    i = 0
    while i < len(lines):
        line = lines[i]
        line_no = i + 1 + line_offset

        if not in_code:
            fence_open = FENCE_RE.match(line)
            if fence_open:
                para_lines, para_start = _flush_paragraph(
                    blocks, [h for _, h in heading_stack], para_lines, para_start, line_no
                )
                in_code = True
                marker = fence_open.group(2)
                fence_char = marker[0]
                fence_len = len(marker)
                code_start = line_no
                code_lines = [line]
                i += 1
                continue

        if in_code:
            if code_lines:
                code_lines.append(line)
            else:
                code_lines = [line]
            fence_close = FENCE_RE.match(line)
            if fence_close:
                marker = fence_close.group(2)
                if marker and marker[0] == fence_char and len(marker) >= fence_len:
                    blocks.append(
                        MarkdownBlock(
                            heading_chain=[h for _, h in heading_stack],
                            start_line=code_start or line_no,
                            end_line=line_no,
                            kind="code",
                            text="\n".join(code_lines),
                        )
                    )
                    in_code = False
                    fence_char = ""
                    fence_len = 0
                    code_lines = []
                    code_start = None
            i += 1
            continue

        heading_match = HEADING_RE.match(line)
        if heading_match:
            para_lines, para_start = _flush_paragraph(
                blocks, [h for _, h in heading_stack], para_lines, para_start, line_no
            )
            level = len(heading_match.group(1))
            title = heading_match.group(2).strip()
            while heading_stack and heading_stack[-1][0] >= level:
                heading_stack.pop()
            heading_stack.append((level, title))
            i += 1
            continue

        stripped = line.strip()

        if stripped.startswith(">"):
            para_lines, para_start = _flush_paragraph(
                blocks, [h for _, h in heading_stack], para_lines, para_start, line_no
            )
            quote_start = line_no
            quote_lines = [line]
            i += 1
            while i < len(lines):
                nxt = lines[i]
                nxt_stripped = nxt.strip()
                if not nxt_stripped or nxt_stripped.startswith(">"):
                    quote_lines.append(nxt)
                    i += 1
                    continue
                break
            blocks.append(
                MarkdownBlock(
                    heading_chain=[h for _, h in heading_stack],
                    start_line=quote_start,
                    end_line=quote_start + len(quote_lines) - 1,
                    kind="blockquote",
                    text="\n".join(quote_lines).strip(),
                )
            )
            continue

        if "|" in line and i + 1 < len(lines) and TABLE_SEPARATOR_RE.match(lines[i + 1]):
            para_lines, para_start = _flush_paragraph(
                blocks, [h for _, h in heading_stack], para_lines, para_start, line_no
            )
            table_start = line_no
            table_lines = [line, lines[i + 1]]
            i += 2
            while i < len(lines):
                nxt = lines[i]
                if not nxt.strip() or "|" not in nxt:
                    break
                table_lines.append(nxt)
                i += 1
            blocks.append(
                MarkdownBlock(
                    heading_chain=[h for _, h in heading_stack],
                    start_line=table_start,
                    end_line=table_start + len(table_lines) - 1,
                    kind="table",
                    text="\n".join(table_lines).strip(),
                )
            )
            continue

        is_list = bool(
            stripped.startswith("- ")
            or stripped.startswith("* ")
            or re.match(r"^\d+\.\s+", stripped)
        )
        if is_list:
            para_lines, para_start = _flush_paragraph(
                blocks, [h for _, h in heading_stack], para_lines, para_start, line_no
            )
            list_start = line_no
            list_lines = [line]
            i += 1
            while i < len(lines):
                nxt = lines[i]
                nxt_stripped = nxt.strip()
                if not nxt_stripped:
                    list_lines.append(nxt)
                    i += 1
                    continue
                if nxt_stripped.startswith("- ") or nxt_stripped.startswith("* ") or re.match(r"^\d+\.\s+", nxt_stripped):
                    list_lines.append(nxt)
                    i += 1
                    continue
                if nxt.startswith("  ") or nxt.startswith("\t"):
                    list_lines.append(nxt)
                    i += 1
                    continue
                break
            blocks.append(
                MarkdownBlock(
                    heading_chain=[h for _, h in heading_stack],
                    start_line=list_start,
                    end_line=list_start + len(list_lines) - 1,
                    kind="list",
                    text="\n".join(list_lines).strip(),
                )
            )
            continue

        if not stripped:
            para_lines, para_start = _flush_paragraph(
                blocks, [h for _, h in heading_stack], para_lines, para_start, line_no
            )
            i += 1
            continue

        if para_start is None:
            para_start = line_no
        para_lines.append(line)
        i += 1

    last_line = len(lines) + line_offset + 1
    para_lines, para_start = _flush_paragraph(
        blocks, [h for _, h in heading_stack], para_lines, para_start, last_line
    )

    if in_code and code_lines:
        blocks.append(
            MarkdownBlock(
                heading_chain=[h for _, h in heading_stack],
                start_line=code_start or last_line,
                end_line=last_line,
                kind="code",
                text="\n".join(code_lines),
            )
        )

    return frontmatter, blocks
