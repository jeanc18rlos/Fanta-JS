import assert from "node:assert/strict";
import {test,expect} from "@playwright/test";
import {PNG} from "pngjs";

function pixel(image,x,y) {
  const decoded=PNG.sync.read(image);
  return [...decoded.data.subarray((y*decoded.width+x)*4,(y*decoded.width+x)*4+4)];
}

async function load(page) {
  await page.goto("/packages/runtime/examples/blank.html");
  await page.evaluate(async()=>{
    const {createRuntime}=await import("/packages/runtime/src/index.js");
    const {exampleSource,ids}=await import("/packages/runtime/examples/source.js");
    const runtime=await createRuntime();
    const source=exampleSource({text:true,graphics:true,delay:1000});
    source.fonts=[{family:"Runtime Sans",weight:400,bytes:new Uint8Array(await (await fetch("/fixtures/fonts/source-sans-3/SourceSans3-Variable.ttf")).arrayBuffer())}];
    const program=await runtime.compileSource(source);
    function canvas(name){const canvas=document.createElement("canvas");canvas.id=name;canvas.style="display:block;width:320px;height:180px;touch-action:none";document.body.append(canvas);return canvas;}
    const player=await runtime.createPlayer({program,canvas:canvas("first"),width:320,height:180,clock:"manual"});
    const bundle=await runtime.loadBundle(program.toBundle());
    const other=await runtime.createPlayer({program:bundle,canvas:canvas("second"),width:320,height:180,clock:"manual"});
    window.fixture={runtime,program,player,other,ids,source,canvas};
  });
}

test("source and bundles render identical pixels and deterministic playback without frame readbacks",async({page})=>{
  const failures=[];page.on("pageerror",error=>failures.push(error.message));
  await load(page);
  const firstFrame=await page.locator("#first").screenshot();
  assert.deepEqual(firstFrame,await page.locator("#second").screenshot());
  assert.deepEqual(pixel(firstFrame,5,5),[23,32,51,255]);
  await page.evaluate(async()=>{
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    document.body.style.backgroundColor="rgb(41, 52, 66)";
  });
  assert.deepEqual(firstFrame,await page.locator("#first").screenshot());
  assert.deepEqual(pixel(firstFrame,40,50),[64,88,239,255]);
  assert.deepEqual(pixel(firstFrame,125,35),[225,55,65,255]);
  assert.deepEqual(pixel(firstFrame,205,40),[243,152,41,255]);
  assert.deepEqual(pixel(firstFrame,245,40),[23,32,51,255]);
  const blurredEdge=pixel(firstFrame,279,32);
  expect(blurredEdge[0]).toBeGreaterThan(23);expect(blurredEdge[0]).toBeLessThan(255);
  const decoded=PNG.sync.read(firstFrame);
  expect(Array.from({length:60},(_,row)=>Array.from({length:260},(_,column)=>decoded.data[((row+100)*decoded.width+column+24)*4]).some(red=>red>100)).some(Boolean)).toBe(true);
  await page.evaluate(()=>{fixture.player.playClip(fixture.ids.clip);fixture.other.playClip(fixture.ids.clip);fixture.player.advanceBy(500);fixture.other.advanceBy(250);fixture.other.advanceBy(250);});
  assert.deepEqual(await page.locator("#first").screenshot(),await page.locator("#second").screenshot());
  assert.notDeepEqual(firstFrame,await page.locator("#first").screenshot());
  const state=await page.evaluate(()=>fixture.player.getState());
  expect(state.currentFrame).toBe("00000000000000000000000002");
  expect(state.clip.playheadMs).toBe(500);expect(state.metrics.wholeFrameReadbacks).toBe(0);
  await page.evaluate(()=>{fixture.player.advanceBy(500);fixture.other.advanceBy(500);});
  expect((await page.evaluate(()=>fixture.player.getState())).currentFrame).toBe("00000000000000000000000004");
  assert.deepEqual(await page.locator("#first").screenshot(),await page.locator("#second").screenshot());
  expect(failures).toEqual([]);
  await page.evaluate(()=>fixture.runtime.dispose());
});

