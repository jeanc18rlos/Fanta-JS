export type Resource = string | Uint8Array | ArrayBuffer;
export type Identity = string;
export interface Font { family: string; weight?: number; italic?: boolean; faceIndex?:number; bytes: Resource; }
export interface SourceBundle { files: Record<string, Resource>; fonts?: Font[]; fontSubstitutions?: Record<string, string>; }
export interface Occurrence { layer: number; node: Identity; instancePath: Identity[]; definitionPath: Identity[]; }
export interface Diagnostic { code: string; message: string; path?: string; }
export interface Flow { name: string; start: Identity; }
export interface Clip { id: Identity; name: string; durationMs: number; }
export interface Schedule { continuous: boolean; nextDeadlineMs: number | null; paused: boolean; timersSuspended: boolean; }
export interface Viewport { center: [number, number]; zoom: number; }
export interface PlaybackState {
  currentFrame: Identity; currentLayer: number; overlayFrames: Identity[]; clockMs: number;
  clip: { clip: Identity; playheadMs: number | null; mode: "once" | "repeat" | "pingPong"; paused: boolean; running: boolean; scope: Occurrence | null } | null;
  schedule: Schedule; occurrences?: Occurrence[]; metrics?: { wholeFrameReadbacks: number; frameMicros?:number; renderedLayers?:number; peakSurfaceBytes?:number };
}
export type VariableValue = {kind:"float";value:number} | {kind:"color";value:{r:number;g:number;b:number;a:number}} | {kind:"boolean";value:boolean} | {kind:"string";value:string} | {kind:"text_style";value:Record<string,unknown>} | {kind:"alias";variable:Identity};
export interface Program {
  readonly flows: Flow[]; readonly clips: Clip[]; readonly diagnostics: Diagnostic[];
  readonly capabilities: {media:"posters";liveVideo:false;liveAudio:false};
  toBundle(): Uint8Array; inspect():Record<string,unknown>; dispose(): void;
}
export interface Player {
  startFlow(index: number): PlaybackState; navigate(frame: Identity): PlaybackState; back(): PlaybackState; restart(start?: Identity): PlaybackState;
  setVariable(variable: Identity, value: VariableValue): PlaybackState; setMode(collection: Identity, mode: Identity): PlaybackState;
  playClip(clip: Identity, options?: {scope?: Occurrence; mode?: "once" | "repeat" | "pingPong"}): PlaybackState;
  pauseClip(): PlaybackState; resumeClip(): PlaybackState; seekClip(timeMs: number): PlaybackState; stopClip(): PlaybackState;
  pausePlayback(): PlaybackState; resumePlayback(): PlaybackState; advanceBy(deltaMs: number): PlaybackState;
  sendPointer(event: {type:"move"|"click"|"dragStart"|"down"|"up"|"leave";x:number;y:number}): PlaybackState;
  sendKey(key: string, type?: "down" | "up"): PlaybackState; scrollBy(x:number,y:number,deltaX:number,deltaY:number): PlaybackState; cancelPointer():PlaybackState;
  panBy(deltaX:number, deltaY:number): PlaybackState; zoomAt(x:number, y:number, factor:number): PlaybackState; fitView(): PlaybackState; getViewport(): Viewport;
  getState(): PlaybackState; inspect():{nodes:Array<{occurrence:Occurrence;name:string;transform:unknown;opacity:number;flags:unknown;data:unknown;styleAssignment:unknown}>;variables:unknown;activeModes:Record<Identity,Identity>}; resize(width:number,height:number,scale?:number): PlaybackState;
  on(name:"navigate"|"link"|"clipCompleted"|"error"|"exit",listener:(event:any)=>void):()=>void; dispose():void;
}
export interface Runtime {
  compileSource(source:SourceBundle):Promise<Program>; loadBundle(bytes:Resource):Promise<Program>;
  createPlayer(options:{program:Program;canvas?:HTMLCanvasElement;width?:number;height?:number;scale?:number;start?:Identity;clock?:"auto"|"manual";input?:"prototype"|"none"}):Promise<Player>;
  dispose():void;
}
export class RuntimeError extends Error { readonly code:string; }
export function createRuntime(options?:{moduleUrl?:string|URL;wasmUrl?:string|URL;moduleFactory?:(options:Record<string,unknown>)=>Promise<any>;moduleOptions?:Record<string,unknown>}):Promise<Runtime>;
