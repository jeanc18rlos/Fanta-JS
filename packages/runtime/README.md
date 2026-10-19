# Fanta runtime

`fanta-runtime` loads FNX/FSS projects and plays their prototypes and motion through the Fanta Rust engine. Browser rendering uses Skia over WebGL2; Node.js supports compilation and manual state playback.

The WebAssembly module is built from the Rust engine in [fanta-edit](https://github.com/jeanc18rlos/fanta-edit) at the commit pinned in `fanta-edit.rev`. From the repository root, with the Rust 1.95 toolchain and an activated Emscripten 6.0.12 SDK:

```sh
./scripts/fetch-engine
EMSDK=/path/to/emsdk ./scripts/build-wasm
pnpm install
pnpm --filter fanta-runtime test
```

Set `FANTA_EDIT_DIR` to build from an existing fanta-edit checkout instead of the pinned one.

The build produces `dist/fanta-runtime.mjs` and `dist/fanta_runtime_wasm.wasm`. Include both when deploying. `createRuntime({moduleUrl, wasmUrl})` supports custom asset locations. Each call initializes an isolated Emscripten module. The build adapter reconciles Rust 1.95's exception flags with Skia 0.84's prebuilt JavaScript exception ABI. Source files are parsed in Rust; FNX imports are static resource references and source expressions are never executed as JavaScript.

```js
import {createRuntime} from "fanta-runtime";

const runtime = await createRuntime();
const program = await runtime.compileSource({files, fonts});
const player = await runtime.createPlayer({program, canvas});
player.startFlow(0);
player.on("link", ({url}) => showLink(url));
player.playClip(clipId, {mode: "repeat"});
```

`files` maps normalized project-relative paths to strings or byte arrays. Supply `fanta.json`, `doc/metadata.json`, page/component FNX and metadata, imported FSS, and any referenced variable, motion, and rendering resources. Every source node needs a persisted ID or authoritative identity sidecar. A canonical `doc.json` is also accepted. Generated class selectors use persisted `.s_<ULID>` identities.

Fonts are explicit `{family, weight, italic, faceIndex, bytes}` registrations. Defaults are weight 400, upright, and face index 0. Register every requested face, including motion and variable typography. Optional `fontSubstitutions` maps requested family names to registered faces. Browser playback never discovers system fonts or downloads missing fonts during layout. Each program owns its fonts and layout cache, so two programs can register different bytes under the same family name. The example supplies the repository's Source Sans font bytes.

`program.toBundle()` returns a deterministic runtime ZIP. Load the same bytes through `runtime.loadBundle(bytes)` without parsing sources. Bundles retain styles, variables, modes, reusable components, reactions, and motion; playback changes session state without editing the document.

Headless players default to a manual clock:

```js
const player = await runtime.createPlayer({program, width:320, height:180});
player.advanceBy(500);
console.log(player.getState());
console.log(player.inspect());
```

Browser players default to an automatic clock. Idle delayed interactions use timer deadlines without a permanent animation loop. Hidden pages pause elapsed playback. `pausePlayback()` freezes all clocks; `pauseClip()` pauses only the current property clip. `seekClip()` does not rewind navigation or prototype actions. New clip activations replace the previous clip; once completion holds its final sample and `stopClip()` clears it.

`playClip(clipId)` uses the clip's authored loop mode. Pass `{mode:"once"}`, `{mode:"repeat"}`, or `{mode:"pingPong"}` to override it for that activation.

Players default to `autoBind:true`: collections without an authored document mode receive their declared default mode in that player's session. Authored document modes and frame mode overrides retain their precedence. `autoBind:false` leaves the mode map as authored; the engine still resolves unpinned variables through their collection defaults. Each player owns its mode and variable changes, and `restart()` restores authored choices and automatic defaults.

Canvas players automatically follow element size and device pixel ratio changes. Call `player.resizeDrawingSurfaceToCanvas()` after a layout change to update immediately. It preserves playback state and an explicitly supplied `createPlayer` scale; headless players use `resize(width,height,scale)` instead.

For component-owned motion targets, pass an explicit `scope` occurrence from `player.getState().occurrences`. An occurrence contains its layer, authored node, instance placement path, and selected definition path. Definition paths distinguish the same authored descendant reached through different component expansions. Ambiguous targets fail instead of animating every placement. Reactions inside components infer scope from their source occurrence. Changing an expansion restarts its descendant timers and ends clips scoped to the removed expansion, while unchanged placed-instance timers continue.

For read-only viewing, pass `input: "none"` to `createPlayer`: the canvas still renders, resizes, and restores its graphics context, but pointer, keyboard, and wheel input never reach the prototype. Start a player on a page node to show every frame on that page. The host drives the camera with `panBy(deltaX, deltaY)`, `zoomAt(x, y, factor)`, and `fitView()`.

`createPlayer({program, canvas, fit:"contain"})` preserves the frame's aspect ratio and shows the complete frame. This is the default. `fit:"cover"` preserves the aspect ratio and fills the surface, cropping overflow; `fit:"fill"` fits each axis independently. `player.fitView("cover")` selects a policy and resets pan/zoom; `fitView()` refits the current policy. Navigation and restart retain that policy, while resize and graphics restoration preserve the session's playback and relative camera adjustment.

`getCamera()` returns the authoritative `{center:[x,y], scale:[xScale,yScale]}` in logical pixels per world unit. `getFitMode()` returns the current policy; both are also included as `camera` and `fitMode` in player state. The compatible `getViewport()` API returns `{center:[x,y], zoom}` with the smaller camera scale as `zoom`. Use `getCamera()` for fill geometry. Each player owns its camera and policy; fitting never changes the authored source or deployment bundle.

The package includes `site/viewer.js` and `site/viewer.css`, the read-only page viewer used by `fanta-site` (pan, zoom, fit and a page switcher over an inert player). Pass the installed `fanta-runtime` directory to `fanta-site --runtime`; the exporter assembles these files with the API, WebAssembly loader, and binary into a standalone website.

`program.inspect()` returns an authored document snapshot. `player.inspect()` returns resolved node occurrences, geometry, variables, and modes. These copies can be inspected without changing playback. Controls include navigation/back/restart, flow selection, variable/mode updates, clip controls, pointer/keyboard/scroll inputs, `cancelPointer()`, and resize. Colors in variable values use `{kind:"color",value:{r,g,b,a}}`, with channels from 0 to 255. Host navigation, link, completion, and error callbacks run after the state step.

Browser rendering requires WebGL2. Resize and context restoration keep playback state. Defaults bound decoded images and effects to 64 MiB each and presentation surfaces to 128 MiB. Source inputs and expanded deployment bundles have a separate 64 MiB ceiling to leave space for compilation and playback in the 512 MiB WASM heap. Allocation failures are reported instead of lowering image quality.

Video posters are supported. Live video/audio, Node image export, arbitrary source execution, and live authoring are outside this release. Unsupported or missing dependencies produce errors. Call `player.dispose()`, `program.dispose()`, or `runtime.dispose()` to release owned state and browser listeners. Disposing a program prevents new players; its existing players retain the shared program until they are disposed.

Reuse the existing canvas when replacing a player. `createPlayer()` waits for a disposed canvas's graphics context to restore before drawing. WebKit can count disposed contexts against its browser limit until garbage collection, so rapidly creating many different canvases can exhaust that limit even after their players are disposed.

Serve the repository root over HTTP and open `packages/runtime/examples/index.html` for the plain-browser example. `examples/react.jsx` demonstrates mounting and cleanup in React. The runtime API itself has no framework dependency.

Run `pnpm run test:browser` for Chromium, Firefox, and WebKit. Build the native fixture in the engine checkout (`cargo build -p fanta-runtime --example playback_fixture` in `.engine/fanta-edit`, or set `FANTA_NATIVE_FIXTURE`) before `pnpm test` to include exact native/WASM state, geometry, and event parity. CI requires this parity fixture. `pnpm run benchmark` records warm frame-work percentiles, readbacks, compressed module sizes, and separate initialization/compilation/player startup measurements in its JSON attachment. On the designated M2-class reference machine, run `FANTA_RUNTIME_REFERENCE_GATE=1 pnpm run benchmark` to use hardware graphics and require every phase's p95 to be at most 16.7 ms. Compatibility tests default to SwiftShader for headless Chromium; set `FANTA_RUNTIME_HARDWARE_GPU=1` to test hardware graphics. Reports identify the host CPU and active renderer.

On Linux, run browser validation with `xvfb-run -a pnpm run test:browser`: Firefox needs a display to create its WebGL context. Failed browser checks retain screenshots in `test-results`.