test("automatic idle deadlines navigate without continuous animation",async({page})=>{
  await load(page);
  await page.evaluate(async()=>{
    const automatic=await fixture.runtime.createPlayer({program:fixture.program,canvas:fixture.canvas("automatic"),clock:"auto"});
    fixture.automatic=automatic;
  });
  await expect.poll(()=>page.evaluate(()=>fixture.automatic.getState().currentFrame),{timeout:5000}).toBe("00000000000000000000000004");
  expect((await page.evaluate(()=>fixture.automatic.getState())).metrics.wholeFrameReadbacks).toBe(0);
  await page.evaluate(()=>fixture.runtime.dispose());
});

test("resize, disposed-program ownership, and graphics restoration keep session state",async({page,browserName})=>{
  await load(page);
  await page.evaluate(async()=>{
    fixture.pinned=await fixture.runtime.createPlayer({program:fixture.program,canvas:fixture.canvas("pinned"),scale:2,clock:"manual"});
    fixture.program.dispose();fixture.player.playClip(fixture.ids.clip);fixture.player.advanceBy(200);fixture.player.resize(320,180,2);
  });
  expect(await page.locator("#first").evaluate(canvas=>canvas.width)).toBe(640);
  expect((await page.evaluate(()=>fixture.player.getState())).clip.playheadMs).toBe(200);
  assert.deepEqual(pixel(await page.locator("#first").screenshot(),125,35),[225,55,65,255]);
  const supported=await page.evaluate(()=>{
    const context=document.querySelector("#first").getContext("webgl2");
    const extension=context.getExtension("WEBGL_lose_context");
    if(!extension)return false;
    fixture.loss=extension;extension.loseContext();return true;
  });
  if(supported){
    await expect.poll(()=>page.evaluate(()=>fixture.player.contextLost)).toBe(true);
    await page.evaluate(()=>fixture.loss.restoreContext());
    await expect.poll(()=>page.evaluate(()=>fixture.player.contextLost),{timeout:10000}).toBe(false);
    expect((await page.evaluate(()=>fixture.player.getState())).clip.playheadMs).toBe(200);
    assert.deepEqual(pixel(await page.locator("#first").screenshot(),125,35),[225,55,65,255]);
  }
  const resized=await page.evaluate(()=>{
    const canvas=document.querySelector("#first");
    canvas.style.width="480px";canvas.style.height="270px";
    fixture.player.resizeDrawingSurfaceToCanvas();
    const pinned=document.querySelector("#pinned");
    pinned.style.width="480px";pinned.style.height="270px";
    fixture.pinned.resizeDrawingSurfaceToCanvas();
    return {width:canvas.width,height:canvas.height,pinned:[pinned.width,pinned.height],playhead:fixture.player.getState().clip.playheadMs};
  });
  expect(resized).toEqual({width:480,height:270,pinned:[960,540],playhead:200});
  await page.evaluate(()=>fixture.runtime.dispose());
  expect(await page.evaluate(()=>fixture.runtime.players.size)).toBe(0);
});

test("paused players redraw controls, cancel pointers, and retain sizes after rejected allocations",async({page})=>{
  await load(page);
  await page.evaluate(async()=>{
    fixture.automatic=await fixture.runtime.createPlayer({program:fixture.program,canvas:fixture.canvas("automatic"),clock:"auto"});
    fixture.automatic.pausePlayback();
  });
  const before=await page.locator("#automatic").screenshot();
  await page.evaluate(()=>{fixture.automatic.playClip(fixture.ids.clip);fixture.automatic.seekClip(500);});
  await expect.poll(async()=>Buffer.compare(before,await page.locator("#automatic").screenshot())).not.toBe(0);
  const clock=await page.evaluate(()=>fixture.automatic.getState().clockMs);
  await page.waitForTimeout(100);
  expect(await page.evaluate(()=>fixture.automatic.getState().clockMs)).toBe(clock);
  const cancellation=await page.evaluate(async()=>{
    const canvas=document.querySelector("#first");
    fixture.player.sendPointer({type:"down",x:40,y:50});fixture.player.cancelPointer();
    try{fixture.player.resize(1e9,1e9);throw Error("Expected budget rejection");}catch(error){if(error.code!=="ResourceLimit")throw error;}
    let owned=false;
    try{await fixture.runtime.createPlayer({program:fixture.program,canvas});}catch(error){owned=error.code==="CanvasInUse";}
    return {frame:fixture.player.getState().currentFrame,width:canvas.width,logical:fixture.player.options.width,owned};
  });
  expect(cancellation).toEqual({frame:"00000000000000000000000002",width:320,logical:320,owned:true});
  await page.evaluate(()=>fixture.runtime.dispose());
});

