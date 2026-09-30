# Intent and Capability Resolution — 2026-09-22

The canonical gateway resolver is [intentCapabilityResolver.js](C:\metaloid\server\src\core\intentCapabilityResolver.js). It separates outcome recognition from execution and returns a structured capability decision:

`input → deliverable signals → capability → inferred format → supported writer check → execution plan`

It supports natural English and common Hinglish presentation/document phrasing, honours explicit format requests, extracts slide/page counts and topics, and routes only PPTX/DOCX requests to verified writers. Spreadsheet and PDF requests are understood but explicitly returned as unavailable until a verified adapter exists.

The chat client uses an intentionally broad local trigger only to enter the artifact flow; the server resolver remains the execution authority. This keeps file-format jargon out of the normal user experience while preventing the frontend from inventing support.

Benchmark coverage is in [intent-artifact-matrix.mjs](C:\metaloid\server\tests\intent-artifact-matrix.mjs), including presentation/report wording, Hinglish variants, explicit unavailable XLSX, and real afforestation PPTX/DOCX validation.
