# Fanta plugin for Claude Code

This optional plugin connects Claude Code to the design open in the Fanta desktop app. It configures Fanta's `--mcp-stdio` bridge, provides a `/design` command, and bundles three workflow skills.

Install Fanta at `/Applications/Fanta.app`, launch it, and open a design project. Then run:

```bash
claude plugin marketplace add jeanc18rlos/Fanta-JS
claude plugin install fanta@fanta
```

The plugin uses `/Applications/Fanta.app/Contents/MacOS/fanta --mcp-stdio`. For another install path or Fanta user-data directory, copy the connection command from the running app and configure the MCP command manually. The current server has 13 tools and 43 canvas operations, including grid layout, fill and effect stacks, vector shapes, and component and variant-set workflows. Canvas edits appear one operation at a time while each batch remains a single undo step. Fanta autosaves.

```text
/design Add a 320×180 card with a heading and primary button to the current page.
```

See the [Fanta documentation](https://github.com/jeanc18rlos/fanta-docs) for setup and limits.
