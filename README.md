# Skylog *(working name)*

A private, local-first journal for your ChatGPT and Claude conversations. Drop in a data export and every conversation becomes a journal entry: its images up front, a short summary, key decisions and next steps linked to the exact messages that support them, and the full original transcript one click away.

Everything stays on your device. There is no account, no cloud copy and no telemetry.

> **The name is a placeholder.** It is set in one place — `PUBLIC_APP_NAME` in `.env` — and nothing else in the code spells it. See [Renaming](#renaming).

---

## Quick start

Requires **Node.js 20.19 or newer**.

```bash
npm install
npm run dev          # http://localhost:5173, rebuilds and reloads on save
```

For the production build:

```bash
npm run build        # outputs dist/
npm start            # serves dist/ at http://localhost:4173 (plus the optional summarizer API)
```

Then open the app and either **Import conversations** or choose **Use sample journal** to explore with bundled example data.

### Getting your export

| App | Where | What you get |
| --- | --- | --- |
| ChatGPT | Settings → Data controls → Export data | A `.zip` with `conversations.json`, `chat.html`, and your images |
| Claude | Settings → Privacy → Export data | A `.zip` with `conversations.json`, `users.json`, `projects.json` |

Drop the `.zip` onto the Import page. The source is detected automatically; you'll see a preview (conversation count, images, date range, warnings) before anything is saved.

---

## What an entry contains

In this order, so the images are never buried:

1. Source, date, message count and image count
2. Title, subtitle, tags and collection
3. **Image gallery** — large selected image, thumbnails, keyboard navigation, full-size view, the generation prompt (labelled by where it came from), “Jump to message N”, download, and an honest placeholder when the export didn't include the file
4. **Summary** — or “Summary not generated” when no summarizer is set up
5. **Key decisions** and **next steps**, each with `msg N` links to its sources
6. **Extracted lists** (e.g. parts and quantities) when the conversation clearly has them
7. **Highlights** — messages worth rereading
8. **Transcript** — collapsed by default, verbatim, in the original order, with its own find-in-conversation

Titles, subtitles, tags, collection and next steps can be edited. Edits are stored separately and always win, so regenerating a summary never overwrites them. Each entry exports as **Markdown** or **JSON**.

---

## Summaries (optional)

Importing, browsing and search work fully without any AI. When you want summaries, choose one in **Settings → Summaries**:

| Option | Where it runs | What leaves your device |
| --- | --- | --- |
| **Off** (default) | — | Nothing |
| **Local server** (Anthropic or OpenAI) | Your browser → this app's local Node server → the vendor | The text of the conversation you summarize, sent by your local server to the vendor you configured |
| **Ollama** | Entirely on your machine | Nothing |

### Local server setup

```bash
cp .env.example .env.local
# edit .env.local:
#   ANTHROPIC_API_KEY=sk-ant-...        (or OPENAI_API_KEY=... and LLM_VENDOR=openai)
npm run dev   # or: npm run build && npm start
```

The key is read by the Node server only (`server/llm-adapter.ts`); it is never bundled into browser code. The API accepts requests only from the app's own origin with the app's header.

### Ollama setup

Install [Ollama](https://ollama.com), pull a model (for example `ollama pull llama3.1:8b`), then pick **Ollama** in Settings and press **Test connection**. If the browser can't reach it, start Ollama with `OLLAMA_ORIGINS=http://localhost:5173,http://localhost:4173`.

### How summaries are made

- The transcript is sent with message references (`[m12]`); the model must cite them. References it invents are dropped.
- Every reply is validated against a schema. A malformed reply gets **one** repair attempt, then the entry is marked *Summary failed* — with the error shown and the transcript untouched.
- Long conversations are split into chunks, each summarized, then merged. Very long messages are trimmed (head and tail kept) to limit what's sent.
- The prompt tells the model to prefer omission over speculation and never invent parts, decisions or next steps.
- Summarize during import, per entry (**Generate / Regenerate summary**), or for all unsummarized entries at once in Settings.

---

## Search

Press **Ctrl K** (**⌘K** on Mac) from anywhere. Search covers titles, subtitles, summaries, tags, decisions, next steps, list items, image titles, image prompts and **every message**. Typos and partial words match. Results are grouped into Entries, Images and Messages, can be filtered by source, date range, tag and collection, and open exactly where the match is — an image result selects that image; a message result scrolls to and highlights that message. Use ↑/↓, Enter and Esc to move around.

---

## Privacy

- Exports are read in your browser. Nothing is uploaded.
- Conversations, images, summaries and edits are stored in this browser's IndexedDB on this device.
- No accounts, analytics or telemetry.
- The served app has a Content Security Policy that only allows connections to its own origin and `localhost`, so the browser can't send your data anywhere else — even by mistake.
- Conversation text leaves the device only if you pick the **Local server** summarizer and generate a summary.
- Fonts are bundled; nothing is fetched from font or script CDNs. After the first load the app works offline (summaries through a remote vendor excepted).
- If the browser blocks storage (some private windows), the app still works in memory and says clearly that nothing will be kept.

---

## Supported export formats

### ChatGPT (`conversations.json` with a `mapping` tree)

- **Order:** follows `current_node` up the parent chain (the branch you last saw, so edited-away branches are excluded). Without it, walks from the root along the newest child; if the tree is unusable, falls back to timestamps and notes that in the import report.
- **Content types:** `text`, `multimodal_text` (text, images, audio transcriptions), `code`, `execution_output`, `tether_quote`, `tether_browsing_display`, `system_error`, plain string content, and unknown types with `text`/`result` fields.
- **Hidden and skipped:** visually hidden system messages, custom-instruction context (`user_editable_context`, `model_editable_context`), and hidden reasoning (`thoughts`, `reasoning_recap`).
- **Tool calls** (e.g. image generation, Python) stay in the transcript as *Tool* messages.
- **Images:** `file-service://file-…` and `sediment://file_…` pointers are matched to files in the archive (including `dalle-generations/`). Prompts come from DALL·E metadata, else the image tool call's arguments, else the nearest user request — and are labelled accordingly. Uploads keep their original file name. A pointer without a file becomes a visible *Image not in export* placeholder, never a claimed import.
- **Attachments** (non-image files) are listed on their message.

### Claude (`conversations.json` with `chat_messages`)

- **Senders** `human`/`user` → you, `assistant`/`claude`/`model` → Claude, anything else → unknown.
- **Content:** structured `content` blocks (preferred) or the flat `text` field, or string content.
- **Tool use:** tool calls and results stay in the transcript. **SVG artifacts become gallery images**, and updates to an artifact become new versions (v2, v3…). Other artifacts (code, documents) stay in the transcript as fenced text.
- **Hidden reasoning** (`thinking` blocks) is skipped.
- **Uploaded images:** Claude exports list them by name only; they appear as placeholders explaining that the export doesn't include them. If a matching file *is* in the archive, it's used.

### Both

- Malformed records are skipped and listed in the import report (record number, id, title, reason); the rest of the batch continues.
- Duplicates are detected by source + conversation id and a content revision. Unchanged conversations are skipped (“Already imported”); changed ones are updated, your edits are kept, and an old summary is flagged as outdated.
- Re-importing is idempotent.
- Exports re-zipped inside a folder are handled.

Representative archives for every case live in `fixtures/exports/` (regenerate with `npm run fixtures`).

---

## Known limitations

- `conversations.json` is parsed whole in a worker; files over **500 MB** uncompressed are rejected with an explanation (browsers cap a single string at about 512 million characters). The archive itself is read lazily, so large image sets are fine.
- Claude exports don't include uploaded images; ChatGPT exports sometimes omit older images. Both show as placeholders.
- HEIC/HEIF images are stored but most browsers can't display them (a download is offered).
- Audio, video and canvas content are not imported beyond their transcripts or text.
- ChatGPT Projects, Claude Projects and memories are not imported as structure.
- There is no whole-journal backup/restore yet; each entry can be exported as Markdown or JSON, and the original export can always be re-imported.
- The search index lives in memory in a worker (built at startup, about 4 s per 2,000 conversations, then updated incrementally).

---

## Performance (measured)

On the synthetic 2,000-conversation export from `scripts/make-large-export.ts` (44 MB of JSON, 400 images), headless Chromium:

| | |
| --- | --- |
| Preview | ~1 s |
| Import | ~35–40 s in a worker; the page stays at 60 fps |
| Journal first render | ~120 ms (renders progressively) |
| Search | ~120–150 ms per query once the index is warm |

---

## Renaming

1. Change `PUBLIC_APP_NAME` in `.env`.
2. `npm run build`.

That's it. The database name (`conversation-journal`), storage keys (`cj:*`), package name and export file names don't use the product name, so existing journals keep working. A unit test fails if the name is hard-coded anywhere in the app.

---

## Development

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with live reload and the summarizer API |
| `npm run build` | Production build to `dist/` |
| `npm run build:single` | Everything inlined into one `dist-single/index.html` (works from `file://`) |
| `npm run build:demo` | Hosted demo fragment in `dist-demo/` (sample preloaded, downloads removed) |
| `npm start` | Serve `dist/` locally (with the summarizer API) |
| `npm run typecheck` | TypeScript, browser and Node projects |
| `npm run lint` | ESLint (typescript-eslint, React hooks), zero warnings |
| `npm test` | Unit and integration tests (`node:test` + fake-indexeddb) |
| `npm run test:e2e` | Playwright, desktop and mobile (first run: `npx playwright install chromium`) |
| `npm run check` | All of the above |
| `npm run fixtures` | Regenerate `fixtures/exports/*.zip` |

### Layout

```
src/
  app/            routing (hash), providers (theme, data), shell
  components/     layout · journal · entry · search · import · settings · shared
  data/           IndexedDB layer, migrations, repositories, domain types
  importers/      core (zip, archive, detection, pipeline, worker) · chatgpt · claude
  summarization/  provider interface, LLM provider, validation, prompts, clients, fallback
  search/         MiniSearch index, snippets, worker
  export/         Markdown and JSON entry export
  fixtures/       sample exports used by "Use sample journal" and tests
  styles/         design tokens and CSS
server/           local HTTP server and summarizer adapter (Node)
scripts/          build, dev, serve, fixture generators
tests/            unit/ (node:test) · e2e/ (Playwright) · helpers/
docs/             PLAN.md, DECISIONS.md, REVIEW.md (independent review findings and fixes)
```

### Adding an import source

Implement `ConversationImporter` (`src/importers/core/types.ts`) — `score`, `canHandle`, `inspect`, `iterate`, `parse` — and add it to `src/importers/registry.ts`. Detection, preview, the pipeline, deduplication, the report and the UI need no changes. The same seam works for a watched folder or an official API: produce an `ArchiveManifest` and call `runImport`.

### Tooling note

The recommended stack was Vite + Vitest + Dexie + JSZip. The environment this was built in couldn't reach the npm registry, so the project uses tools that could be verified end to end: esbuild, TypeScript, `node:test`, Playwright, and small hand-written IndexedDB and ZIP layers. `src/` doesn't depend on bundler-specific APIs, so switching to Vite is a configuration change. See `docs/DECISIONS.md`.

## License

Bundled fonts (Fraunces, Manrope, JetBrains Mono) are under the SIL Open Font License; see `src/assets/fonts/`.
