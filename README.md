# Fanta-JS

Fanta's JavaScript and WebAssembly packages, and its Claude Code plugin. The Rust engine they run lives in [fanta-edit](https://github.com/jeanc18rlos/fanta-edit), next to the desktop app that shares it. This repository builds the engine's WebAssembly module from the fanta-edit commit pinned in [`fanta-edit.rev`](fanta-edit.rev).

| Path | Contents |
|---|---|
| [`packages/runtime`](packages/runtime) | `fanta-runtime`: loads FNX/FSS projects and plays their prototypes and motion with the engine compiled to WebAssembly, in browsers (Skia over WebGL2) and Node.js. |
| [`packages/sdk`](packages/sdk) | `fanta-sdk`: clients for Fanta creative runs, proposals, native FNX authoring and knowledge. |
| [`plugin`](plugin), [`.claude-plugin`](.claude-plugin) | The Claude Code plugin and its marketplace. It connects Claude Code to the design open in the Fanta app through `fanta --mcp-stdio`, with a `/design` command and three skills. |
| [`scripts`](scripts) | Fetch the pinned engine and build the WebAssembly module. |
| [`fixtures/fonts`](fixtures/fonts) | Source Sans 3 and Source Serif 4 for tests and examples. |

## Build and test

Requirements: Node.js 22, pnpm 9.15, the Rust 1.95 toolchain, and an activated [Emscripten](https://emscripten.org) 6.0.12 SDK.

```sh
./scripts/fetch-engine
EMSDK=/path/to/emsdk ./scripts/build-wasm
(cd .engine/fanta-edit && cargo build -p fanta-runtime --example playback_fixture)
pnpm install
pnpm test
pnpm --filter fanta-runtime run test:browser
```

`fetch-engine` checks out the pinned fanta-edit commit in `.engine/fanta-edit`; `build-wasm` writes `packages/runtime/dist/fanta-runtime.mjs` and `fanta_runtime_wasm.wasm`. Set `FANTA_EDIT_DIR` to build from another fanta-edit checkout. The native `playback_fixture` lets the Node tests compare WASM and native playback exactly; set `FANTA_NATIVE_FIXTURE` to use a fixture built elsewhere.

To move to a newer engine, merge the change in fanta-edit, put its commit in `fanta-edit.rev`, and let CI rebuild and test.

Before publishing, run `node scripts/verify-packages.mjs` after building WebAssembly. It checks the public `0.1.1` package contents, including runtime binaries, website viewer assets, declarations, and the complete GPL license in each package. On Linux, browser validation uses `xvfb-run -a pnpm --filter fanta-runtime run test:browser` so Firefox has a display for WebGL.

## Claude Code plugin

```sh
claude plugin marketplace add jeanc18rlos/Fanta-JS
claude plugin install fanta@fanta
```

See [`plugin/README.md`](plugin/README.md) for what it configures.

## Licenses

`fanta-runtime` and `fanta-sdk` declare GPL-3.0-only ([LICENSE](LICENSE)), and the scripts come from fanta-edit under its GPL-3.0 license. The plugin is MIT, as its manifest declares. The fonts in `fixtures/fonts` are under the SIL Open Font License; each directory has its `OFL.txt`.
