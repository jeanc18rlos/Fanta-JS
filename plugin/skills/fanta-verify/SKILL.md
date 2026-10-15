---
name: fanta-verify
description: Check a Fanta design with the current canvas, screenshot, source files, and Git diff.
---

# Verify a Fanta design

1. Use `get_editor_state` to confirm the active page and selection.
2. Use `batch_get` to check names, nesting, sizes, and properties. Exact IDs default to editable `style` detail; page listings default to `summary`. Request `detail: "raw"` only for an exact node ID when the internal record is needed. For large pages, use `offset` and `limit`.
3. Use `get_screenshot` to inspect the rendered design. Start with the default size to keep the response manageable.
4. Use `read_fnx_source` for bounded source excerpts. Use `validate_fnx_source` for a complete FNX or managed project JSON candidate before writing it, and inspect the Git diff after autosave when available. Check for a save error after structural edits: a canvas batch can succeed while persistence refuses to lose authored FNX data. For identity sidecars, preserve existing IDs; JSON syntax alone is not a complete project check.
5. Use `list_comments` to check unresolved review threads and `reply_comment` only after addressing the specific note.
6. Export a shareable PNG, JPEG, SVG, or PDF through the app's inspector.

The local server does not expose `review_design`, `compare_screenshot`, `export_png`, or `save_document`.
