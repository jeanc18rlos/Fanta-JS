import {useEffect,useRef,useState} from "react";
import {createRuntime} from "@jeanc18rlos/runtime";

export function FantaPrototype({bundle}) {
  const canvas=useRef(null);
  const [error,setError]=useState(null);
  useEffect(()=>{
    let cancelled=false;
    let runtime;
    async function mount(){
      runtime=await createRuntime();
      if(cancelled){runtime.dispose();return;}
      const program=await runtime.loadBundle(bundle);
      if(cancelled){runtime.dispose();return;}
      const player=await runtime.createPlayer({program,canvas:canvas.current});
      if(cancelled){runtime.dispose();return;}
      player.on("error",failure=>setError(failure.message));
    }
    mount().catch(failure=>{runtime?.dispose();if(!cancelled)setError(failure.message);});
    return()=>{cancelled=true;runtime?.dispose();};
  },[bundle]);
  return <><canvas ref={canvas} style={{width:"100%",height:450}} aria-label="Prototype"/>{error&&<p role="alert">{error}</p>}</>;
}
