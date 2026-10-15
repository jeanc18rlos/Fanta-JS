---
name: fanta-components
description: Create and reuse components and instances on the live Fanta canvas.
---

# Components in Fanta

Build and inspect the intended master first. Use `batch_design` with `create_component` to turn a supported node into a component and `create_instance` to place a linked copy. If similar copies already exist with the same layer structure, use `componentize` with the master ID first; it replaces the remaining copies with instances and preserves supported differences as overrides. Reuse returned IDs and verify with `batch_get` and `get_screenshot`.

Read `get_design_system` before creating a new master or token. Name standalone masters `Axis=Value` before `combine_variants` to create explicit variant axes. The result is one set frame and a `component_set` ID. Use `add_variants` for new named masters, `remove_variant` to take one out as a standalone component, `arrange_variants` to tidy the set, and `rename_component` for a component or set name. Do not rename a component by changing its folder or `def.json`/`set.json` manually: pages refer to component names. `batch_design` also supports `create_component_property`, `bind_component_property`, `set_instance_property`, variable collections and modes, variable bindings, `set_auto_layout`, `set_grid_layout`, and child sizing. The old standalone tool names `define_component_set`, `set_variables`, and `set_instance_override` are not MCP tools; these actions are operations inside `batch_design`.
