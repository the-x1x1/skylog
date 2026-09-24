# Implementation plan

The product is built in vertical slices; each release keeps the app runnable and passes typecheck, lint, tests and build.

| Release | Scope | Where | Verified by |
| --- | --- | --- | --- |
| **0 — Foundation** | App shell, tokens, typography, light/dark/system theme, sidebar, responsive layout, mobile bottom nav, hash routes, sample journal | `src/app`, `src/components/layout`, `src/styles`, `src/fixtures` | e2e: theme persistence, mobile navigation, sample journal |
| **1 — Persistence & journal** | Versioned IndexedDB schema + migrations, repositories, journal home (month groups, sort, filters), entry page (gallery above summary, lightbox, transcript, jump links), edits, Markdown/JSON export | `src/data`, `src/components/journal`, `src/components/entry`, `src/export` | unit: schema, migrations, blobs, edits; e2e: gallery, lightbox, jump-to-message, edit persists after reload, export |
| **2 — Import** | ZIP reader, archive manifest, detection, ChatGPT and Claude parsers, image association, worker pipeline, preview/progress/cancel, dedupe + update, import reports, fixtures incl. malformed | `src/importers`, `src/components/import`, `fixtures/exports` | unit: parsers, detection, pipeline (progress, duplicates, partial failure, cancel, idempotency); e2e: import both sources, duplicate re-import, bad files |
| **3 — Summaries** | SummaryProvider interface, fallback state, LLM provider with validation/repair/chunking, local server adapter, Ollama client, per-entry regenerate, backfill, settings | `src/summarization`, `server`, `src/components/settings` | unit: validation, repair retry, chunk + merge, failure isolation, adapter; e2e: provider-off states |
| **4 — Search & hardening** | MiniSearch worker index, ⌘K/Ctrl+K, grouped results, filters, keyboard navigation, deep links to images/messages; README | `src/search`, `src/components/search`, `README.md` | unit: index, typos, filters, incremental updates; e2e: search → image/message routing, keyboard |

## Extension points left open (not built)
- **More import sources** — implement `ConversationImporter` and register it in `src/importers/registry.ts`.
- **Watched folder / desktop integration** — feed an `ArchiveManifest` into `runImport`; nothing else changes.
- **Topic splitting, linked pages, embeddings** — derived data lives on `JournalEntry`; add fields plus a migration.
- **Cloud sync / accounts** — deliberately absent. The repository layer is the seam if ever needed.
