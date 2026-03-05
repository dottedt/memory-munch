#!/usr/bin/env python3
from __future__ import annotations

import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw


SKILL_ROOT = Path("/home/scott/.codex/skills/slack-gif-creator")
sys.path.insert(0, str(SKILL_ROOT))

from core.typography import draw_text_with_outline  # noqa: E402
from core.validators import check_slack_size  # noqa: E402


MM_BG = (15, 20, 25)
MM_SURFACE = (21, 30, 38)
MM_TEXT = (234, 242, 248)
MM_TEXT_MUTED = (157, 176, 193)
MM_BORDER = (44, 62, 80)
MM_ACCENT = (25, 195, 125)
MM_ACCENT_2 = (46, 168, 255)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def ease_out_cubic(t: float) -> float:
    return 1 - (1 - t) ** 3


def draw_network_card(frame: Image.Image, pulse_t: float, appear_t: float) -> None:
    draw = ImageDraw.Draw(frame)

    card_x0, card_y0 = 72, 78
    card_x1, card_y1 = 408, 284
    draw.rounded_rectangle(
        [(card_x0, card_y0), (card_x1, card_y1)],
        radius=22,
        fill=MM_SURFACE,
        outline=MM_BORDER,
        width=2,
    )

    nodes = [(138, 180), (240, 130), (340, 188), (240, 240)]
    edges = [(0, 1), (1, 2), (0, 3), (3, 2)]

    for a, b in edges:
        draw.line([nodes[a], nodes[b]], fill=(70, 98, 124), width=4)

    visible_nodes = int(lerp(1, len(nodes), appear_t))
    for idx, (x, y) in enumerate(nodes):
        if idx >= visible_nodes:
            continue
        radius = 17
        fill = MM_ACCENT if idx % 2 == 0 else MM_ACCENT_2
        draw.ellipse([(x - radius, y - radius), (x + radius, y + radius)], fill=fill, outline=MM_BG, width=2)

    path = [nodes[0], nodes[1], nodes[2], nodes[3], nodes[0]]
    if pulse_t > 0:
        seg_float = pulse_t * (len(path) - 1)
        seg_idx = min(int(seg_float), len(path) - 2)
        local_t = seg_float - seg_idx
        x0, y0 = path[seg_idx]
        x1, y1 = path[seg_idx + 1]
        px = int(lerp(x0, x1, local_t))
        py = int(lerp(y0, y1, local_t))
        glow = int(lerp(10, 22, (math.sin(pulse_t * math.pi * 6) + 1) / 2))
        draw.ellipse([(px - glow, py - glow), (px + glow, py + glow)], fill=(46, 168, 255))
        draw.ellipse([(px - 9, py - 9), (px + 9, py + 9)], fill=(234, 242, 248))


def build_gif(out_path: Path) -> dict:
    width, height, fps = 480, 480, 18
    frames_total = 54
    frames: list[Image.Image] = []

    for i in range(frames_total):
        frame = Image.new("RGB", (width, height), MM_BG)
        draw = ImageDraw.Draw(frame)

        for ring in range(3):
            alpha_t = (i / frames_total) + ring * 0.12
            r = int(160 + ring * 36 + 24 * math.sin(alpha_t * math.pi * 2))
            cx, cy = 240, 230
            shade = 24 + ring * 9
            draw.ellipse(
                [(cx - r, cy - r), (cx + r, cy + r)],
                outline=(shade, shade + 8, shade + 14),
                width=1,
            )

        appear_t = min(1.0, i / 16.0)
        pulse_t = 0.0 if i < 16 else ((i - 16) / (frames_total - 16))
        draw_network_card(frame, pulse_t=pulse_t, appear_t=ease_out_cubic(appear_t))

        title_pop = ease_out_cubic(min(1.0, max(0.0, (i - 26) / 14)))
        subtitle_pop = ease_out_cubic(min(1.0, max(0.0, (i - 34) / 12)))
        title_y = int(332 - (1 - title_pop) * 18)
        subtitle_y = int(380 - (1 - subtitle_pop) * 12)

        if title_pop > 0:
            draw_text_with_outline(
                frame,
                "MemoryMunch",
                position=(240, title_y),
                font_size=54,
                text_color=MM_TEXT,
                outline_color=MM_BG,
                outline_width=3,
                centered=True,
                bold=True,
            )

        if subtitle_pop > 0:
            draw_text_with_outline(
                frame,
                "Indexed Markdown Memory",
                position=(240, subtitle_y),
                font_size=26,
                text_color=MM_TEXT_MUTED,
                outline_color=MM_BG,
                outline_width=2,
                centered=True,
                bold=False,
            )

        frames.append(frame.convert("P", palette=Image.ADAPTIVE, colors=96))

    duration_ms = int(1000 / fps)
    frames[0].save(
        out_path,
        save_all=True,
        append_images=frames[1:],
        duration=duration_ms,
        loop=0,
        optimize=True,
        disposal=2,
    )
    return {
        "path": str(out_path),
        "size_kb": out_path.stat().st_size / 1024,
        "dimensions": f"{width}x{height}",
        "frame_count": len(frames),
        "fps": fps,
        "duration_seconds": len(frames) / fps,
        "colors": 96,
    }


def main() -> None:
    out_dir = Path("assets/gifs")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "memory-munch-slack.gif"

    info = build_gif(out_path)
    passes, size_info = check_slack_size(out_path, is_emoji=False)

    print(f"\nSlack message GIF pass: {passes}")
    print(
        f"File: {info['path']} | Size: {size_info['size_kb']:.1f}KB / {size_info['limit_kb']}KB limit"
    )


if __name__ == "__main__":
    main()
