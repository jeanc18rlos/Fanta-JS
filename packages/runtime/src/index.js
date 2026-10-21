const encoder = new TextEncoder();
const decoder = new TextDecoder();
const canvasOwners = new WeakMap();
const releasedCanvasContexts = new WeakMap();
const expandedInputLimit = 64 * 1024 * 1024;

export class RuntimeError extends Error {
  constructor(message, code = "RuntimeError") {
    super(message);
    this.name = "RuntimeError";
    this.code = code;
  }
}

function bytes(value) {
  if (typeof value === "string") return encoder.encode(value);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError("Resource must be a string, Uint8Array, or ArrayBuffer");
}

function positive(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${name} must be finite and positive`);
  return value;
}

function fitMode(value) {
  if (!["contain", "cover", "fill"].includes(value)) throw new TypeError("fit must be contain, cover, or fill");
  return value;
}

function backingSize(width, height, scale) {
  const physicalWidth = Math.max(1, Math.round(positive(width, "width") * positive(scale, "scale")));
  const physicalHeight = Math.max(1, Math.round(positive(height, "height") * scale));
  if (!Number.isSafeInteger(physicalWidth) || !Number.isSafeInteger(physicalHeight) || physicalWidth > 2147483647 || physicalHeight > 2147483647 || physicalWidth * physicalHeight * 12 > 128 * 1024 * 1024) {
    throw new RuntimeError("Presentation exceeds the 128 MiB surface budget", "ResourceLimit");
  }
  return [physicalWidth, physicalHeight];
}

function releaseCanvasContext(canvas, context, extension, lossEventReceived = false) {
  if (!context || !extension || releasedCanvasContexts.has(canvas)) return;
  const alreadyLost = context.isContextLost();
  let released;
  const release = { context, extension, restore: !alreadyLost, released: new Promise(resolve => { released = resolve; }) };
  const lost = event => {
    event.preventDefault();
    canvas.removeEventListener("webglcontextlost", lost);
    // Restoration is invalid until the cancelled loss event has finished dispatching.
    setTimeout(released, 0);
  };
  releasedCanvasContexts.set(canvas, release);
  if (alreadyLost && lossEventReceived) setTimeout(released, 0);
  else canvas.addEventListener("webglcontextlost", lost, { once: true });
  if (!alreadyLost) extension.loseContext();
}

async function restoreReleasedCanvas(canvas, release) {
  let timeout, restored;
  const deadline = new Promise((resolve, reject) => {
    timeout = setTimeout(() => reject(new RuntimeError("WebGL context restoration timed out", "GraphicsRestoreFailed")), 10000);
  });
  try {
    await Promise.race([release.released, deadline]);
    if (release.context.isContextLost()) {
      const restoration = new Promise(resolve => {
        restored = resolve;
        canvas.addEventListener("webglcontextrestored", restored, { once: true });
      });
      if (release.restore) release.extension.restoreContext();
      await Promise.race([restoration, deadline]);
    }
    if (release.context.isContextLost()) throw new RuntimeError("WebGL context could not be restored", "GraphicsRestoreFailed");
    if (releasedCanvasContexts.get(canvas) === release) releasedCanvasContexts.delete(canvas);
  } finally {
    clearTimeout(timeout);
    if (restored) canvas.removeEventListener("webglcontextrestored", restored);
  }
}

class Transport {
  constructor(module) { this.module = module; }
  allocate(value) {
    const data = bytes(value);
    const pointer = this.module._fanta_alloc(data.length);
    if (!pointer) throw new RuntimeError("WASM buffer allocation failed", "ResourceLimit");
    this.module.HEAPU8.set(data, pointer);
    return pointer;
  }
  copy(pointer) {
    const length = this.module._fanta_buffer_len(pointer);
    return this.module.HEAPU8.slice(pointer, pointer + length);
  }
  request(value) {
    const input = this.allocate(JSON.stringify(value));
    let output;
    try {
      output = this.module._fanta_request(input);
      if (!output) throw new RuntimeError("WASM returned no response", "ResourceLimit");
      const response = JSON.parse(decoder.decode(this.copy(output)));
      if (!response.ok) throw new RuntimeError(response.error.message, response.error.code);
      return response.value;
    } finally {
      this.module._fanta_free(input);
      if (output) this.module._fanta_free(output);
    }
  }
  binary(operation, input) {
    const data = bytes(input);
    if (data.length > expandedInputLimit) throw new RuntimeError("Bundle exceeds the 64 MiB input budget", "ResourceLimit");
    let pointer;
    try {
      pointer = this.allocate(data);
      return this.request({ operation, bytes: pointer });
    } finally { if (pointer) this.module._fanta_free(pointer); }
  }
}

export async function createRuntime(options = {}) {
  let factory = options.moduleFactory;
  if (!factory) {
    const url = new URL(options.moduleUrl ?? "../dist/fanta-runtime.mjs", import.meta.url);
    try { factory = (await import(String(url))).default; }
    catch (cause) { throw new RuntimeError(`Could not load Fanta WASM module. Build the runtime package or supply moduleUrl. ${cause.message}`, "ModuleLoadError"); }
  }
  const module = await factory({
    ...(options.moduleOptions ?? {}),
    ...(options.wasmUrl ? { locateFile: path => String(new URL(path.endsWith(".wasm") ? options.wasmUrl : path, new URL(options.moduleUrl ?? "../dist/fanta-runtime.mjs", import.meta.url))) } : {}),
  });
  for (const name of ["_fanta_alloc", "_fanta_buffer_len", "_fanta_free", "_fanta_request"]) {
    if (typeof module[name] !== "function") throw new RuntimeError(`Missing WASM export ${name}`, "InvalidModule");
  }
  return new Runtime(new Transport(module));
}

class Runtime {
  constructor(transport) { this.transport = transport; this.programs = new Set(); this.players = new Set(); this.disposed = false; }
  assertAlive() { if (this.disposed) throw new RuntimeError("Runtime was disposed", "Disposed"); }
  async loadBundle(data) {
    this.assertAlive();
    const program = new Program(this, this.transport.binary("loadBundle", data));
    this.programs.add(program);
    return program;
  }
  async createPlayer(options) {
    this.assertAlive();
    const program = options?.program;
    if (!(program instanceof Program) || program.runtime !== this) throw new TypeError("Program must belong to this runtime");
    program.assertAlive();
    const canvas = options.canvas;
    if (canvas && canvasOwners.has(canvas)) throw new RuntimeError("Canvas already belongs to a player", "CanvasInUse");
    const width = positive(options.width ?? canvas?.clientWidth ?? 800, "width");
    const height = positive(options.height ?? canvas?.clientHeight ?? 600, "height");
    const scale = positive(options.scale ?? (canvas ? globalThis.devicePixelRatio ?? 1 : 1), "scale");
    const clock = options.clock ?? (canvas ? "auto" : "manual");
    const input = options.input ?? "prototype";
    const autoBind = options.autoBind ?? true;
    const fit = fitMode(options.fit === undefined ? "contain" : options.fit);
    if (canvas) backingSize(width, height, scale);
    if (!['auto', 'manual'].includes(clock)) throw new TypeError("clock must be auto or manual");
    if (!["prototype", "none"].includes(input)) throw new TypeError("input must be prototype or none");
    if (typeof autoBind !== "boolean") throw new TypeError("autoBind must be a boolean");
    if (clock === "auto" && typeof globalThis.requestAnimationFrame !== "function") throw new TypeError("Automatic playback requires a browser animation clock");
    const reservation = {};
    if (canvas) canvasOwners.set(canvas, reservation);
    let recovered;
    try {
      const release = canvas && releasedCanvasContexts.get(canvas);
      if (release) {
        await restoreReleasedCanvas(canvas, release);
        recovered = release.context;
      }
      this.assertAlive(); program.assertAlive();
      const { handle } = this.transport.request({ operation: "createPlayer", program: program.handle, width, height, start: options.start ?? null, fit });
      const player = new Player(this, handle, { ...options, width, height, scale, clock, input, autoBind, fit, automaticScale: options.scale === undefined });
      try { player.initialize(); } catch (error) { player.dispose(); throw error; }
      this.players.add(player);
      return player;
    } catch (error) {
      if (recovered && canvasOwners.get(canvas) === reservation) releaseCanvasContext(canvas, recovered, recovered.getExtension("WEBGL_lose_context"));
      throw error;
    } finally {
      if (canvas && canvasOwners.get(canvas) === reservation) canvasOwners.delete(canvas);
    }
  }
  dispose() {
    if (this.disposed) return;
    for (const player of [...this.players]) player.dispose();
    for (const program of [...this.programs]) program.dispose();
    this.disposed = true;
    this.transport = null;
  }
}

class Program {
  constructor(runtime, info) { this.runtime = runtime; this.handle = info.handle; this.info = structuredClone(info); this.disposed = false; }
  assertAlive() { this.runtime.assertAlive(); if (this.disposed) throw new RuntimeError("Program was disposed", "Disposed"); }
  get flows() { return structuredClone(this.info.flows); }
  get clips() { return structuredClone(this.info.clips); }
  get diagnostics() { return structuredClone(this.info.diagnostics); }
  get capabilities() { return structuredClone(this.info.capabilities); }
  inspect() {
    this.assertAlive();
    return this.runtime.transport.request({ operation: "inspectProgram", program: this.handle });
  }
  dispose() {
    if (this.disposed) return;
    this.runtime.transport.request({ operation: "disposeProgram", program: this.handle });
    this.runtime.programs.delete(this); this.disposed = true;
  }
}

class Player {
  constructor(runtime, handle, options) {
    this.runtime = runtime; this.handle = handle; this.options = options; this.disposed = false;
    this.listeners = new Map(); this.cleanup = []; this.state = null; this.schedule = null;
    this.dirty = true; this.lastTime = null; this.animationFrame = null; this.timeout = null;
    this.hidden = false; this.contextLost = false; this.graphics = null; this.renderMetrics = { wholeFrameReadbacks: 0 };
    this.webglContext = null; this.contextLossExtension = null;
    this.pinnedCanvasDimensions = new Set();
    this.initialBackingSize = options.canvas ? [options.canvas.width, options.canvas.height] : null;
  }
  assertAlive() { this.runtime.assertAlive(); if (this.disposed) throw new RuntimeError("Player was disposed", "Disposed"); }
  initialize() {
    const canvas = this.options.canvas;
    if (canvas) {
      canvasOwners.set(canvas, this);
      this.createGraphics();
      this.attachBrowserEvents();
    }
    this.accept(this.raw("resize", { width: this.options.width, height: this.options.height, scale: this.options.scale }));
    this.bindDefaultModes();
    this.accept(this.raw("state"));
    this.lastTime = performance.now();
    this.render(); this.scheduleNext();
  }
  raw(command, arguments_ = {}) {
    if (this.graphics !== null && !this.contextLost) this.runtime.transport.module.GL.makeContextCurrent(this.graphics);
    return this.runtime.transport.request({ operation: "command", player: this.handle, command, arguments: arguments_ });
  }
  bindDefaultModes() {
    if (!this.options.autoBind) return;
    const { variables, activeModes } = this.accept(this.raw("inspect")).inspection;
    for (const collection of Object.values(variables.collections ?? {})) {
      if (!Object.hasOwn(activeModes, collection.id) && collection.modes.some(mode => mode.id === collection.default_mode)) {
        this.accept(this.raw("setMode", { collection: collection.id, mode: collection.default_mode }));
      }
    }
  }
  accept(result) {
    if (result.camera) this.camera = result.camera;
    if (result.fitMode) this.fitMode = result.fitMode;
    this.state = { ...result.state, camera: this.camera, fitMode: this.fitMode }; this.schedule = result.schedule;
    this.lastResponse = result.response;
    this.dirty ||= result.response?.needs_redraw ?? result.response?.needsRedraw ?? false;
    if (result.viewport) this.viewport = result.viewport;
    if (result.response?.navigated) this.emit("navigate", { state: structuredClone(this.state) });
    if (result.response?.exited) this.emit("exit", {});
    if (result.openUrl) this.emit("link", { url: result.openUrl });
    for (const event of result.events ?? []) {
      this.emit(event.kind === "diagnostic" ? "error" : event.kind, event);
    }
    if (result.occurrences) this.occurrences = result.occurrences;
    return result;
  }
  synchronize() {
    const now = performance.now();
    if (this.options.clock === "auto" && !this.hidden && !this.contextLost && !this.schedule?.paused && this.lastTime !== null) {
      this.accept(this.raw("advanceBy", { deltaMs: Math.max(0, now - this.lastTime) }));
    }
    this.lastTime = now;
  }
  command(name, arguments_ = {}) {
    this.assertAlive();
    try {
      this.synchronize();
      this.accept(this.raw(name, arguments_));
      if (name === "restart") this.bindDefaultModes();
      if (this.options.clock === "manual") this.render();
      this.scheduleNext();
      return structuredClone(this.state);
    } catch (error) {
      this.cancelScheduled();
      this.accept(this.raw("state"));
      this.emit("error", error); throw error;
    }
  }
  startFlow(index) { return this.command("startFlow", { index }); }
  navigate(frame) { return this.command("navigate", { frame }); }
  back() { return this.command("back"); }
  restart(start) { return this.command("restart", { start: start ?? null }); }
  setVariable(variable, value) { return this.command("setVariable", { variable, value }); }
  setMode(collection, mode) { return this.command("setMode", { collection, mode }); }
  playClip(clip, options = {}) { return this.command("playClip", { clip, mode: options.mode ?? null, scope: options.scope ?? null }); }
  pauseClip() { return this.command("pauseClip"); }
  resumeClip() { return this.command("resumeClip"); }
  seekClip(timeMs) { return this.command("seekClip", { timeMs }); }
  stopClip() { return this.command("stopClip"); }
  pausePlayback() { return this.command("pausePlayback"); }
  resumePlayback() { return this.command("resumePlayback"); }
  sendPointer(event) { return this.command("pointer", { type: event.type, point: [event.x, event.y] }); }
  cancelPointer() { return this.command("cancelPointer"); }
  sendKey(key, type = "down") { return this.command("key", { key, type }); }
  scrollBy(x, y, deltaX, deltaY) { return this.command("scroll", { point: [x, y], delta: [deltaX, deltaY] }); }
  panBy(deltaX, deltaY) { return this.command("pan", { delta: [deltaX, deltaY] }); }
  zoomAt(x, y, factor) { return this.command("zoom", { point: [x, y], factor }); }
  fitView(mode) {
    this.assertAlive();
    return this.command("fit", mode === undefined ? {} : { mode: fitMode(mode) });
  }
  getViewport() { this.assertAlive(); return structuredClone(this.viewport); }
  getCamera() { this.assertAlive(); return structuredClone(this.camera); }
  getFitMode() { this.assertAlive(); return this.fitMode; }
  advanceBy(deltaMs) {
    this.assertAlive();
    if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new TypeError("deltaMs must be finite and nonnegative");
    try {
      this.accept(this.raw("advanceBy", { deltaMs }));
      this.lastTime = performance.now(); this.render(); this.scheduleNext();
      return structuredClone(this.state);
    } catch (error) {
      this.cancelScheduled(); this.accept(this.raw("pausePlayback")); this.emit("error", error); throw error;
    }
  }
  getState() { this.assertAlive(); this.accept(this.raw("state")); return structuredClone({ ...this.state, occurrences: this.occurrences ?? [], metrics: this.renderMetrics }); }
  inspect() { this.assertAlive(); return structuredClone(this.accept(this.raw("inspect")).inspection); }
  resize(width, height, scale = this.options.scale) {
    this.assertAlive();
    const [physicalWidth, physicalHeight] = this.options.canvas ? backingSize(width, height, scale) : [positive(width, "width"), positive(height, "height")];
    positive(scale, "scale");
    this.synchronize();
    this.accept(this.raw("resize", { width, height, scale }));
    this.options.width = width; this.options.height = height; this.options.scale = scale;
    if (this.options.canvas) {
      this.setBackingSize(physicalWidth, physicalHeight);
    }
    this.render(); this.scheduleNext(); return structuredClone(this.state);
  }
  resizeDrawingSurfaceToCanvas() {
    this.assertAlive();
    const canvas = this.options.canvas;
    if (!canvas) throw new TypeError("resizeDrawingSurfaceToCanvas requires a canvas");
    return this.resize(canvas.clientWidth, canvas.clientHeight,
      this.options.automaticScale ? globalThis.devicePixelRatio ?? 1 : this.options.scale);
  }
  on(name, listener) {
    this.assertAlive();
    if (typeof listener !== "function") throw new TypeError("Listener must be a function");
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(listener);
    return () => this.listeners.get(name)?.delete(listener);
  }
  emit(name, event) {
    const listeners = [...(this.listeners.get(name) ?? [])];
    queueMicrotask(() => { if (!this.disposed) for (const listener of listeners) listener(event); });
  }
  cancelScheduled() {
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    if (this.timeout !== null) clearTimeout(this.timeout);
    this.animationFrame = null; this.timeout = null;
  }
  scheduleNext() {
    this.cancelScheduled();
    if (this.options.clock !== "auto" || this.disposed || this.hidden || this.contextLost) return;
    const step = () => {
      this.animationFrame = null; this.timeout = null;
      try { this.synchronize(); this.render(); this.scheduleNext(); }
      catch (error) { this.cancelScheduled(); this.accept(this.raw("pausePlayback")); this.emit("error", error); }
    };
    if (this.dirty || this.schedule?.continuous) this.animationFrame = requestAnimationFrame(step);
    else if (this.schedule?.paused) return;
    else if (this.schedule?.nextDeadlineMs !== null && this.schedule?.nextDeadlineMs !== undefined) {
      this.timeout = setTimeout(step, Math.min(2147483647, Math.max(0, this.schedule.nextDeadlineMs)));
    }
  }
  createGraphics() {
    const module = this.runtime.transport.module;
    if (!module.GL) throw new RuntimeError("WASM module lacks WebGL support", "UnsupportedGraphics");
    const canvas = this.options.canvas;
    const [physicalWidth, physicalHeight] = backingSize(this.options.width, this.options.height, this.options.scale);
    // Manual and paused players draw once; WebKit GTK can otherwise present the previous buffer.
    const context = canvas.getContext("webgl2", { alpha: true, antialias: false, depth: false, stencil: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
    if (!context) throw new RuntimeError("WebGL2 is required", "UnsupportedGraphics");
    // Skia queries advertised renderer details that Emscripten does not enable by default.
    context.getExtension("WEBGL_debug_renderer_info");
    this.webglContext = context;
    this.contextLossExtension = context.getExtension("WEBGL_lose_context");
    this.graphics = module.GL.registerContext(context, { majorVersion: 2 });
    this.setBackingSize(physicalWidth, physicalHeight);
    module.GL.makeContextCurrent(this.graphics);
  }
  setBackingSize(width, height) {
    const canvas = this.options.canvas;
    const previous = { width: canvas.clientWidth, height: canvas.clientHeight };
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width; canvas.height = height;
    for (const dimension of ["width", "height"]) {
      const current = dimension === "width" ? canvas.clientWidth : canvas.clientHeight;
      if (previous[dimension] > 0 && Math.abs(current - previous[dimension]) > 0.5) {
        if (!this.pinnedCanvasDimensions.has(dimension)) {
          const authored = canvas.style[dimension];
          this.cleanup.push(() => { canvas.style[dimension] = authored; });
          this.pinnedCanvasDimensions.add(dimension);
        }
        canvas.style[dimension] = `${previous[dimension]}px`;
      }
    }
  }
  render() {
    if (!this.options.canvas) { this.dirty = false; return; }
    if (this.contextLost || !this.dirty) return;
    this.runtime.transport.module.GL.makeContextCurrent(this.graphics);
    this.renderMetrics = this.runtime.transport.request({ operation: "render", player: this.handle, width: this.options.canvas.width, height: this.options.canvas.height, scale: this.options.scale });
    this.dirty = false;
  }
  attachBrowserEvents() {
    const canvas = this.options.canvas;
    const safely = handler => event => { try { handler(event); } catch (error) { this.emit("error", error); } };
    const listen = (target, name, handler, options) => { const callback = safely(handler); target.addEventListener(name, callback, options); this.cleanup.push(() => target.removeEventListener(name, callback, options)); };
    if (this.options.input === "prototype") this.attachInputEvents(canvas, listen);
    const visibility = () => { this.hidden = document.hidden; this.lastTime = performance.now(); this.scheduleNext(); };
    listen(document, "visibilitychange", visibility); visibility();
    listen(canvas, "webglcontextlost", event => {
      event.preventDefault(); this.contextLost = true; this.cancelScheduled();
      this.runtime.transport.request({ operation: "releaseGraphics", player: this.handle });
      if (this.graphics !== null) {
        const module = this.runtime.transport.module;
        module.GL.deleteContext(this.graphics);
        if (module.ctx === this.webglContext) module.GL.makeContextCurrent(0);
      }
      this.graphics = null;
    });
    listen(canvas, "webglcontextrestored", () => {
      try { this.createGraphics(); this.contextLost = false; this.dirty = true; this.lastTime = performance.now(); this.render(); this.scheduleNext(); }
      catch (error) { this.contextLost = true; this.emit("error", error); }
    });
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(safely(entries => { const box = entries[0]?.contentRect; if (box?.width > 0 && box?.height > 0) this.resize(box.width, box.height, this.options.automaticScale ? globalThis.devicePixelRatio ?? 1 : this.options.scale); }));
      observer.observe(canvas); this.cleanup.push(() => observer.disconnect());
    }
    listen(globalThis, "resize", () => { if (canvas.clientWidth > 0 && canvas.clientHeight > 0) this.resizeDrawingSurfaceToCanvas(); });
  }
  attachInputEvents(canvas, listen) {
    const touchAction = canvas.style.touchAction;
    canvas.style.touchAction = "none";
    this.cleanup.push(() => { canvas.style.touchAction = touchAction; });
    const point = event => {
      const box = canvas.getBoundingClientRect();
      return { x: (event.clientX - box.left) * this.options.width / box.width, y: (event.clientY - box.top) * this.options.height / box.height };
    };
    let press = null;
    if (!canvas.hasAttribute("tabindex")) canvas.tabIndex = 0;
    listen(canvas, "pointerdown", event => {
      if (!event.isPrimary || event.button !== 0) return;
      this.synchronize();
      canvas.focus(); canvas.setPointerCapture(event.pointerId);
      const location = point(event); const result = this.accept(this.raw("pointer", { type: "down", point: [location.x, location.y] }));
      press = { ...location, last: location, id: event.pointerId, dragged: false, suppressed: !!(result.response?.suppress_click ?? result.response?.suppressClick) };
      this.lastTime = performance.now(); this.scheduleNext();
      if (this.options.clock === "manual") this.render();
    });
    listen(canvas, "pointermove", event => {
      if (!event.isPrimary) return;
      const location = point(event);
      if (press && event.pointerType === "touch") {
        const delta = [press.last.x - location.x, press.last.y - location.y];
        press.last = location;
        this.synchronize();
        const result = this.accept(this.raw("scroll", { point: [press.x, press.y], delta }));
        if (result.response?.needs_redraw || result.response?.needsRedraw) {
          press.dragged = true; press.scrolling = true; this.cancelPointer();
        }
        if (press.scrolling) { this.render(); this.scheduleNext(); return; }
      }
      if (press && !press.dragged && Math.hypot(location.x - press.x, location.y - press.y) >= 5) { press.dragged = true; this.sendPointer({ ...location, type: "dragStart" }); }
      if (event.pointerType !== "touch" || press) this.sendPointer({ ...location, type: "move" });
    });
    const release = (event, cancelled) => {
      if (!press || press.id !== event.pointerId) return;
      const location = point(event); const previous = press; press = null;
      if (cancelled || previous.scrolling) this.cancelPointer();
      else {
        this.sendPointer({ ...location, type: "up" });
        if (!previous.dragged && !previous.suppressed) this.sendPointer({ ...location, type: "click" });
      }
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    listen(canvas, "pointerup", event => release(event, false));
    listen(canvas, "pointercancel", event => release(event, true));
    listen(canvas, "lostpointercapture", event => release(event, true));
    this.cleanup.push(() => { if (press && canvas.hasPointerCapture(press.id)) canvas.releasePointerCapture(press.id); press = null; });
    listen(canvas, "pointerleave", event => { if (!press) this.sendPointer({ ...point(event), type: "leave" }); });
    listen(canvas, "keydown", event => {
      this.sendKey(event.key === " " ? "Space" : event.key);
      if (this.lastResponse?.needs_redraw || this.lastResponse?.needsRedraw || this.lastResponse?.navigated || this.lastResponse?.exited) event.preventDefault();
    });
    listen(canvas, "keyup", event => { this.sendKey(event.key === " " ? "Space" : event.key, "up"); });
    listen(canvas, "wheel", event => {
      const location = point(event); const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.options.height : 1;
      this.scrollBy(location.x, location.y, event.deltaX * factor, event.deltaY * factor);
      if (this.lastResponse?.needs_redraw || this.lastResponse?.needsRedraw) event.preventDefault();
    }, { passive: false });
  }
  dispose() {
    if (this.disposed) return;
    this.cancelScheduled();
    for (const cleanup of this.cleanup) cleanup();
    if (this.graphics !== null && !this.contextLost) this.runtime.transport.module.GL.makeContextCurrent(this.graphics);
    this.runtime.transport.request({ operation: "disposePlayer", player: this.handle });
    if (this.graphics !== null) {
      const module = this.runtime.transport.module;
      module.GL.deleteContext(this.graphics);
      // Emscripten deletes the handle but retains its last WebGL context separately.
      if (module.ctx === this.webglContext) module.GL.makeContextCurrent(0);
    }
    if (this.initialBackingSize) [this.options.canvas.width, this.options.canvas.height] = this.initialBackingSize;
    if (this.options.canvas) releaseCanvasContext(this.options.canvas, this.webglContext, this.contextLossExtension, this.contextLost);
    if (this.options.canvas && canvasOwners.get(this.options.canvas) === this) canvasOwners.delete(this.options.canvas);
    this.runtime.players.delete(this); this.listeners.clear(); this.cleanup = []; this.graphics = null; this.disposed = true;
    this.webglContext = null; this.contextLossExtension = null;
  }
}
