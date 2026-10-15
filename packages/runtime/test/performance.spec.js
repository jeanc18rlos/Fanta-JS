import {test, expect} from "@playwright/test";
import {readFile} from "node:fs/promises";
import {gzipSync} from "node:zlib";
import {arch,cpus,platform} from "node:os";

const TILE_COUNT = 1000;
const TRACK_COUNT = 100;
const STEP_MS = 1000 / 60;

test.use({viewport: {width: 1920, height: 1080}, deviceScaleFactor: 1});

function identity(value) {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let remaining = BigInt(value);
  let encoded = "";
  do {
    encoded = alphabet[Number(remaining % 32n)] + encoded;
    remaining /= 32n;
  } while (remaining > 0n);
  return encoded.padStart(26, "0");
}

function benchmarkSource() {
  const ids = Object.fromEntries(["page", "home", "destination", "overlay", "homeInstance", "destinationInstance", "overlayInstance", "component", "master", "clip"]
    .map((name, index) => [name, identity(index + 1)]));
  const style = identity(40);
  const tiles = Array.from({length: TILE_COUNT}, (_, index) =>
    `<Rect id="${identity(10000 + index)}" name="Tile ${index}" class="s_${style}" x={${12 + index % 50 * 38}} y={${12 + Math.floor(index / 50) * 52}} width={26} height={40} />`).join("\n");
  const tracks = Object.fromEntries(Array.from({length: TRACK_COUNT}, (_, index) => {
    const id = identity(20000 + index);
    const first = identity(30000 + index * 2);
    const second = identity(30001 + index * 2);
    return [id, {id, target: {node: identity(10000 + index), property: {kind: "bound", prop: {prop: "opacity"}}}, keyframes: {
      [first]: {id: first, time_ms: 0, value: {kind: "float", value: 0.3}, interpolation: "linear", easing: "linear"},
      [second]: {id: second, time_ms: 6000, value: {kind: "float", value: 1}, interpolation: "linear", easing: "linear"},
    }}];
  }));
  const reaction = (id, key, action, style, duration) => ({
    id: identity(id), trigger: {kind: "key", keys: [key]}, action,
    transition: {style, duration_ms: duration, easing: "linear"},
  });
  const homeReactions = [
    reaction(50, "o", {kind: "open_overlay", frame: ids.overlay, overlay: {position: {kind: "center"}, background_dim: true}}, {kind: "slide_in", direction: "up"}, 300),
    reaction(51, "n", {kind: "navigate", to: ids.destination}, {kind: "push", direction: "left"}, 1000),
  ];
  const overlayReactions = [reaction(52, "Escape", {kind: "close"}, {kind: "slide_out", direction: "down"}, 250)];
  return {ids, source: {files: {
    "fanta.json": JSON.stringify({format: "fanta-project", version: 6, schema_version: 4, project_id: `d_${identity(100)}`}),
    "doc/metadata.json": JSON.stringify({title: "Runtime reference benchmark", created_at: 0, modified_at: 0}),
    "doc/flow_start.json": JSON.stringify(ids.home),
    "doc/flows.json": JSON.stringify([{name: "Benchmark", start: ids.home}]),
    "doc/motion.json": JSON.stringify({clips: {[ids.clip]: {id: ids.clip, name: "100 simultaneous opacity tracks", duration_ms: 6000, tracks}}}),
    "pages/benchmark/page.json": JSON.stringify({id: ids.page, order: 0}),
    "styles/project.fss": `.s_${style} { fill: #4058EF; corner-radius: 3; }`,
    "components/tiles/def.json": JSON.stringify({id: ids.component, root: ids.master, name: "Tiles"}),
    "components/tiles/component.fnx": `import "../../styles/project.fss";
<Frame id="${ids.master}" name="Tiles" width={1920} height={1080}>${tiles}</Frame>`,
    "pages/benchmark/page.fnx": `<Frame id="${ids.page}" name="Benchmark">
  <Frame id="${ids.home}" name="Home" width={1920} height={1080} background={{"kind":"solid","color":fnxColor("#172033")}} reactions={${JSON.stringify(homeReactions)}}>
    <Instance id="${ids.homeInstance}" name="Home tiles" component="Tiles" width={1920} height={1080} />
  </Frame>
  <Frame id="${ids.destination}" name="Destination" x={2200} width={1920} height={1080} background={{"kind":"solid","color":fnxColor("#15362A")}}>
    <Instance id="${ids.destinationInstance}" name="Destination tiles" component="Tiles" width={1920} height={1080} />
  </Frame>
  <Frame id="${ids.overlay}" name="Overlay" x={4400} width={1920} height={1080} reactions={${JSON.stringify(overlayReactions)}}>
    <Instance id="${ids.overlayInstance}" name="Overlay tiles" component="Tiles" width={1920} height={1080} />
  </Frame>
</Frame>`,
  }}};
}

