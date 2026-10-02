// Ambient declarations for the one legitimately dynamic surface in the app.
//
// The rendered HTML uses inline onclick="fn()" handlers, so src/main.ts
// copies every function those handlers call onto `window` with a single
// Object.assign, plus live `db`/`me` getters (tests read window.db /
// window.state too). A few modules also park scratch values there
// (window._tLogo while a team logo is being picked).
//
// That set is open-ended by design, so Window gets an index signature
// rather than ~300 individually declared properties: `window.anything`
// type-checks as `any`. Real DOM members (window.scrollTo, innerWidth, ...)
// keep their precise lib.dom types — the index signature only applies to
// names lib.dom doesn't declare.
//
// `import.meta.env` is typed by "vite/client" (tsconfig "types").
export {};

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }
}
