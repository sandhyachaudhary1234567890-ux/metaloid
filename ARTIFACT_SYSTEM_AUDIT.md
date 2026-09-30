# Artifact System Audit — 2026-09-22

## Root cause fixed

The former PPTX writer emitted a ZIP with slides and `ppt/presentation.xml`, but it omitted the slide-master/layout/theme relationship graph and per-slide layout relationship parts. It also generated invalid DrawingML by closing `p:txBody` with `a:txBody`. ZIP inspection could succeed while PowerPoint repaired or refused the file.

The canonical server-side writer is now [pptx.js](C:\metaloid\server\src\core\pptx.js). It emits the required package graph and validates the directory, required parts, XML balance, slide count, slide content, per-slide layouts, and every internal relationship target before an artifact can be finalized.

## Canonical lifecycle

`createArtifact` → write bounded bytes → `validateArtifact` → reopen package parts → optional LibreOffice render → XML/layout QA → bounded PPTX repair → revalidate → `finalizeArtifact`.

The API pipeline records terminal `FAILED` state if validation, QA, repair, or finalization fails. It cannot finalize a version lacking passing verification.

## Supported production writers

| Format | State | Verification |
| --- | --- | --- |
| PPTX | Supported | ZIP central directory, required PresentationML parts, relationship targets, XML balance, reopened slide XML, content/layout checks |
| DOCX | Supported | ZIP central directory, required WordprocessingML parts, numbering relationship, XML balance, reopened `word/document.xml` |
| Markdown / TXT | Supported | UTF-8 and nonempty checks |
| XLSX / PDF / CSV / JSON / XML / HTML / RTF / images | Not exposed as supported artifact writers | No writer is registered, so the resolver returns an honest unavailable capability rather than a fabricated file |

## Rendering

LibreOffice headless rendering is used only when installed. This host has no `soffice` executable, so visual rendering is reported as unavailable; it is never claimed as completed. Structural reopen verification remains mandatory.

## Security

- User ownership is checked for every artifact operation.
- Artifact bytes are stored behind generated IDs, not caller-controlled paths.
- Filenames are sanitized; generated files have a 10 MB cap.
- Render subprocesses use `execFile`, a timeout, temporary directories, and no shell.
- Delivery is blocked on current-version validation; failed artifacts are not final deliverables.
