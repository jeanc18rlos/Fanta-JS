export const ids = {
  page: "00000000000000000000000001",
  home: "00000000000000000000000002",
  target: "00000000000000000000000003",
  done: "00000000000000000000000004",
  label: "00000000000000000000000005",
  clip: "00000000000000000000000010",
};

function frameTrigger(delay) {
  return [{ id: "00000000000000000000000020", trigger: {kind:"after_delay",delay_ms:delay}, action:{kind:"navigate",to:ids.done}, transition:{style:{kind:"dissolve"},duration_ms:300,easing:"ease_in_out"} }];
}

export function exampleSource({delay = 2000, text = false, graphics = false} = {}) {
  const values = new Map([
    ["00000000000000000000000011", {time_ms:0,value:{kind:"float",value:24}}],
    ["00000000000000000000000012", {time_ms:1000,value:{kind:"float",value:224}}],
  ]);
  const keyframes = Object.fromEntries([...values].map(([id,value])=>[id,{id,...value,interpolation:"linear",easing:"linear"}]));
  const source = {
    files: {
      "fanta.json": JSON.stringify({format:"fanta-project",version:6,schema_version:4,project_id:"d_00000000000000000000000030"}),
      "doc/metadata.json": JSON.stringify({title:"Runtime example",created_at:0,modified_at:0}),
      "doc/flow_start.json": JSON.stringify(ids.home),
      "doc/flows.json": JSON.stringify([{name:"Demo",start:ids.home}]),
      "pages/demo/page.json": JSON.stringify({id:ids.page,order:0}),
      "styles/project.fss": `.s_00000000000000000000000040 { fill: #4058EF; corner-radius: 16; }
.s_00000000000000000000000041 { fill: #FFFFFF; font-family: "Runtime Sans"; font-size: 28; }`,
      "pages/demo/page.fnx": `import "../../styles/project.fss";
<Frame id="${ids.page}" name="Demo">
  <Frame id="${ids.home}" name="Home" width={320} height={180} background={{"kind":"solid","color":fnxColor("#172033")}} reactions={${JSON.stringify(frameTrigger(delay))}}>
    <Frame id="${ids.target}" name="Moving card" class="s_00000000000000000000000040" x={24} y={32} width={64} height={64} />
    ${text ? `<Text id="${ids.label}" name="Label" content="FNX + FSS" class="s_00000000000000000000000041" x={24} y={110} />` : ""}
    ${graphics ? `<Image id="00000000000000000000000050" name="Image" asset="00000000000000000000000051" x={112} y={24} width={40} height={40} natural_size={[1,1]} />
    <Frame id="00000000000000000000000052" name="Masked" x={200} y={24} width={60} height={60}>
      <Frame id="00000000000000000000000053" name="Mask" width={30} height={60} background={{"kind":"solid","color":fnxColor("#FFFFFF")}} is_mask={true} />
      <Frame id="00000000000000000000000054" name="Masked color" width={60} height={60} background={{"kind":"solid","color":fnxColor("#F39829")}} />
    </Frame>
    <Frame id="00000000000000000000000055" name="Blur" x={280} y={24} width={16} height={16} background={{"kind":"solid","color":fnxColor("#FFFFFF")}} blurs={[{"kind":"layer","radius":4}]} />` : ""}
  </Frame>
  <Frame id="${ids.done}" name="Done" x={400} width={320} height={180} background={{"kind":"solid","color":fnxColor("#1A8165")}} />
</Frame>`,
      "doc/motion.json": JSON.stringify({clips:{[ids.clip]:{id:ids.clip,name:"Card slide",duration_ms:1000,tracks:{"00000000000000000000000013":{id:"00000000000000000000000013",target:{node:ids.target,property:{kind:"position_x"}},keyframes}}}}}),
    },
  };
  if (graphics) source.files["assets/a_00000000000000000000000051.bin"] = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWN4aO74HwAFrwJZBIYpiwAAAABJRU5ErkJggg=="),character=>character.charCodeAt(0));
  return source;
}

export const fitIds = { ...ids, marker:"00000000000000000000000080", incoming:"00000000000000000000000081", overlay:"00000000000000000000000082" };

export function fitSource({transition = {kind:"dissolve"}, delay = 10000, transitionMarkers = false} = {}) {
  const source = exampleSource({delay});
  const navigate = {action:{kind:"navigate",to:ids.done},transition:{style:transition,duration_ms:1000,easing:"linear"}};
  const reactions = [
    {id:"00000000000000000000000020",trigger:{kind:"key",keys:["N"]},...navigate},
    {id:"00000000000000000000000021",trigger:{kind:"after_delay",delay_ms:delay},...navigate},
    {id:"00000000000000000000000022",trigger:{kind:"key",keys:["O"]},action:{kind:"open_overlay",frame:fitIds.overlay,overlay:{position:{kind:"center"},background_dim:false,close_on_click_outside:true}}},
  ];
  const link = (id,url) => JSON.stringify([{id,trigger:{kind:"click"},action:{kind:"open_link",url}}]);
  source.files["doc/presentation.json"] = JSON.stringify({frame_color:{r:255,g:255,b:255,a:255}});
  source.files["pages/demo/page.fnx"] = `<Frame id="${ids.page}" name="Fit geometry">
    <Frame id="${ids.home}" name="Wide" x={400} y={60} width={200} height={100} background={{"kind":"solid","color":fnxColor("#000000")}} reactions={${JSON.stringify(reactions)}}>
      <Frame id="${ids.target}" name="Hit" x={80} y={20} width={20} height={20} background={{"kind":"solid","color":fnxColor("#FF0000")}} reactions={${link("00000000000000000000000023","https://example.invalid/fit-a")}} />
      ${transitionMarkers ? `<Frame id="${fitIds.marker}" name="Outgoing marker" x={80} y={40} width={20} height={20} background={{"kind":"solid","color":fnxColor("#FF0000")}} />` : ""}
    </Frame>
    <Frame id="${ids.done}" name="Tall" x={900} y={60} width={100} height={200} background={{"kind":"solid","color":fnxColor("#000000")}}>
      <Frame id="${fitIds.incoming}" name="Incoming marker" x={40} y={80} width={20} height={20} background={{"kind":"solid","color":fnxColor("#0000FF")}} reactions={${link("00000000000000000000000024","https://example.invalid/fit-b")}} />
    </Frame>
    <Frame id="${fitIds.overlay}" name="Overlay" x={1400} y={60} width={40} height={20} background={{"kind":"solid","color":fnxColor("#00FF00")}} reactions={${link("00000000000000000000000025","https://example.invalid/fit-overlay")}} />
  </Frame>`;
  const motion = JSON.parse(source.files["doc/motion.json"]);
  const keyframes = Object.values(Object.values(motion.clips[ids.clip].tracks)[0].keyframes);
  keyframes[0].value.value = 80;
  keyframes[1].value.value = 100;
  source.files["doc/motion.json"] = JSON.stringify(motion);
  return source;
}
