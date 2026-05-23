# 05 — Design System (inherited from SovLens, namespaced for SovImage)

## Source of truth

- Public design language: `github.com/asifwanders/SovLens` (frontend dir).
- Local snapshot: `/Users/muhammadasif/Desktop/SovLens/frontend/src/app/globals.css`
  and `…/components/Sidebar.tsx`.

## Tokens (canonical)

| Token              | Light                       | Dark                          |
|--------------------|-----------------------------|-------------------------------|
| `--background`     | `#f5f5f7`                   | `#121212`                     |
| `--foreground`     | `#1d1d1f`                   | `#e5e5ea`                     |
| `--accent`         | `#00b9a0`                   | `#00b9a0`                     |
| `--panel-bg`       | `rgba(255,255,255,0.6)`     | `rgba(30,30,32,0.6)`          |
| `--panel-border`   | `rgba(0,0,0,0.05)`          | `rgba(255,255,255,0.05)`      |
| `--muted-text`     | `#86868b`                   | `#98989d`                     |
| `--glass-shadow`   | `0 8px 32px rgba(0,0,0,.04)`| `0 8px 32px rgba(0,0,0,.2)`   |
| `--danger`         | `#ff453a`                   | `#ff453a`                     |

## Utility: `.glass-panel`

```css
.glass-panel {
  background: var(--panel-bg);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--panel-border);
  box-shadow: var(--glass-shadow);
}
```

## Typography

- Family: Ubuntu via `next/font/google` → CSS var `--font-ubuntu`.
- Base: `html { font-size: 13px }`. All sizes in `rem`.
- Weights: 400 body, 500 emphasized, 700 headings.

## Spacing & radii

- 4 px grid (Tailwind default).
- Radii: `rounded-lg` (8 px) for panels, `rounded-full` for icon buttons,
  `rounded-2xl` (16 px) for bubbles.

## Interaction motion

- Hover bg: `bg-black/15` in light, `bg-white/15` in dark.
- Icon hover: `scale-110`, 150 ms ease-out.
- Focus ring: 2 px `--accent` at 40 % opacity, 2 px offset.

## Component patterns

### Bubble

```
border: 1px solid var(--panel-border)
backdrop-filter: blur(20px)
background: var(--panel-bg)
radius: 16px
padding: 12px 16px
max-width: 720px
```

User bubble has a subtle accent tint: `background-image: linear-gradient(135deg, rgba(0,185,160,0.08), transparent)`.

### Shimmer (image pending)

CSS-only animated gradient, respects `prefers-reduced-motion` by collapsing
to a static panel-bg fill.

### Error bubble

`border-color: var(--danger)` at 40 % opacity, `color: var(--danger)`,
plain text message + retry button outlined in danger color.

## Accessibility contrast notes

- `#00b9a0` on `#f5f5f7` → contrast 2.4:1 — **not** AA for body text. Use
  accent only for icons, focus rings, and bold short labels. Darker
  `#008d7c` allowed for body in light mode if needed.
- Glass panels in light mode dilute contrast — never put `--muted-text` on a
  light glass panel as primary text.

## SovImage-specific additions

- Logo asset: `SovImage-Logo-Wordmark.png` in project root → move to
  `frontend/public/logo-wordmark.png` during scaffold. Splash uses it
  centered, ~280 px wide, with a soft glow (`drop-shadow(0 0 24px var(--accent)/0.35)`).
- Favicon: derive from wordmark in `frontend/public/`.
