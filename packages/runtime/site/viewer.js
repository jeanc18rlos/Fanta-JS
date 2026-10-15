import {createRuntime} from "./index.js";

const zoomStep = 1.25;
const fitMargin = 0.92;
const lineHeight = 16;

export async function mountPage({page}) {
  const canvas = document.querySelector("[data-fanta-canvas]");
  const status = document.querySelector("[data-fanta-status]");
  const level = document.querySelector("[data-fanta-zoom-level]");
  const pages = document.querySelector("[data-fanta-pages]");
  pages?.addEventListener("change", () => { location.href = pages.value; });

  let player;
  try {
    const base = new URL(".", import.meta.url);
    const runtime = await createRuntime({moduleUrl: new URL("fanta-runtime.mjs", base), wasmUrl: new URL("fanta_runtime_wasm.wasm", base)});
    const response = await fetch(new URL("program.fanta", base));
    if (!response.ok) throw new Error(`The document could not be downloaded (HTTP ${response.status}).`);
    const program = await runtime.loadBundle(new Uint8Array(await response.arrayBuffer()));
    // A manual clock and no prototype input keep the page inert: it is shown,
    // never played, and its timers never start.
    player = await runtime.createPlayer({program, canvas, start: page, input: "none", clock: "manual"});
  } catch (error) {
    status.textContent = `This page could not be displayed. ${error.message}`;
    return;
  }
  status.hidden = true;
  player.on("error", error => {
    status.hidden = false;
    status.textContent = `This page could not be displayed. ${error.message ?? error}`;
  });

  const showZoom = () => {
    if (level) level.value = `${Math.round(player.getViewport().zoom * 100)}%`;
  };
  const center = () => [canvas.clientWidth / 2, canvas.clientHeight / 2];
  const zoomBy = (factor, [x, y] = center()) => { player.zoomAt(x, y, factor); showZoom(); };
  const panBy = (deltaX, deltaY) => { if (deltaX || deltaY) player.panBy(deltaX, deltaY); };
  const fit = () => {
    player.fitView();
    // The player fits prototype frames edge to edge; a page reads as cropped
    // without a margin.
    const [x, y] = center();
    player.zoomAt(x, y, fitMargin);
    showZoom();
  };
  const point = event => {
    const box = canvas.getBoundingClientRect();
    return [event.clientX - box.left, event.clientY - box.top];
  };

  document.querySelector('[data-fanta-zoom="in"]')?.addEventListener("click", () => zoomBy(zoomStep));
  document.querySelector('[data-fanta-zoom="out"]')?.addEventListener("click", () => zoomBy(1 / zoomStep));
  document.querySelector("[data-fanta-fit]")?.addEventListener("click", fit);

  document.addEventListener("keydown", event => {
    if (event.target instanceof HTMLElement && event.target.closest("select, input, textarea")) return;
    if (event.key === "+" || event.key === "=") zoomBy(zoomStep);
    else if (event.key === "-" || event.key === "_") zoomBy(1 / zoomStep);
    else if (event.key === "0") fit();
    else return;
    event.preventDefault();
  });

  canvas.addEventListener("wheel", event => {
    event.preventDefault();
    const scale = event.deltaMode === 1 ? lineHeight : event.deltaMode === 2 ? canvas.clientHeight : 1;
    const deltaX = event.deltaX * scale;
    const deltaY = event.deltaY * scale;
    if (event.ctrlKey || event.metaKey) {
      // Trackpad pinches arrive as small ctrl-wheel deltas; bound mouse wheels.
      zoomBy(Math.exp(-Math.max(-50, Math.min(50, deltaY)) * 0.01), point(event));
    } else if (event.shiftKey && deltaX === 0) {
      panBy(-deltaY, 0);
    } else {
      panBy(-deltaX, -deltaY);
    }
  }, {passive: false});

  const pointers = new Map();
  let pinch = null;
  const pinchState = () => {
    const [first, second] = [...pointers.values()];
    return {distance: Math.hypot(second[0] - first[0], second[1] - first[1]), middle: [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2]};
  };
  canvas.addEventListener("pointerdown", event => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, point(event));
    canvas.classList.add("dragging");
    pinch = pointers.size === 2 ? pinchState() : null;
  });
  canvas.addEventListener("pointermove", event => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const current = point(event);
    pointers.set(event.pointerId, current);
    if (pointers.size === 1) {
      panBy(current[0] - previous[0], current[1] - previous[1]);
    } else if (pinch && pointers.size === 2) {
      const next = pinchState();
      panBy(next.middle[0] - pinch.middle[0], next.middle[1] - pinch.middle[1]);
      if (pinch.distance > 0 && next.distance > 0) zoomBy(next.distance / pinch.distance, next.middle);
      pinch = next;
    }
  });
  const release = event => {
    pointers.delete(event.pointerId);
    pinch = pointers.size === 2 ? pinchState() : null;
    if (pointers.size === 0) canvas.classList.remove("dragging");
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  fit();
  window.fantaViewer = {player};
}
