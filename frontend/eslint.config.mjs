// Minimal flat config. The Next build pipeline runs TypeScript checking, so
// this file exists only as a lightweight stylistic guard. Avoid pulling
// `next/typescript` here — it triggers a circular-reference crash on
// ESLint 9 + Next 16 at the time of writing.

export default [
  {
    ignores: ["out/**", ".next/**", "src-tauri/**", "node_modules/**"],
  },
];