function percentile(values, fraction) {
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

test("report warm 1080p playback with 1000 tiles, 100 tracks, overlays and transitions", async ({page, browserName}, testInfo) => {
  test.skip(browserName !== "chromium", "The reference benchmark measures Chromium; browser compatibility has separate tests.");
  test.setTimeout(120000);
  const failures = [];
  page.on("pageerror", error => failures.push(error.message));
  const binaries = await Promise.all(["fanta-runtime.mjs", "fanta_runtime_wasm.wasm"].map(async name => {
    const bytes = await readFile(new URL(`../dist/${name}`, import.meta.url));
    return {name, bytes: bytes.length, gzipBytes: gzipSync(bytes, {level: 9}).length};
  }));
  const fixture = benchmarkSource();
  expect(Object.keys(JSON.parse(fixture.source.files["doc/motion.json"]).clips[fixture.ids.clip].tracks)).toHaveLength(TRACK_COUNT);
  expect((fixture.source.files["components/tiles/component.fnx"].match(/<Rect /g) ?? []).length).toBe(TILE_COUNT);
  await page.goto("/packages/runtime/examples/blank.html");
  const result = await page.evaluate(async ({source, ids, stepMs}) => {
    const imported = performance.now();
    const {createRuntime} = await import("/packages/runtime/src/index.js");
    const moduleStarted = performance.now();
    const runtime = await createRuntime();
    const moduleFinished = performance.now();
    try {
      const program = await runtime.compileSource(source);
      const compiled = performance.now();
      const canvas = document.createElement("canvas");
      canvas.id = "benchmark";
      canvas.style = "display:block;width:1920px;height:1080px;touch-action:none";
      document.body.style.margin = "0";
      document.body.append(canvas);
      const player = await runtime.createPlayer({program, canvas, width: 1920, height: 1080, scale: 1, clock: "manual"});
      const created = performance.now();
      const errors = [];
      player.on("error", error => errors.push(error.message ?? JSON.stringify(error)));
      const startClip = instance => {
        const state = player.getState();
        const scope = state.occurrences.find(occurrence => occurrence.node === instance && occurrence.instancePath.length === 0);
        if (!scope) throw new Error(`Missing benchmark instance occurrence ${instance}`);
        player.playClip(ids.clip, {scope, mode: "repeat"});
      };
      const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
      const sample = async count => {
        const samples = [];
        for (let index = 0; index < count; index++) {
          await nextFrame();
          const started = performance.now();
          player.advanceBy(stepMs);
          const elapsedMs = performance.now() - started;
          const state = player.getState();
          samples.push({elapsedMs, drawMs: state.metrics.frameMicros / 1000, layers: state.metrics.renderedLayers,
            readbacks: state.metrics.wholeFrameReadbacks, running: state.clip?.running ?? false});
        }
        return samples;
      };
      startClip(ids.homeInstance);
      await sample(30);
      const motion = await sample(60);
      player.sendKey("o");
      if (player.getState().overlayFrames[0] !== ids.overlay) throw new Error("Benchmark overlay did not open");
      startClip(ids.overlayInstance);
      await sample(30);
      const overlay = await sample(60);
      player.sendKey("Escape");
      player.sendKey("n");
      if (player.getState().currentFrame !== ids.destination) throw new Error("Benchmark navigation did not start");
      startClip(ids.destinationInstance);
      const transition = await sample(40);
      const context = canvas.getContext("webgl2");
      const debug = context.getExtension("WEBGL_debug_renderer_info");
      return {phases: {motion, overlay, transition}, errors,
        startup: {javascriptImportMs: moduleStarted - imported, wasmInitializationMs: moduleFinished - moduleStarted,
          sourceCompilationMs: compiled - moduleFinished, playerInitializationMs: created - compiled},
        environment: {userAgent: navigator.userAgent, renderer: debug ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER),
          logicalWidth: player.options.width, logicalHeight: player.options.height, physicalWidth: canvas.width, physicalHeight: canvas.height}};
    } finally {runtime.dispose();}
  }, {source: fixture.source, ids: fixture.ids, stepMs: STEP_MS});
  expect(result.environment.physicalWidth).toBe(1920);
  expect(result.environment.physicalHeight).toBe(1080);
  expect(result.errors).toEqual([]);
  expect(failures).toEqual([]);
  const phases = Object.fromEntries(Object.entries(result.phases).map(([name, samples]) => {
    expect(samples.every(sample => Number.isFinite(sample.elapsedMs) && Number.isFinite(sample.drawMs))).toBe(true);
    expect(samples.every(sample => sample.readbacks === 0 && sample.running)).toBe(true);
    expect(samples.every(sample => sample.layers === (name === "motion" ? 1 : 2))).toBe(true);
    return [name, {samples: samples.length, p50FrameWorkMs: percentile(samples.map(sample => sample.elapsedMs), 0.5),
      p95FrameWorkMs: percentile(samples.map(sample => sample.elapsedMs), 0.95),
      p95DrawMs: percentile(samples.map(sample => sample.drawMs), 0.95), wholeFrameReadbacks: 0}];
  }));
  const report = {fixture: {tileNodes: TILE_COUNT, activeTracks: TRACK_COUNT, width: 1920, height: 1080},
    host: {platform:platform(),architecture:arch(),cpu:cpus()[0]?.model??"unavailable"},
    environment: result.environment, referenceGateEnabled: process.env.FANTA_RUNTIME_REFERENCE_GATE === "1",
    phases, startup: result.startup, binaries,
    timing: "Frame work includes synchronous JavaScript, Rust evaluation, drawing and GPU submission; requestAnimationFrame waiting and state inspection are excluded."};
  await testInfo.attach("runtime-benchmark.json", {body: JSON.stringify(report, null, 2), contentType: "application/json"});
  console.log("Fanta runtime benchmark", JSON.stringify(report));
  if (report.referenceGateEnabled) {
    for (const phase of Object.values(phases)) expect(phase.p95FrameWorkMs).toBeLessThanOrEqual(16.7);
  }
});
