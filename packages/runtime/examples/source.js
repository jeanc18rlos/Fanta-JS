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
