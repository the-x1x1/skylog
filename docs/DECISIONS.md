# Decision log

Short records of choices that shape the codebase. Newest last.

## D1 — Product name is a placeholder
The display name ("Skylog" today) is read from `PUBLIC_APP_NAME` in `.env` and exposed only through `src/config/brand.ts`. The IndexedDB database (`conversation-journal`), storage keys (`cj:*`), package name and export file names never use the brand, so a rename can't orphan anyone's data. `tests/unit/misc.test.ts` fails if the name appears anywhere in `src/`, `public/`, `server/`, `scripts/` or `index.html`.

## D2 — Toolchain: esbuild + TypeScript + node:test + Playwright (not Vite/Vitest)
The build environment had no access to the npm registry, so Vite, Vitest, Dexie, JSZip and zod couldn't be installed or verified. Rather than ship an untested Vite config, the project uses tools that were verified end to end:
- **esbuild** (bundler, `scripts/build.ts`, `scripts/dev.ts` with live reload),
- **TypeScript** (`tsc`, two projects: browser code and Node code),
- **node:test** via **tsx** for unit/integration tests, **fake-indexeddb** for storage,
- **Playwright** for browser tests,
- **ESLint** + **typescript-eslint** + **react-hooks**.

`src/` has no bundler-specific APIs (build constants come from `define`), so moving to Vite later is a config change, not a rewrite.

## D3 — Hand-written IndexedDB layer instead of Dexie
`src/data/db/idb.ts` (~250 lines) provides versioned migrations, promise-based transactions, and change notifications over `BroadcastChannel` (so a worker's writes update the UI live). It is small enough to own and is covered by schema/migration tests. The repository layer (`src/data/repositories`) is the only code that touches it.

## D4 — Hand-written ZIP reader instead of JSZip
`src/importers/core/zip.ts` reads the central directory and decompresses single entries on demand with the platform `DecompressionStream`, reading the archive through `Blob.slice`. Multi-gigabyte exports are never loaded whole; only `conversations.json` must fit in memory (limit 500 MB — the browser string-length ceiling — with a clear error). Supports stored/deflated entries, UTF-8 names and ZIP64.

## D5 — MiniSearch for local search, in a worker
Entries, image titles/prompts and every message are indexed in a Web Worker (`src/search/search.worker.ts`) that re-indexes only the conversations a change touched. Typos (edit distance 1–2 by word length) and prefixes match. Snippet text for message hits is loaded from IndexedDB rather than stored in the index, to halve memory on large journals.

## D6 — Source data and derived data are separate, and edits are a third layer
- Source: `conversations`, `messages`, `images`, `blobs` — written only by importers, never by summarization.
- Derived: `entries` — title, summary, decisions, lists, tags. Regenerating a summary overwrites only these fields.
- User edits: `edits` — merged over the derived entry at read time (`applyEdits`). A regeneration can't touch them; "Revert to generated" deletes them.

## D7 — Summaries go through a local server adapter or a local model
The browser never holds an API key. Options: Off (default), the **local server adapter** (`server/llm-adapter.ts`, keys in `.env.local`, used by `npm run dev` / `npm start`, protected by an origin check and a custom header), or **Ollama** on the same machine. Every reply is schema-validated (`src/summarization/validate.ts`); a malformed reply gets exactly one repair attempt; message references the model invents are dropped, not trusted.

## D8 — Hash routing
`#/entry/:id?image=…` / `?message=…` deep links work from any static host, the local server, or a single-file build, with no rewrite rules.

## D9 — Content Security Policy as a privacy guarantee
The served app may only connect to its own origin and to `localhost` (for Ollama). Even a bug can't send conversation data to a third-party host from the browser.

## D10 — Workers with a main-thread fallback
Import and search run in workers when possible. If workers can't start (strict embedding, `file://`, or the in-memory storage fallback in private windows), the same code runs on the main thread.

## D11 — "Tool" is an explicit role
Exports contain tool calls and tool output (image generation calls, code execution, web search). They are kept in the transcript with a `tool` role and the tool's name rather than hidden or merged into the assistant's text, so the transcript stays faithful.

## D12 — Image prompts are labelled by provenance
`promptKind` records where a prompt came from: `generation` (DALL·E metadata), `tool_call` (the arguments sent to the image tool) or `user_request` (the nearest user message, used only when nothing better exists). The UI labels each accordingly instead of calling everything "the prompt".

## D13 — Design handoff not available
The `skylog-handoff/` folder was not available during the build. The visual system follows the written direction in the build prompt (pale-blue editorial light theme, deep-blue dark theme, Fraunces / Manrope / JetBrains Mono). All colors and type live as CSS variables in `src/styles/tokens.css`; the handoff's `tokens.json` values can be mapped onto them without touching components. Fonts are bundled locally (OFL licenses in `src/assets/fonts/`) so nothing is fetched from a font CDN.

## D14 — The desktop program uses Node's single-executable format, not Electron
The Windows download is the local server in `server/` packed into a copy of `node.exe`, with the built app embedded as assets (Node's single executable applications feature, built by `scripts/build-exe.ts`). It opens the journal in the user's own browser. The executable runs the same server and page the tests cover, and the full Playwright suite passes against it. It adds one small dev dependency (`postject`) and no native toolchain. Electron or Tauri would add a bundled browser or a Rust toolchain for no gain users would notice today.
The port is fixed at 4173 because browser storage is per origin: a random port would open an empty journal on every launch. A second launch recognizes the running copy through `/api/app` and only opens the browser. Another program on the port gets a clear message instead of a silent switch. The executable isn't code-signed yet; signing needs a certificate, and the release workflow is where it would go.
