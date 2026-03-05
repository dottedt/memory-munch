from dmemorymunch_mpc.parser import parse_markdown_blocks


def test_parse_markdown_blocks_structure_and_lines():
    text = """---
title: Sample
---
# Agents
Intro paragraph.

- one
- two

```py
print('x')
```
"""
    frontmatter, blocks = parse_markdown_blocks(text)
    assert frontmatter["title"] == "Sample"
    assert blocks
    assert any(b.kind == "paragraph" for b in blocks)
    assert any(b.kind == "list" for b in blocks)
    assert any(b.kind == "code" for b in blocks)
    assert all(b.start_line <= b.end_line for b in blocks)
