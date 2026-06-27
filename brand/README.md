# Premon — Brand assets

The Premon mark is a **foresight eye**: the firewall *sees* the transaction
before you sign it.

## Files

| File | Use |
| --- | --- |
| `premon-mark.svg` / `premon-mark-{64,128,256,512,1024}.png` | App icon / avatar (ink tile + eye). Primary mark. |
| `premon-glyph.svg` / `premon-glyph-512.png` | Eye only, transparent (no tile) — for tinted contexts. |
| `premon-lockup.svg` / `.png` | Horizontal mark + wordmark, **dark text** (light backgrounds). |
| `premon-lockup-light.svg` / `.png` | Horizontal lockup, **white text** (dark backgrounds). |

The mark/glyph are pure vector shapes — crisp at any size, font-independent.
The lockups set the wordmark in **Space Grotesk Bold** (referenced via web font
in the SVG; the bundled PNGs fall back to a system bold where the font isn't
installed).

## Colors

| Token | Hex | Use |
| --- | --- | --- |
| Monad Purple | `#836EF9` | Iris / accent / wordmark dot |
| Ink | `#141414` | Tile / wordmark on light |
| White | `#FFFFFF` | Eye / wordmark on dark |

## Typeface

Wordmark: **Space Grotesk**, weight 700, letter-spacing ~0.04em, uppercase.

## Don'ts

- Don't recolor the iris to anything but Monad purple.
- Don't add effects (shadows, gradients) to the mark.
- Keep clear space around the mark ≥ 25% of its height.

Live copies are served at `https://premon.vercel.app/brand/…`.
