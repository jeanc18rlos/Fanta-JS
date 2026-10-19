import assert from "node:assert/strict";
import {test,expect} from "@playwright/test";
import {PNG} from "pngjs";

const browserErrors = new WeakMap();
test.beforeEach(async({page})=>{
  const errors=[];browserErrors.set(page,errors);
  page.on("pageerror",error=>errors.push(error.message));
  page.on("console",message=>{if(message.type()==="error")errors.push(message.text());});
});
test.afterEach(async({page})=>{
  expect(browserErrors.get(page)).toEqual([]);
});

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

async function loadFit(page,options={}) {
  await page.goto("/packages/runtime/examples/blank.html");
  await page.evaluate(async options=>{
    const {createRuntime}=await import("/packages/runtime/src/index.js");
    const {fitSource,fitIds}=await import("/packages/runtime/examples/source.js");
    const runtime=await createRuntime();
    const program=await runtime.compileSource(fitSource({transition:options.transition??{kind:"dissolve"},transitionMarkers:options.transitionMarkers??false}));
    const loaded=await runtime.loadBundle(program.toBundle());
    document.body.style.margin="0";
    const canvas=(name,left)=>{const canvas=document.createElement("canvas");canvas.id=name;canvas.style=`position:absolute;left:${left}px;top:32px;width:300px;height:300px;display:block`;document.body.append(canvas);return canvas;};
    const settings={width:300,height:300,fit:options.fit??"fill",scale:options.scale??1,clock:"manual"};
    const player=await runtime.createPlayer({program,canvas:canvas("fit-first",44),...settings});
    const other=await runtime.createPlayer({program:loaded,canvas:canvas("fit-second",540),...settings});
    const links=[];player.on("link",event=>links.push(event.url));
    window.fitFixture={runtime,program,player,other,ids:fitIds,links};
  },options);
}

test("contain, cover and fill render actual independent camera geometry for source and bundles",async({page})=>{
  await loadFit(page);
  for (const [fit,scale,colors] of [
    ["contain",[1.5,1.5],[[255,255,255,255],[0,0,0,255],[0,0,0,255],[255,0,0,255]]],
    ["cover",[3,3],[[0,0,0,255],[255,0,0,255],[255,0,0,255],[0,0,0,255]]],
    ["fill",[1.5,3],[[0,0,0,255],[255,0,0,255],[0,0,0,255],[0,0,0,255]]],
  ]) {
    await page.evaluate(fit=>{fitFixture.player.fitView(fit);fitFixture.other.fitView(fit);},fit);
    const first=await page.locator("#fit-first").screenshot({scale:"css"});
    assert.deepEqual(first,await page.locator("#fit-second").screenshot({scale:"css"}));
    const decoded=PNG.sync.read(first);expect([decoded.width,decoded.height]).toEqual([300,300]);
    for (const [index,point] of [[20,20],[130,80],[105,80],[130,125]].entries()) assert.deepEqual(pixel(first,...point),colors[index]);
    expect(await page.evaluate(()=>fitFixture.player.getCamera())).toEqual({center:[500,110],scale});
    expect(await page.evaluate(()=>fitFixture.player.getState().metrics.wholeFrameReadbacks)).toBe(0);
  }
  const cameras=await page.evaluate(()=>{
    const before=fitFixture.player.getState();
    fitFixture.player.zoomAt(60,90,2);
    const zoomed=fitFixture.player.getCamera();
    fitFixture.player.panBy(30,-12);
    return {before,zoomed,panned:fitFixture.player.getCamera(),after:fitFixture.player.getState(),other:fitFixture.other.getCamera()};
  });
  expect(cameras.zoomed).toEqual({center:[470,100],scale:[3,6]});
  expect(cameras.panned).toEqual({center:[460,102],scale:[3,6]});
  expect(cameras.other).toEqual({center:[500,110],scale:[1.5,3]});
  expect(cameras.after.clockMs).toBe(cameras.before.clockMs);
  expect(cameras.after.currentFrame).toBe(cameras.before.currentFrame);
  expect(cameras.after.schedule).toEqual(cameras.before.schedule);
  const panned=await page.locator("#fit-first").screenshot({scale:"css"});
  assert.deepEqual(pixel(panned,230,80),[255,0,0,255]);
  assert.deepEqual(pixel(panned,190,80),[0,0,0,255]);
  await page.evaluate(()=>fitFixture.player.fitView());
  expect(await page.evaluate(()=>fitFixture.player.getCamera())).toEqual({center:[500,110],scale:[1.5,3]});
  await page.evaluate(()=>fitFixture.player.fitView("cover"));
  expect(await page.evaluate(()=>fitFixture.other.getFitMode())).toBe("fill");
  await page.evaluate(()=>fitFixture.runtime.dispose());
});