test("programs isolate different supplied faces registered under the same family",async({page})=>{
  await load(page);
  const original=await page.locator("#first").screenshot();
  await page.evaluate(async()=>{
    const source=structuredClone(fixture.source);
    source.fonts=[{family:"Runtime Sans",weight:400,bytes:new Uint8Array(await(await fetch("/fixtures/fonts/source-serif-4/SourceSerif4-Variable.ttf")).arrayBuffer())}];
    const program=await fixture.runtime.compileSource(source);
    fixture.serif=await fixture.runtime.createPlayer({program,canvas:fixture.canvas("serif"),clock:"manual"});
  });
  assert.notDeepEqual(original,await page.locator("#serif").screenshot());
  await page.evaluate(()=>{fixture.player.playClip(fixture.ids.clip);fixture.player.seekClip(0);});
  assert.deepEqual(original,await page.locator("#first").screenshot());
  await page.evaluate(async()=>{
    for(let index=0;index<20;index++){
      const canvas=fixture.canvas("cycle");
      const player=await fixture.runtime.createPlayer({program:fixture.program,canvas,clock:"manual"});
      player.playClip(fixture.ids.clip);player.advanceBy(20);player.dispose();canvas.remove();
    }
    if(fixture.runtime.players.size!==3)throw Error("Disposed players retained");
    fixture.runtime.dispose();
  });
});

test("an unstyled canvas keeps logical size when its backing scale changes",async({page})=>{
  await load(page);
  await page.evaluate(async()=>{
    const canvas=document.createElement("canvas");canvas.id="unstyled";document.body.append(canvas);
    fixture.unstyled=await fixture.runtime.createPlayer({program:fixture.program,canvas,scale:2,clock:"manual"});
  });
  await page.waitForTimeout(100);
  expect(await page.locator("#unstyled").evaluate(canvas=>[canvas.clientWidth,canvas.clientHeight,canvas.width,canvas.height])).toEqual([300,150,600,300]);
  await page.evaluate(()=>fixture.runtime.dispose());
  expect(await page.locator("#unstyled").evaluate(canvas=>[canvas.clientWidth,canvas.clientHeight,canvas.width,canvas.height,canvas.style.touchAction])).toEqual([300,150,300,150,""]);
});

test("browser keys use the focused player and deliver host links after the state step",async({page})=>{
  await load(page);
  await page.evaluate(async()=>{
    const source=structuredClone(fixture.source);
    const reactions=[{id:"00000000000000000000000020",trigger:{kind:"key",keys:["Space"]},action:{kind:"open_link",url:"https://example.invalid/host-event"}}];
    source.files["pages/demo/page.fnx"]=source.files["pages/demo/page.fnx"].replace(/reactions=\{.*?\}>/,`reactions={${JSON.stringify(reactions)}}>`);
    const program=await fixture.runtime.compileSource(source);
    fixture.keys=await fixture.runtime.createPlayer({program,canvas:fixture.canvas("keys"),clock:"manual"});
    fixture.links=[];fixture.keys.on("link",event=>fixture.links.push({url:event.url,frame:fixture.keys.getState().currentFrame}));
  });
  await page.locator("#first").focus();await page.keyboard.press("Space");
  expect(await page.evaluate(()=>fixture.links)).toEqual([]);
  await page.locator("#keys").focus();await page.keyboard.press("Space");
  expect(await page.evaluate(()=>fixture.links)).toEqual([{url:"https://example.invalid/host-event",frame:"00000000000000000000000002"}]);
  await page.evaluate(()=>fixture.runtime.dispose());
});
