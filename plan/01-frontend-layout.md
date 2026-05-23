# 01 — Frontend Layout (React / Next.js 16 / Tailwind 4 / Framer)

## Route map (App Router, static export)

| Route        | Purpose                                                  |
|--------------|----------------------------------------------------------|
| `/`          | Chat workspace — sidebar + active chat thread            |
| `/settings`  | Theme, model tier override, output dir, telemetry-off    |
| `/about`     | App info, version, license, links to repo + issues       |

Static export means no server actions, no dynamic segments. Chat IDs live in
query string (`/?chat=<uuid>`) — App Router supports this fine for export.

## Component tree

```
<RootLayout>                              src/app/layout.tsx
  <ThemeBootstrap />                      Injects .dark/.light pre-hydration
  <SplashGate>                            Blocks until first-run setup done
    <AppShell>
      <Sidebar />                         src/components/Sidebar.tsx
      <main>
        {children}                        page.tsx mounts <ChatView />
      </main>
    </AppShell>
  </SplashGate>
</RootLayout>
```

### `<Sidebar />` — adapted from SovLens

- Collapsible width (56 ↔ 224 px); storage key `sovimage.sidebar.collapsed`.
- Top section:
  - **+ New Chat** primary button (accent fill, glass border)
  - Search input (filters chat list client-side)
  - Chat list — virtualized after 50 items; each row has hover actions:
    rename (inline input), delete (confirm modal)
- Bottom section: theme toggle, Settings link, About link, collapse toggle.

### `<ChatView />`

- Header: chat title (editable on click), model badge (e.g. "Flux.1-schnell
  Q4_0"), 3-dot menu (export, delete).
- Scrollable message list (CSS `overflow-anchor: none` to control jumps).
- Message bubbles:
  - **User bubble**: right-aligned, glass-panel, text prompt + optional
    drop-attached preview thumbnail.
  - **Assistant bubble**: left-aligned, glass-panel. States:
    - `pending` → shimmer placeholder (skeleton, animated gradient)
    - `success` → generated PNG with download/copy/regen overlay on hover
    - `error` → red-tinted glass with error message + retry button
- Composer at bottom: textarea + `+` attach icon (file picker) + send.
  Drop zone covers entire `<ChatView>` while drag is active (overlay glass
  panel "Drop to start image-to-image").

### `<Splash />`

Full-window glass panel, centered. Two phases:
1. **Profiling** — animated logo, "Detecting hardware…".
2. **Download** — model name, progress bar (Framer Motion `width`), bytes
   counter, "Pause" + "Resume" buttons (call Tauri IPC). On `error`, show a
   retry button. On `verify`, show "Verifying checksum…". On `done`, fade
   into AppShell.

## State

- `useChats()` hook (Zustand) — owns chat list, active chat, CRUD wired to
  Tauri IPC `db_*` commands.
- `useTheme()` — reads/writes `.dark` / `.light` on `<html>`, persists
  `sovimage.theme`.
- `useSetup()` — first-run gate. Reads `setup_state` from Rust on mount.
- No global state for generation queue; messages own their own status,
  driven by Tauri event listeners scoped to the chat ID.

## Styling tokens (in `globals.css`)

Replicate SovLens variables but rename namespace:

```css
:root {
  --background: #f5f5f7;
  --foreground: #1d1d1f;
  --accent: #00b9a0;
  --accent-foreground: #ffffff;
  --panel-bg: rgba(255,255,255,0.6);
  --panel-border: rgba(0,0,0,0.05);
  --muted-text: #86868b;
  --glass-shadow: 0 8px 32px rgba(0,0,0,0.04);
  --danger: #ff453a;
}
:root.dark {
  --background: #121212;
  --foreground: #e5e5ea;
  --panel-bg: rgba(30,30,32,0.6);
  --panel-border: rgba(255,255,255,0.05);
  --muted-text: #98989d;
  --glass-shadow: 0 8px 32px rgba(0,0,0,0.2);
}

.glass-panel {
  background: var(--panel-bg);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--panel-border);
  box-shadow: var(--glass-shadow);
}
```

`html { font-size: 13px }` matches SovLens base scale.

## Animations (Framer Motion)

- Splash logo: gentle `scale` + `opacity` loop while profiling.
- Bubble enter: `y: 8 → 0`, `opacity: 0 → 1`, 180 ms ease-out.
- Sidebar width: pure CSS transition; Framer would re-render every frame.
- Splash fade-out on done: 250 ms `AnimatePresence` exit.

## Accessibility

- All interactive elements keyboard-reachable; visible focus ring.
- Color contrast WCAG AA (verify accent on glass panels in light mode — may
  need `--accent` darken to `#00a08c` against off-white).
- `prefers-reduced-motion` disables Framer transitions.
- Composer textarea: `aria-label="Prompt input"`. Send button: `aria-busy`
  while generating.

## File:component map (sprint deliverables)

```
src/app/layout.tsx                  shell, font, theme bootstrap
src/app/page.tsx                    routes ChatView
src/app/settings/page.tsx
src/app/about/page.tsx
src/components/AppShell.tsx
src/components/Sidebar.tsx
src/components/SplashScreen.tsx
src/components/SplashGate.tsx
src/components/ChatView.tsx
src/components/ChatHeader.tsx
src/components/MessageList.tsx
src/components/Bubble.tsx           handles pending/success/error states
src/components/Composer.tsx         textarea + attach + drop overlay
src/components/DropOverlay.tsx
src/components/ConfirmModal.tsx
src/lib/ipc.ts                      typed wrappers over @tauri-apps/api invoke
src/lib/db.ts                       chat/message CRUD via ipc
src/lib/theme.ts
src/lib/types.ts
src/lib/stores/chats.ts             Zustand
src/lib/stores/setup.ts
src/lib/stores/theme.ts
```
