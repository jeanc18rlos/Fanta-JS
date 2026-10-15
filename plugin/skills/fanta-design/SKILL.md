---
name: fanta-design
description: Edit the design open in Fanta using its local MCP tools.
---

# Design on the Fanta canvas

1. Call `get_editor_state`, `get_guidelines`, and `get_design_system` to understand the active page, project brief, components, variables, and canvas conventions.
2. Inspect relevant nodes with `batch_get`; page wide results with `offset` and `limit`. Exact IDs default to `detail: "style"`, which reports editable fills, strokes, effects, layout, constraints, and text. A page listing defaults to `summary`; ask for `style` only where needed.
3. Apply a small `batch_design` call for one visible component or screen section using its `ops` array. Operations appear on canvas one by one, while the batch commits as one undoable transaction or rolls back if an operation fails. Reuse a stable `agent_id` and `agent_name` from `report_agent_activity` in `batch_design.activity` so Fanta can follow the edit. Operations include vector shapes, full fill and effect stacks, constraints, grid layout, componentizing similar copies, variant-set maintenance, and the existing canvas operations.
4. Capture returned IDs before editing new nodes. Put children under their actual parent; overlap alone does not create nesting.
5. Use `get_screenshot` to verify the result. `read_fnx_source` can inspect bounded source slices and `validate_fnx_source` can check a complete FNX or managed project JSON candidate before a file edit. Preserve existing IDs when editing identity sidecars or component metadata. Fanta autosaves; there is no `save_document` tool. After structural changes, check the save status and FNX diff: a visible canvas edit can still be refused at persistence time if it would lose authored source-only data.

`batch_design` also supports variable collections, modes, bindings, component variants, properties, and instance values. Use `prepare_design_asset` only to open a generation draft for the user's review; it does not submit a generation request.

When the local MCP operations cannot express a change, use the app's inspector or project source where appropriate. Report the actual `source_path` and `workspace` (`canvas`, `variables`, or `code`) as you switch files, then clear activity with `active: false` when finished. Do not invent tools from older docs.
