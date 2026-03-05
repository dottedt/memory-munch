# MemoryMunch Brand Style

## Brand Core

- Name: `MemoryMunch`
- Tagline: `Indexed Markdown Memory for AI Agents`
- Positioning: local-first memory infrastructure that turns markdown knowledge into precise, queryable memory nodes.

## Voice and Tone

- Tone: precise, technical, calm, practical.
- Personality: infrastructure-grade, no hype, high signal.
- Writing rules:
  - Prefer concrete claims over adjectives.
  - Use short, direct sentences.
  - Emphasize determinism, speed, local control, and portability.
  - Avoid marketing fluff.

## Visual Direction

- Style: modern technical utility.
- Mood: focused, trustworthy, low-noise.
- Shape language: rounded-rectangle surfaces with crisp borders.
- Iconography: simple geometric glyphs, thin-to-medium stroke.

## Color System

- `--mm-bg`: `#0F1419` (deep slate)
- `--mm-surface`: `#151E26` (panel surface)
- `--mm-elevated`: `#1C2833` (elevated cards)
- `--mm-text`: `#EAF2F8` (primary text)
- `--mm-text-muted`: `#9DB0C1` (secondary text)
- `--mm-border`: `#2C3E50` (borders)
- `--mm-accent`: `#19C37D` (primary accent)
- `--mm-accent-2`: `#2EA8FF` (secondary accent)
- `--mm-warning`: `#F5A524` (warning)
- `--mm-danger`: `#E5484D` (error)

Use accent sparingly for interactive and key status elements only.

## Typography

- Headings: `Space Grotesk` (600/700)
- Body/UI: `IBM Plex Sans` (400/500)
- Code/Paths: `IBM Plex Mono` (400/500)

Fallbacks:
- `Space Grotesk, "Segoe UI", sans-serif`
- `"IBM Plex Sans", "Segoe UI", sans-serif`
- `"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace`

## Spacing and Radius

- Base spacing unit: `8px`
- Scale: `4, 8, 12, 16, 24, 32, 48`
- Radius scale:
  - small `6px`
  - medium `10px`
  - large `14px`

## UI Tokens (Copy/Paste)

```css
:root {
  --mm-bg: #0F1419;
  --mm-surface: #151E26;
  --mm-elevated: #1C2833;
  --mm-text: #EAF2F8;
  --mm-text-muted: #9DB0C1;
  --mm-border: #2C3E50;
  --mm-accent: #19C37D;
  --mm-accent-2: #2EA8FF;
  --mm-warning: #F5A524;
  --mm-danger: #E5484D;

  --mm-radius-sm: 6px;
  --mm-radius-md: 10px;
  --mm-radius-lg: 14px;

  --mm-space-1: 4px;
  --mm-space-2: 8px;
  --mm-space-3: 12px;
  --mm-space-4: 16px;
  --mm-space-5: 24px;
  --mm-space-6: 32px;
  --mm-space-7: 48px;
}
```

## Logo Direction

- Concept: `memory node + path`.
- Marks:
  - Primary: stacked dots connected by a path line inside a rounded square.
  - Alternate: wordmark `MemoryMunch` with highlighted `Munch` in accent.
- Do not use gradients in the logo mark.

## Messaging Pillars

- Deterministic retrieval first.
- Surgical context, not markdown blobs.
- Local-first and portable.
- Built for multi-agent workflows.

## Example Product Copy

- `Compile markdown once. Retrieve exactly what the agent needs.`
- `Deterministic memory paths for AI workflows.`
- `Local SQLite index. MCP-native retrieval.`