test("fill DOM input normalizes offsets, DPR and CSS transforms and rejects modes before ownership",async({page})=>{
  await loadFit(page,{scale:2});
  const first=page.locator("#fit-first");
  expect(await first.evaluate(canvas=>[canvas.width,canvas.height])).toEqual([600,600]);
  let box=await first.boundingBox();
  await page.mouse.click(box.x+130,box.y+80);
  await expect.poll(()=>page.evaluate(()=>fitFixture.links)).toEqual(["https://example.invalid/fit-a"]);
  await page.mouse.click(box.x+105,box.y+80);
  expect(await page.evaluate(()=>fitFixture.links)).toHaveLength(1);
  await page.evaluate(()=>{document.querySelector("#fit-second").style.display="none";const canvas=document.querySelector("#fit-first");canvas.style.transformOrigin="0 0";canvas.style.transform="scale(2,.5)";});
  box=await first.boundingBox();
  await page.mouse.click(box.x+260,box.y+40);
  await expect.poll(()=>page.evaluate(()=>fitFixture.links)).toHaveLength(2);
  const rejected=await page.evaluate(async()=>{
    const canvas=document.createElement("canvas");canvas.style="width:300px;height:300px";document.body.append(canvas);
    const before=fitFixture.runtime.players.size;
    try{await fitFixture.runtime.createPlayer({program:fitFixture.program,canvas,fit:"stretch",clock:"manual"});throw Error("Expected invalid mode");}
    catch(error){if(!String(error).includes("fit must be"))throw error;}
    const untouched=fitFixture.runtime.players.size===before;
    const player=await fitFixture.runtime.createPlayer({program:fitFixture.program,canvas,fit:"contain",clock:"manual"});
    player.dispose();canvas.remove();
    const state=fitFixture.player.getState(),camera=fitFixture.player.getCamera();
    try{fitFixture.player.fitView(null);throw Error("Expected invalid mode");}catch(error){if(!String(error).includes("fit must be"))throw error;}
    try{fitFixture.player.resize(1e9,1e9);throw Error("Expected budget rejection");}catch(error){if(error.code!=="ResourceLimit")throw error;}
    return {untouched,unchanged:JSON.stringify(state)===JSON.stringify(fitFixture.player.getState()),camera,after:fitFixture.player.getCamera(),size:[document.querySelector("#fit-first").width,document.querySelector("#fit-first").height]};
  });
  expect(rejected).toEqual({untouched:true,unchanged:true,camera:{center:[500,110],scale:[1.5,3]},after:{center:[500,110],scale:[1.5,3]},size:[600,600]});
  await page.evaluate(()=>fitFixture.runtime.dispose());
});

test("different-aspect fill transitions keep endpoint cameras and paused resize state",async({page})=>{
  await loadFit(page,{scale:2,transitionMarkers:true});
  const first=page.locator("#fit-first"),second=page.locator("#fit-second");
  await page.evaluate(()=>{fitFixture.player.sendKey("N");fitFixture.other.sendKey("N");fitFixture.player.advanceBy(500);fitFixture.other.advanceBy(500);});
  const midpoint=await first.screenshot({scale:"css"});
  assert.deepEqual(midpoint,await second.screenshot({scale:"css"}));
  for (const [point,color] of [[[130,160],[128,0,0,255]],[[160,130],[0,0,128,255]],[[130,130],[128,0,128,255]]]) {
    pixel(midpoint,...point).forEach((channel,index)=>expect(Math.abs(channel-color[index])).toBeLessThanOrEqual(1));
  }
  const resized=await page.evaluate(()=>{
    for (const [player,id] of [[fitFixture.player,"fit-first"],[fitFixture.other,"fit-second"]]) {
      player.pausePlayback();const canvas=document.getElementById(id);canvas.style.width="400px";canvas.style.height="200px";player.resize(400,200,2);
    }
    return {state:fitFixture.player.getState(),camera:fitFixture.player.getCamera(),size:[document.querySelector("#fit-first").width,document.querySelector("#fit-first").height]};
  });
  expect(resized.state.clockMs).toBe(500);expect(resized.state.schedule.paused).toBe(true);
  expect(resized.camera).toEqual({center:[950,160],scale:[4,1]});expect(resized.size).toEqual([800,400]);
  assert.deepEqual(await first.screenshot({scale:"css"}),await second.screenshot({scale:"css"}));
  await page.evaluate(()=>{for(const player of [fitFixture.player,fitFixture.other]){player.resumePlayback();player.advanceBy(500);player.back();player.advanceBy(1000);}});
  expect(await page.evaluate(()=>fitFixture.player.getCamera())).toEqual({center:[500,110],scale:[2,2]});
  expect(await page.evaluate(()=>fitFixture.player.getState().metrics.wholeFrameReadbacks)).toBe(0);
  await page.evaluate(()=>fitFixture.runtime.dispose());
});

