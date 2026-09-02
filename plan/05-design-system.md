# 05 — Design System Contract

## Source of truth

`frontend/src/app/globals.css` and the shipped components are authoritative.
Do not duplicate token values or component dimensions in plans: tests and
runtime CSS must change together, while this document records only invariants.

## Invariants

- Use the native system font stack and keep the root size at 16 px.
- Light and dark themes must preserve readable foreground, muted, danger, and
  accent contrast. Accent-colored body text requires an AA-safe token.
- Glass surfaces use the shared `.glass-panel` or `.glass-soft` utilities.
- Focusable controls retain a visible accent outline and an accessible name.
- Icon-only actions expose `aria-label`; asynchronous state uses polite status
  regions, while terminal failures use alerts.
- Motion respects the user’s reduced-motion preference. Pending-image shimmer
  becomes static when reduced motion is requested.
- Layout uses the existing Tailwind spacing/radius utilities; avoid one-off
  pixel constants unless the component has a measured platform requirement.
- The cropped public wordmark and platform icon set are the canonical assets.

## Change gate

Any design change must be checked in both light and dark themes, keyboard-only
navigation, reduced motion, the minimum 880×560 window, and a long prompt/title.
Update `globals.css`, the affected component, and focused regression coverage;
do not update this plan with another copied token table.
