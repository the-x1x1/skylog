# Independent review — findings and fixes

An independent review of the codebase (by a reviewer who hadn't written it) found 13 defects. All are fixed, and each has a regression test in `tests/unit/review-regressions.test.ts` (unit) or `tests/e2e/background-import.spec.ts` (browser).

| # | Severity | Finding | Fix |
| --- | --- | --- | --- |
| 1 | High | Leaving the Import page terminated the import worker. Entries could stay "summarizing" forever; batches stayed "Running". | The import session is owned app-wide (`src/app/providers/import.tsx`), with a progress indicator in the sidebar and mobile nav and a leave-page warning. Entries become `pending` only while their summary actually runs. Web Locks mark live work, and `src/data/recovery.ts` settles interrupted imports and summaries at startup. |
| 2 | High | Re-import wiped a generated summary unless its status was exactly `complete` (e.g. after a failed regeneration). | Derived fields are kept whenever a summary was ever generated. A cancelled summary restores the exact previous status. |
| 3 | High | An older export overwrote a newer conversation, deleting messages and images. | The last activity (last message, else update time) and message count are compared. Older copies are skipped and noted in the report. |
| 4 | High | Re-importing with images off deleted stored images. Images were never filled in later. | Existing blobs are carried over when an import can't supply them. An export that can supply missing images updates the entry even when unchanged. |
| 5 | Medium | Saving any edit froze tags, next steps and collection, hiding later summaries. | The dialog sends only fields the user changed, and the repository drops edits equal to generated values. |
| 6 | Medium | The local summarizer API was open to DNS rebinding. | The Host (and Origin, when present) must be a loopback name on this port. |
| 7 | Medium | One failed search-index update stalled all later updates. | The update chain recovers from errors and falls back to a full rebuild. |
| 8 | Medium | `$` sequences in Claude artifact updates were treated as replacement patterns. | The replacement is done with a function, so text is inserted literally. |
| 9 | Medium | Claude `extracted_content` (pasted text, document text) was dropped. | It's kept on the attachment, shown in the transcript, included in exports and summaries, and searchable. |
| 10 | Low | Only the first 20,000 characters of a message were searchable. | Long messages are indexed in overlapping slices. |
| 11 | Low | The 768 MB JSON limit exceeded the browser's maximum string length. | The limit is now 500 MB, with a clear message. |
| 12 | Low | Search date filters compared UTC days with local days. | Filters compare local calendar days. |
| 13 | Low | Unchanged re-imports were reported as "Updated" and reset the import date. | They count as "Already imported" and keep their original import date. |

The review also confirmed these as sound:
- Transactions never await non-IndexedDB work.
- Deletes and re-imports leave no orphaned blobs.
- The ZIP reader handles ZIP64, data descriptors and differing local header lengths (tested against Python `zipfile` and Info-ZIP streaming output).
- Static serving blocks path traversal.
- API keys never reach the browser.
- There is no `dangerouslySetInnerHTML`; SVGs render only through `<img>`.
