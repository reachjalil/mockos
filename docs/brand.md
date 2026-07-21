<h1><span aria-hidden="true">🥸</span> mockOS brand</h1>

Status: Initial visual identity
Last reviewed: 2026-07-22

mockOS uses the disguised-face idea as a direct visual shorthand for **mock identity**.
The treatment is intentionally restrained: it is a product mark for developer
infrastructure, not a character or mascot.

## Primary lockup

Use this text lockup when native text is appropriate:

> 🥸 mockOS
>
> **Mock identity infrastructure for integration tests.**

Use the exact casing `mockOS`. The emoji belongs in high-salience brand lockups,
avatars, and product chrome. Keep ordinary prose, package names, API identifiers, URLs,
headers, and code emoji-free.

## Assets

| Asset | Purpose |
|---|---|
| [`mockos-mark.svg`](../assets/brand/mockos-mark.svg) | Primary square avatar and product mark |
| [`mockos-mark-mono.svg`](../assets/brand/mockos-mark-mono.svg) | Single-color print or constrained surfaces |
| [`mockos-mark-512.png`](../assets/brand/mockos-mark-512.png) | 512px raster avatar |
| [`mockos-mark-1024.png`](../assets/brand/mockos-mark-1024.png) | 1024px raster avatar |
| [`mockos-lockup.svg`](../assets/brand/mockos-lockup.svg) | Stable horizontal mark and wordmark |
| [`mockos-lockup-dark.svg`](../assets/brand/mockos-lockup-dark.svg) | Light horizontal lockup for dark backgrounds |
| [`mockos-favicon.svg`](../assets/brand/mockos-favicon.svg) | Reduced small-size browser treatment |
| [`mockos-social-card.svg`](../assets/brand/mockos-social-card.svg) | Editable 1280 × 640 social-preview source |
| [`mockos-social-card.png`](../assets/brand/mockos-social-card.png) | GitHub and other raster social previews |
| [`manifest.json`](../assets/brand/manifest.json) | Source/output hashes and raster dimensions used by CI |

The vector mark is an original geometric interpretation of the concept behind 🥸. It
does not embed or copy artwork from an operating-system emoji set. Use Unicode `🥸` in
text; use the vector when consistent rendering matters.

Keep clear space around the mark equal to one quarter of its width. Use the full mark at
24px or larger and the reduced favicon treatment below 24px.

## Visual system

- **Ink:** `#14231F` — wordmark, type, and primary controls
- **Paper:** `#F7F5EF` — warm, understated brand field
- **Signal:** `#2F6B5A` — identity/protocol accent
- **Muted:** `#66736E` — supporting copy
- **Border:** `#CDD5D1` — quiet structure

Use a modern system sans-serif stack and a system monospace for protocol details. Keep
layouts generous, flat, and quiet. Avoid gradients, novelty display fonts, character
poses, emoji patterns, and multiple decorative emoji in one view.

## Product and provider separation

Provider fidelity belongs in routes, claims, errors, and behavior—not in ambiguous
co-branding. Login screens must lead with mockOS, say that they are test environments,
and name the simulated provider in text. Do not present Microsoft or Okta artwork as
the mockOS product mark.

## Accessibility

The emoji must never be the only accessible name. In HTML, when it appears beside
visible `mockOS` text, mark it decorative with `aria-hidden="true"`. In plain-text
surfaces where markup is unavailable, always pair it with `mockOS`. Use `alt=""` for a
logo image directly beside a visible wordmark and `alt="mockOS"` when the image stands
alone. Preserve the SVG title and description when embedding the vector directly.