test("fill overlays inherit both scales and moving incoming hits follow their displayed position",async({page})=>{
  await loadFit(page,{transition:{kind:"move_in",direction:"left"}});
  await page.evaluate(()=>{fitFixture.player.sendKey("O");fitFixture.other.sendKey("O");});
  const overlay=await page.locator("#fit-first").screenshot({scale:"css"});
  assert.deepEqual(overlay,await page.locator("#fit-second").screenshot({scale:"css"}));
  assert.deepEqual(pixel(overlay,150,175),[0,255,0,255]);assert.deepEqual(pixel(overlay,150,115),[0,0,0,255]);
  let box=await page.locator("#fit-first").boundingBox();
  await page.mouse.click(box.x+150,box.y+175);
  await expect.poll(()=>page.evaluate(()=>fitFixture.links)).toEqual(["https://example.invalid/fit-overlay"]);
  await page.mouse.click(box.x+150,box.y+115);
  expect(await page.evaluate(()=>fitFixture.player.getState().overlayFrames)).toEqual([]);
  await page.evaluate(()=>{fitFixture.player.sendKey("N");fitFixture.player.sendPointer({type:"click",x:15,y:135});});
  expect(await page.evaluate(()=>fitFixture.links)).toHaveLength(1);
  await page.evaluate(()=>fitFixture.player.advanceBy(500));
  assert.deepEqual(pixel(await page.locator("#fit-first").screenshot({scale:"css"}),15,135),[0,0,255,255]);
  box=await page.locator("#fit-first").boundingBox();
  await page.mouse.click(box.x+15,box.y+135);
  await expect.poll(()=>page.evaluate(()=>fitFixture.links)).toEqual(["https://example.invalid/fit-overlay","https://example.invalid/fit-b"]);
  await page.mouse.click(box.x+150,box.y+135);
  expect(await page.evaluate(()=>fitFixture.links)).toHaveLength(2);
  expect(await page.evaluate(()=>fitFixture.player.getState().metrics.wholeFrameReadbacks)).toBe(0);
  await page.evaluate(()=>fitFixture.runtime.dispose());
});

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
    fixture.reuse=await fixture.runtime.createPlayer({program:fixture.program,canvas:fixture.canvas("reuse"),clock:"manual"});
  });
  const reusable=await page.locator("#reuse").screenshot();
  const reuse=await page.evaluate(async()=>{
    const canvas=document.getElementById("reuse");
    fixture.reuse.dispose();
    const pending=fixture.runtime.createPlayer({program:fixture.program,canvas,clock:"manual"});
    let reserved=false;
    try{await fixture.runtime.createPlayer({program:fixture.program,canvas,clock:"manual"});}
    catch(error){if(error.code!=="CanvasInUse")throw error;reserved=true;}
    fixture.reuse=await pending;
    return {reserved,live:!canvas.getContext("webgl2").isContextLost()};
  });
  expect(reuse).toEqual({reserved:true,live:true});
  assert.deepEqual(reusable,await page.locator("#reuse").screenshot());
  await page.evaluate(()=>{fixture.reuse.dispose();document.getElementById("reuse").remove();});
  for(let index=0;index<20;index++){
    await page.evaluate(async()=>{
      const canvas=fixture.canvas("cycle");
      const player=await fixture.runtime.createPlayer({program:fixture.program,canvas,clock:"manual"});
      const released=new Promise(resolve=>canvas.addEventListener("webglcontextlost",()=>setTimeout(resolve,0),{once:true}));
      fixture.disposed={canvas:new WeakRef(canvas),player:new WeakRef(player)};
      player.playClip(fixture.ids.clip);player.advanceBy(20);player.dispose();canvas.remove();
      await released;
    });
    // WebKit counts lost context objects until GC, even after the GPU resources are released.
    await expect(async()=>{
      await page.requestGC();
      expect(await page.evaluate(()=>({canvas:!!fixture.disposed.canvas.deref(),player:!!fixture.disposed.player.deref()}))).toEqual({canvas:false,player:false});
    }).toPass({intervals:[50,100,200],timeout:5000});
  }
  expect(await page.evaluate(()=>fixture.runtime.players.size)).toBe(3);
  expect(await page.locator("#first").evaluate(canvas=>canvas.getContext("webgl2").isContextLost())).toBe(false);
  assert.deepEqual(original,await page.locator("#first").screenshot());
  await page.evaluate(()=>fixture.runtime.dispose());
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
