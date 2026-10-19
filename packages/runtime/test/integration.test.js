import assert from "node:assert/strict";
import {test} from "node:test";
import {readFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {createRuntime} from "../src/index.js";
import {exampleSource,fitSource,ids} from "../examples/source.js";

test("source and deterministic bundles run the same Rust prototype in independent players",async()=>{
  const runtime=await createRuntime();
  try {
    const program=await runtime.compileSource(exampleSource({delay:500}));
    assert.deepEqual(program.toBundle(),program.toBundle());
    const loaded=await runtime.loadBundle(program.toBundle());
    const first=await runtime.createPlayer({program,width:320,height:180});
    const second=await runtime.createPlayer({program:loaded,width:320,height:180});
    assert.equal(first.getState().currentFrame,ids.home);
    assert.equal(first.getState().schedule.nextDeadlineMs,500);
    first.advanceBy(500);
    assert.equal(first.getState().currentFrame,ids.done);
    assert.equal(second.getState().currentFrame,ids.home);
    second.advanceBy(250);second.advanceBy(250);
    assert.deepEqual(first.getState(),second.getState());
    program.dispose();
    first.restart();
    assert.equal(first.getState().currentFrame,ids.home);
  }finally{runtime.dispose();}
});

test("a page camera pans, zooms around a point, and refits without changing prototype state",async()=>{
  const runtime=await createRuntime();
  try{
    const program=await runtime.compileSource(exampleSource({delay:5000}));
    const player=await runtime.createPlayer({program,width:320,height:180,start:ids.page});
    const before=player.getState();
    assert.equal(before.currentFrame,ids.page);
    const fitted=player.getViewport();
    player.panBy(40,-20);
    const panned=player.getViewport();
    assert.equal(panned.zoom,fitted.zoom);
    assert.ok(Math.abs((fitted.center[0]-panned.center[0])*fitted.zoom-40)<1e-9);
    assert.ok(Math.abs((fitted.center[1]-panned.center[1])*fitted.zoom+20)<1e-9);
    player.zoomAt(160,90,2);
    assert.ok(Math.abs(player.getViewport().zoom-panned.zoom*2)<1e-9);
    assert.ok(Math.hypot(player.getViewport().center[0]-panned.center[0],player.getViewport().center[1]-panned.center[1])<1e-9);
    assert.throws(()=>player.zoomAt(0,0,0),/camera input/);
    assert.throws(()=>player.panBy(Number.NaN,0),/invalid type/);
    player.fitView();
    assert.deepEqual(player.getViewport(),fitted);
    const after=player.getState();
    assert.equal(after.currentFrame,before.currentFrame);
    assert.equal(after.clockMs,before.clockMs);
    assert.deepEqual(after.schedule,before.schedule);
  }finally{runtime.dispose();}
});

test("fit policies use independent two-axis cameras for source, bundles, input, and paused resize",async()=>{
  const runtime=await createRuntime();
  try {
    const program=await runtime.compileSource(fitSource());
    const authored=program.toBundle();
    const loaded=await runtime.loadBundle(authored);
    for (const input of [program,loaded]) {
      const other=await runtime.createPlayer({program:input,width:300,height:300});
      assert.deepEqual(other.getCamera(),{center:[500,110],scale:[1.5,1.5]});
      for (const [fit,scale,hit] of [["contain",[1.5,1.5],[130,125]],["cover",[3,3],[105,80]],["fill",[1.5,3],[130,80]]]) {
        const player=await runtime.createPlayer({program:input,width:300,height:300,fit});
        assert.deepEqual(player.getCamera(),{center:[500,110],scale});
        assert.equal(player.getState().fitMode,fit);
        assert.equal(player.getViewport().zoom,Math.min(...scale));
        const links=[];player.on("link",event=>links.push(event.url));
        player.sendPointer({type:"click",x:hit[0],y:hit[1]});
        await Promise.resolve();
        assert.deepEqual(links,["https://example.invalid/fit-a"]);
        player.sendPointer({type:"click",x:20,y:20});
        await Promise.resolve();assert.equal(links.length,1);
        const before=player.getState();
        for (const mode of [null,false,1,[],{},{contain:null},"Fill","stretch"]) {
          assert.throws(()=>player.raw("fit",{mode}),/invalid|variant|expected|fit mode/i);
          assert.deepEqual(player.getState(),before);
        }
        player.fitView("fill");
        player.zoomAt(60,90,2);
        assert.deepEqual(player.getCamera(),{center:[470,100],scale:[3,6]});
        player.panBy(30,-12);
        assert.deepEqual(player.getCamera(),{center:[460,102],scale:[3,6]});
        player.fitView();
        assert.deepEqual(player.getCamera(),{center:[500,110],scale:[1.5,3]});
        player.playClip(ids.clip);
        const advanced=player.advanceBy(250);
        assert.deepEqual(advanced.camera,player.getCamera());
        assert.equal(advanced.fitMode,"fill");
        player.pausePlayback();
        const paused=player.getState();
        const resized=player.resize(400,200,2);
        assert.deepEqual(resized.camera,{center:[500,110],scale:[2,2]});
        assert.equal(resized.fitMode,"fill");
        resized.camera.center[0]=0;
        assert.deepEqual(player.getCamera(),{center:[500,110],scale:[2,2]});
        assert.equal(player.getFitMode(),"fill");
        assert.equal(player.getState().clockMs,paused.clockMs);
        assert.deepEqual(player.getState().clip,paused.clip);
        assert.deepEqual(player.getState().schedule,paused.schedule);
        assert.deepEqual(other.getCamera(),{center:[500,110],scale:[1.5,1.5]});
        player.dispose();
      }
      other.dispose();
    }
    const baseline=await runtime.createPlayer({program,width:300,height:300});
    for (const fit of [null,false,1,[],{},{contain:null},"Fill","stretch"]) {
      assert.throws(()=>runtime.transport.request({operation:"createPlayer",program:program.handle,width:300,height:300,start:null,fit}),/Invalid argument fit/);
    }
    const next=await runtime.createPlayer({program,width:300,height:300,fit:"fill"});
    assert.equal(next.handle,baseline.handle+1,"rejected creation consumed a handle");
    assert.deepEqual(program.toBundle(),authored);
  } finally { runtime.dispose(); }
});

test("motion controls hold final samples, seek independently, pause, and emit completion",async()=>{
  const runtime=await createRuntime();
  try{
    const program=await runtime.compileSource(exampleSource({delay:5000}));
    const player=await runtime.createPlayer({program});
    const completed=[];player.on("clipCompleted",event=>completed.push(event.clip));
    player.playClip(ids.clip);
    const authored=program.toBundle();
    player.advanceBy(500);
    assert.equal(player.getState().clip.playheadMs,500);
    assert.equal(player.inspect().nodes.find(node=>node.occurrence.node===ids.target).transform[4],124);
    player.pauseClip();player.advanceBy(500);
    assert.equal(player.getState().clip.playheadMs,500);
    player.seekClip(750);
    assert.equal(player.getState().clockMs,1000);
    assert.equal(player.getState().clip.playheadMs,750);
    player.resumeClip();player.advanceBy(250);
    await Promise.resolve();assert.deepEqual(completed,[ids.clip]);
    assert.equal(player.getState().clip.running,false);
    player.stopClip();assert.equal(player.getState().clip,null);
    player.playClip(ids.clip,{mode:"pingPong"});player.advanceBy(1500);
    assert.equal(player.getState().clip.playheadMs,500);
    assert.throws(()=>player.advanceBy(NaN),/finite/);
    assert.throws(()=>player.seekClip(-1),/playhead/i);
    assert.deepEqual(program.toBundle(),authored);
    player.pausePlayback();const paused=player.getState().clockMs;player.advanceBy(20);assert.equal(player.getState().clockMs,paused);
    player.resumePlayback();player.advanceBy(20);assert.equal(player.getState().clockMs,paused+20);
    player.resize(1e7,1e7);assert.equal(player.getState().currentFrame,ids.home);
  }finally{runtime.dispose();}
});

test("clip playback uses the authored loop mode unless the host overrides it",async()=>{
  const runtime=await createRuntime();
  try{
    const source=exampleSource({delay:10000});
    const motion=JSON.parse(source.files["doc/motion.json"]);
    motion.clips[ids.clip].loop_mode="repeat";
    source.files["doc/motion.json"]=JSON.stringify(motion);
    const program=await runtime.compileSource(source);
    const player=await runtime.createPlayer({program});
    player.playClip(ids.clip);player.advanceBy(1500);
    assert.equal(player.getState().clip.mode,"repeat");
    assert.equal(player.getState().clip.playheadMs,500);
    assert.equal(player.getState().clip.running,true);
    player.playClip(ids.clip,{mode:"once"});player.advanceBy(1500);
    assert.equal(player.getState().clip.mode,"once");
    assert.equal(player.getState().clip.playheadMs,1000);
    assert.equal(player.getState().clip.running,false);
  }finally{runtime.dispose();}
});

test("automatic mode binding preserves authored choices, defaults, and independent sessions",async()=>{
  const runtime=await createRuntime();
  const theme="00000000000000000000000070",light="00000000000000000000000071",dark="00000000000000000000000072",opacity="00000000000000000000000073";
  const fallback="00000000000000000000000074",normal="00000000000000000000000075",frameOpacity="00000000000000000000000076",empty="00000000000000000000000077";
  try{
    const original=await runtime.compileSource(exampleSource({delay:10000}));
    const document=original.inspect();
    document.variables={collections:{
      [theme]:{id:theme,name:"Theme",modes:[{id:light,name:"Light"},{id:dark,name:"Dark"}],default_mode:light},
      [fallback]:{id:fallback,name:"Defaults",modes:[{id:normal,name:"Normal"}],default_mode:normal},
      [empty]:{id:empty,name:"Empty",modes:[],default_mode:"00000000000000000000000000"},
    },variables:{
      [opacity]:{id:opacity,collection:theme,name:"Opacity",ty:"float",values_by_mode:{[light]:{kind:"float",value:0.25},[dark]:{kind:"float",value:0.75}}},
      [frameOpacity]:{id:frameOpacity,collection:fallback,name:"Opacity",ty:"float",values_by_mode:{[normal]:{kind:"float",value:0.5}}},
    }};
    document.active_modes={[theme]:dark};
    const nodes=Object.values(document.scene.nodes);
    nodes.find(node=>node.id===ids.target).bindings=[[{prop:"opacity"},opacity]];
    nodes.find(node=>node.id===ids.home).bindings=[[{prop:"opacity"},frameOpacity]];
    const program=await runtime.compileSource({files:{"doc.json":JSON.stringify(document)}});
    const authored=program.toBundle();
    const player=await runtime.createPlayer({program});
    const manual=await runtime.createPlayer({program,autoBind:false});
    const inspection=player.inspect();
    assert.deepEqual(inspection.activeModes,{[theme]:dark,[fallback]:normal});
    assert.equal(inspection.nodes.find(node=>node.occurrence.node===ids.target).opacity,0.75);
    assert.equal(inspection.nodes.find(node=>node.occurrence.node===ids.home).opacity,0.5);
    assert.deepEqual(manual.inspect().activeModes,{[theme]:dark});
    assert.equal(manual.inspect().nodes.find(node=>node.occurrence.node===ids.home).opacity,0.5);
    player.setMode(theme,light);
    assert.equal(player.inspect().nodes.find(node=>node.occurrence.node===ids.target).opacity,0.25);
    assert.equal(manual.inspect().nodes.find(node=>node.occurrence.node===ids.target).opacity,0.75);
    player.restart();
    assert.deepEqual(player.inspect().activeModes,{[theme]:dark,[fallback]:normal});
    assert.deepEqual(program.toBundle(),authored);
    assert.throws(()=>player.resizeDrawingSurfaceToCanvas(),/requires a canvas/);
    await assert.rejects(runtime.createPlayer({program,autoBind:"true"}),/must be a boolean/);
  }finally{runtime.dispose();}
});

test("supplied font bytes survive bundles; missing fonts and missing IDs are reported",async()=>{
  const runtime=await createRuntime();
  try{
    const source=exampleSource({text:true});
    await assert.rejects(runtime.compileSource(source),/Missing font/);
    source.fonts=[{family:"Runtime Sans",weight:400,bytes:new Uint8Array(await readFile(new URL("../../../fixtures/fonts/source-sans-3/SourceSans3-Variable.ttf",import.meta.url)))}];
    for (const invalid of [{weight:-1},{weight:"400"},{italic:"false"},{faceIndex:1.5}]) {
      await assert.rejects(runtime.compileSource({...source,fonts:[{...source.fonts[0],...invalid}]}),/Invalid argument/);
    }
    const program=await runtime.compileSource(source);
    const loaded=await runtime.loadBundle(program.toBundle());
    const player=await runtime.createPlayer({program:loaded});
    assert.equal(player.getState().currentFrame,ids.home);
    const unknownMotionFont=structuredClone(source);
    const motion=JSON.parse(unknownMotionFont.files["doc/motion.json"]);
    const track=Object.values(motion.clips[ids.clip].tracks)[0];
    track.target={node:ids.label,property:{kind:"bound",prop:{prop:"text_style"}}};
    for(const keyframe of Object.values(track.keyframes))keyframe.value={kind:"text_style",value:{font_family:"Unsupplied Motion Font"}};
    unknownMotionFont.files["doc/motion.json"]=JSON.stringify(motion);
    await assert.rejects(runtime.compileSource(unknownMotionFont),/Missing font/);
    const invalid=exampleSource();
    invalid.files["pages/demo/page.fnx"]=invalid.files["pages/demo/page.fnx"].replace(`id="${ids.target}"`,"");
    await assert.rejects(runtime.compileSource(invalid),/authoritative id/);
    const malformed=exampleSource();malformed.files["doc/motion.json"]="{}oops";
    await assert.rejects(runtime.compileSource(malformed),/motion.json/);
  }finally{runtime.dispose();}
});

test("native and WASM command states, geometry, and events have exact parity",async(t)=>{
  const executable=process.env.FANTA_NATIVE_FIXTURE??fileURLToPath(new URL("../../../.engine/fanta-edit/target/debug/examples/playback_fixture",import.meta.url));
  if(!existsSync(executable)){if(process.env.FANTA_NATIVE_FIXTURE)assert.fail(`Missing native fixture ${executable}`);t.skip("Build cargo example playback_fixture to run native parity");return;}
  const source=exampleSource({delay:1000});
  const commands=[
    {command:"state"},{command:"inspect"},
    {command:"playClip",arguments:{clip:ids.clip,mode:"once",scope:null}},
    {command:"advanceBy",arguments:{deltaMs:250}},
    {command:"inspect"},{command:"pauseClip"},
    {command:"advanceBy",arguments:{deltaMs:250}},
    {command:"seekClip",arguments:{timeMs:750}},
    {command:"resumeClip"},{command:"advanceBy",arguments:{deltaMs:250}},
    {command:"advanceBy",arguments:{deltaMs:500}},{command:"state"},
    {command:"pan",arguments:{delta:[12,-8]}},{command:"zoom",arguments:{point:[40,30],factor:1.5}},{command:"fit"},
    {command:"back"},{command:"cancelPointer"},{command:"restart"},
  ].map(command=>({...command,arguments:command.arguments??{}}));
  const native=spawnSync(executable,{input:JSON.stringify({source:{files:Object.fromEntries(Object.entries(source.files).map(([path,value])=>[path,[...new TextEncoder().encode(value)]]))},commands}),encoding:"utf8"});
  assert.equal(native.status,0,native.stderr);
  const expected=JSON.parse(native.stdout);
  const runtime=await createRuntime();
  try{
    const program=await runtime.compileSource(source);
    for(const input of [program,await runtime.loadBundle(program.toBundle())]){
      const player=await runtime.createPlayer({program:input,width:320,height:180});
      const results=commands.map(({command,arguments:arguments_})=>player.raw(command,arguments_));
      assert.deepEqual(results,expected);
      player.dispose();
    }
  }finally{runtime.dispose();}
});

test("native and WASM fit cameras agree through overlays, different-aspect navigation, and paused resize",async(t)=>{
  const executable=process.env.FANTA_NATIVE_FIXTURE??fileURLToPath(new URL("../../../.engine/fanta-edit/target/debug/examples/playback_fixture",import.meta.url));
  if(!existsSync(executable)){if(process.env.FANTA_NATIVE_FIXTURE)assert.fail(`Missing native fixture ${executable}`);t.skip("Build cargo example playback_fixture to run native parity");return;}
  const source=fitSource();
  const commands=[
    {command:"state"},{command:"inspect"},
    {command:"pointer",arguments:{type:"click",point:[130,80]}},
    {command:"key",arguments:{key:"O"}},{command:"state"},
    {command:"pointer",arguments:{type:"click",point:[150,175]}},
    {command:"pointer",arguments:{type:"click",point:[150,115]}},
    {command:"pan",arguments:{delta:[30,-12]}},
    {command:"zoom",arguments:{point:[60,90],factor:2}},
    {command:"fit",arguments:{mode:"cover"}},{command:"fit",arguments:{mode:"fill"}},
    {command:"key",arguments:{key:"N"}},{command:"advanceBy",arguments:{deltaMs:250}},
    {command:"pausePlayback"},{command:"resize",arguments:{width:400,height:200,scale:2}},
    {command:"inspect"},{command:"resumePlayback"},{command:"advanceBy",arguments:{deltaMs:750}},
    {command:"back"},{command:"advanceBy",arguments:{deltaMs:1000}},{command:"restart"},
  ].map(command=>({...command,arguments:command.arguments??{}}));
  const runtime=await createRuntime();
  try {
    const program=await runtime.compileSource(source);
    for (const fit of ["contain","cover","fill"]) {
      const options={width:300,height:300,fit};
      const native=spawnSync(executable,{input:JSON.stringify({source:{files:Object.fromEntries(Object.entries(source.files).map(([path,value])=>[path,[...new TextEncoder().encode(value)]]))},options,commands}),encoding:"utf8"});
      assert.equal(native.status,0,native.stderr);
      const expected=JSON.parse(native.stdout);
      for (const input of [program,await runtime.loadBundle(program.toBundle())]) {
        const player=await runtime.createPlayer({program:input,...options});
        assert.deepEqual(commands.map(({command,arguments:arguments_})=>player.raw(command,arguments_)),expected);
        player.dispose();
      }
    }
  } finally { runtime.dispose(); }
});

test("component clips require an occurrence and update only the selected placement",async()=>{
  const runtime=await createRuntime();
  const component="00000000000000000000000060",master="00000000000000000000000061",left="00000000000000000000000062",right="00000000000000000000000063";
  try{
    const source=exampleSource({delay:10000});
    source.files["components/card/def.json"]=JSON.stringify({id:component,root:master,name:"Card"});
    source.files["components/card/component.fnx"]=`import "../../styles/project.fss"; <Frame id="${master}" name="Card" width={64} height={64}><Frame id="${ids.target}" name="Tile" class="s_00000000000000000000000040" width={32} height={32}/></Frame>`;
    source.files["pages/demo/page.fnx"]=source.files["pages/demo/page.fnx"].replace(/<Frame id="00000000000000000000000003"[^>]*\/>/,`<Instance id="${left}" name="Left card" component="Card" x={24} y={32} width={64} height={64}/><Instance id="${right}" name="Right card" component="Card" x={140} y={32} width={64} height={64}/>`);
    const motion=JSON.parse(source.files["doc/motion.json"]);
    const track=Object.values(motion.clips[ids.clip].tracks)[0];
    Object.values(track.keyframes)[0].value.value=0;Object.values(track.keyframes)[1].value.value=32;
    source.files["doc/motion.json"]=JSON.stringify(motion);
    const program=await runtime.compileSource(source);
    const player=await runtime.createPlayer({program,width:320,height:180});
    assert.throws(()=>player.playClip(ids.clip),/scope|ambiguous/i);
    const scope=player.getState().occurrences.find(occurrence=>occurrence.node===left);
    player.playClip(ids.clip,{scope});player.advanceBy(500);
    const targets=player.inspect().nodes.filter(node=>node.occurrence.node===ids.target);
    assert.equal(targets.length,2);
    assert.equal(targets.find(node=>node.occurrence.instancePath[0]===left).transform[4],16);
    assert.equal(targets.find(node=>node.occurrence.instancePath[0]===right).transform[4],0);
    const before=player.getState().clip;
    assert.throws(()=>player.playClip(ids.clip,{scope:{...scope,layer:999}}),/scope|target/i);
    assert.deepEqual(player.getState().clip,before);
    const zero=structuredClone(source);const zeroMotion=JSON.parse(zero.files["doc/motion.json"]);
    const zeroClip=zeroMotion.clips[ids.clip];zeroClip.duration_ms=0;
    const zeroTrack=Object.values(zeroClip.tracks)[0];zeroTrack.keyframes={"00000000000000000000000011":{id:"00000000000000000000000011",time_ms:0,value:{kind:"float",value:32},interpolation:"linear",easing:"linear"}};
    zero.files["doc/motion.json"]=JSON.stringify(zeroMotion);
    const zeroProgram=await runtime.compileSource(zero);const zeroPlayer=await runtime.createPlayer({program:zeroProgram});
    const zeroScope=zeroPlayer.getState().occurrences.find(occurrence=>occurrence.node===left);
    zeroPlayer.playClip(ids.clip,{scope:zeroScope,mode:"repeat"});
    assert.equal(zeroPlayer.getState().schedule.continuous,false);assert.equal(zeroPlayer.getState().clip.running,false);
    assert.equal(zeroPlayer.inspect().nodes.find(node=>node.occurrence.node===ids.target&&node.occurrence.instancePath[0]===left).transform[4],32);
  }finally{runtime.dispose();}
});
