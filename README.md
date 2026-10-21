# Fanta-JS

Fanta's JavaScript and WebAssembly packages, and its Claude Code plugin. The Rust engine they run lives in [fanta-edit](https://github.com/jeanc18rlos/fanta-edit), next to the desktop app that shares it. This repository builds the engine's WebAssembly module from the fanta-edit commit pinned in [`fanta-edit.rev`](fanta-edit.rev).

| Path | Contents |
|---|---|
| [`packages/runtime`](packages/runtime) | `fanta-runtime`: plays compiled Fanta bundles (prototypes and motion) with the engine compiled to WebAssembly, in browsers (Skia over WebGL2) and Node.js. Projects are compiled to bundles by `fanta-compile` in fanta-edit; the module has no source parser. |
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

`fetch-engine` checks out the pinned fanta-edit commit in `.engine/fanta-edit`; `build-wasm` writes `packages/runtime/dist/fanta-runtime.mjs` and `fanta_runtime_wasm.wasm`. Set `FANTA_EDIT_DIR` to build from another fanta-edit checkout.

`build-wasm` builds with the engine's size-first `release-runtime` profile and asks emcc for Binaryen's `-Oz` at link time. Four variables change that, for measurements: `FANTA_RUNTIME_PROFILE` (a Cargo profile, for example `release`), `FANTA_WASM_OPT` (`-Oz`, `-Os`, `-O3`, or `none`), `FANTA_WASM_LINK_ARGS` (extra emcc link arguments, for example `--closure=1 -sMALLOC=emmalloc`) and `SKIA_GN_ARGS` (extra Skia GN arguments; CI otherwise takes upstream's prebuilt Skia, so a non-empty value forces a Skia source build). Running the CI workflow by hand measures one configuration: it builds, logs the sizes in the job summary, tests, and keeps `packages/runtime/dist` as an artifact for a local benchmark.

```sh
gh workflow run ci.yml --ref <branch> -f profile=release-runtime -f wasm_opt=-Oz -f link_args="--closure=1" -f label=closure
``` The native `playback_fixture` compiles every test source to a bundle and lets the tests compare WASM and native playback exactly; without it the integration and browser tests are skipped. Set `FANTA_NATIVE_FIXTURE` to use a fixture built elsewhere. Projects are compiled for the runtime with `cargo run -p fanta-site --bin fanta-compile -- <project> program.fanta --offline` in the engine checkout.

To move to a newer engine, merge the change in fanta-edit, put its commit in `fanta-edit.rev`, and let CI rebuild and test.

`node scripts/report-module-sizes.mjs` prints the built module's raw, gzip and brotli sizes; CI logs them on every build. Before publishing, run `node scripts/verify-packages.mjs` after building WebAssembly. It checks the public `0.2.0` package contents, including runtime binaries, website viewer assets, declarations, and the complete GPL license in each package. On Linux, browser validation uses `xvfb-run -a pnpm --filter fanta-runtime run test:browser` so Firefox has a display for WebGL.

## Claude Code plugin

```sh
claude plugin marketplace add jeanc18rlos/Fanta-JS
claude plugin install fanta@fanta
```

See [`plugin/README.md`](plugin/README.md) for what it configures.

## Licenses

`fanta-runtime` and `fanta-sdk` declare GPL-3.0-only ([LICENSE](LICENSE)), and the scripts come from fanta-edit under its GPL-3.0 license. The plugin is MIT, as its manifest declares. The fonts in `fixtures/fonts` are under the SIL Open Font License; each directory has its `OFL.txt`.
