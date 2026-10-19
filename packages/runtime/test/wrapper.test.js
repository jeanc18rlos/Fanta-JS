import assert from "node:assert/strict";
import {test} from "node:test";
import {createRuntime} from "../src/index.js";

async function transportFixture() {
  const requests = [];
  const buffers = new Map();
  const modes = new Map();
  let pointer = 8, handle = 1;
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  const module = {
    HEAPU8:new Uint8Array(1024 * 1024),
    _fanta_alloc(length) { const result = pointer; pointer += Math.max(1, length) + 8; buffers.set(result, length); return result; },
    _fanta_buffer_len(pointer) { return buffers.get(pointer); },
    _fanta_free(pointer) { buffers.delete(pointer); },
    _fanta_request(pointer) {
      const request = JSON.parse(decoder.decode(this.HEAPU8.subarray(pointer, pointer + buffers.get(pointer))));
      requests.push(request);
      let value;
      if (request.operation === "compileSource") value = {handle:handle++,flows:[],clips:[],diagnostics:[],capabilities:{media:"posters",liveVideo:false,liveAudio:false}};
      else if (request.operation === "createPlayer") { const player = handle++; modes.set(player, request.fit); value = {handle:player}; }
      else if (request.operation === "command") {
        if (request.command === "fit" && request.arguments.mode) modes.set(request.player, request.arguments.mode);
        const mode = modes.get(request.player);
        const scale = mode === "fill" ? [2,5] : mode === "cover" ? [5,5] : [2,2];
        const schedule = {paused:false,continuous:false,nextDeadlineMs:null,timersSuspended:false};
        value = {state:{currentFrame:"frame",clockMs:0,overlayFrames:[],currentLayer:1,clip:null,schedule},schedule,
          response:{needs_redraw:false},camera:{center:[31,47],scale},fitMode:mode,viewport:{center:[31,47],zoom:2},
          inspection:{variables:{collections:{}},activeModes:{}},occurrences:[]};
      } else value = true;
      const bytes = encoder.encode(JSON.stringify({ok:true,value}));
      const result = this._fanta_alloc(bytes.length);this.HEAPU8.set(bytes, result);return result;
    },
  };
  const runtime = await createRuntime({moduleFactory:async()=>module});
  const program = await runtime.compileSource({files:{}});
  return {runtime,program,requests};
}

test("wrapper forwards fit policy and exposes the authoritative two-axis camera without projecting it",async()=>{
  const {runtime,program,requests} = await transportFixture();
  try {
    const player = await runtime.createPlayer({program,fit:"fill"});
    const other = await runtime.createPlayer({program});
    assert.deepEqual(requests.filter(request=>request.operation==="createPlayer").map(request=>request.fit),["fill","contain"]);
    assert.deepEqual(player.getCamera(),{center:[31,47],scale:[2,5]});
    assert.equal(player.getViewport().zoom,2);
    assert.equal(player.getFitMode(),"fill");
    const camera = player.getCamera();camera.scale[1]=99;
    assert.deepEqual(player.getState().camera.scale,[2,5]);
    for (const state of [player.advanceBy(1),player.resize(400,200,2)]) {
      assert.deepEqual(state.camera,{center:[31,47],scale:[2,5]});
      assert.equal(state.fitMode,"fill");
      state.camera.scale[1]=99;
      assert.deepEqual(player.getCamera().scale,[2,5]);
      assert.deepEqual(player.getState().camera.scale,[2,5]);
    }
    assert.equal(player.fitView("cover").fitMode,"cover");
    assert.deepEqual(player.getCamera().scale,[5,5]);
    assert.equal(other.getFitMode(),"contain");
    player.fitView();
    assert.deepEqual(requests.findLast(request=>request.command==="fit").arguments,{});
    assert.equal(player.getFitMode(),"cover");
  } finally { runtime.dispose(); }
});

test("invalid fit creation does not allocate an engine handle or touch canvas ownership",async()=>{
  const {runtime,program,requests} = await transportFixture();
  try {
    const canvas = {clientWidth:300,clientHeight:300,getContext(){assert.fail("Invalid fit touched graphics");}};
    for (const fit of [null,false,1,[],{},{contain:null},"Fill","stretch"]) {
      const before = requests.length;
      await assert.rejects(runtime.createPlayer({program,canvas,fit,clock:"manual"}),/fit must be/);
      assert.equal(requests.length,before);
      assert.equal(runtime.players.size,0);
    }
    assert.equal((await runtime.createPlayer({program,fit:"fill"})).getFitMode(),"fill");
  } finally { runtime.dispose(); }
});

test("invalid mode-specific fit is rejected before automatic-clock synchronization",async()=>{
  const animation = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = ()=>assert.fail("Idle player scheduled continuous animation");
  const {runtime,program,requests} = await transportFixture();
  try {
    const player = await runtime.createPlayer({program,fit:"fill",clock:"auto"});
    for (const mode of [null,false,1,[],{},{contain:null},"Fill","stretch"]) {
      const before = requests.length;
      assert.throws(()=>player.fitView(mode),/fit must be/);
      assert.equal(requests.length,before);
      assert.deepEqual(player.getCamera().scale,[2,5]);
      assert.equal(player.getFitMode(),"fill");
    }
  } finally {
    runtime.dispose();
    if (animation === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = animation;
  }
});
