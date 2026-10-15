import type {AcceptanceReceipt, EngineRequest, KnowledgeImportRequest, KnowledgeReviewRequest, ModelQualification, PackImportIn, PackPublishIn, PlanEnvelope, ProjectProposal, ProposalEnvelope, Rebase, Reconcile, Review, Revision, RunCreate, SearchIn, Steering} from "./contracts.js";
export * from "./contracts.js";

export type JsonObject = Record<string, unknown>;
export interface RequestOptions {idempotencyKey?: string; signal?: AbortSignal;}
export interface NativeResource {base64: string;}
export interface NativeFont {family: string; weight?: number; italic?: boolean; faceIndex?: number; bytes: string | NativeResource;}
export interface NativeSource {files: Record<string, string | NativeResource>; fonts?: NativeFont[]; fontSubstitutions?: Record<string, string>;}
export interface NativeNode {
  id: string; name: string; data: JsonObject & {type: string}; children?: NativeNode[];
  transform?: [number, number, number, number, number, number]; opacity?: number;
  flags?: string; bindings?: Array<[JsonObject & {prop: string}, string]>; reactions?: JsonObject[];
  layoutChild?: JsonObject; constraints?: JsonObject; styleAssignment?: JsonObject;
  meta?: JsonObject; blendMode?: string; effects?: JsonObject[]; blurs?: JsonObject[];
  isMask?: boolean; maskType?: string; scrollBehavior?: string;
}
export interface NativeAuthor {
  projectId: string; title: string;
  artifacts: Array<{kind: "page"; root: NativeNode} | {kind: "component"; root: NativeNode; definition: JsonObject}>;
  variables?: JsonObject; activeModes?: Record<string, string>; styles?: JsonObject; motion?: JsonObject;
  flows?: JsonObject[]; componentSets?: JsonObject[]; flowStart?: string;
  assets?: Array<{id?: string; bytes: string | NativeResource}>; fonts?: NativeFont[]; fontSubstitutions?: Record<string, string>;
}
export interface NativeEngineMetadata {
  engineVersion?: string; schemaVersion?: number; valid?: boolean; artifactHash?: string;
  fileHashes?: Record<string, string>; managedFileHashes?: Record<string, string>;
  diagnostics?: Array<{code: string; message: string; path?: string}>;
}
export type NativeEngineResponse<Result = JsonObject> = NativeEngineMetadata & ({ok: true; result: Result} | {ok: false; result: null});
export interface NativeRenderOptions {width: number; height: number; start?: string; timeMs?: number; modes?: Record<string, string>;}
export interface NativeRenderResult {png: NativeResource; sha256: string; width: number; height: number;}
export interface NativePackedProject {runtimeBundle: NativeResource; runtimeBundleHash: string; sourceArchive: NativeResource; sourceArchiveHash: string; program: JsonObject;}
export type LocalEngine = (request: JsonObject) => Promise<NativeEngineResponse>;
export type LocalMcp = (tool: string, arguments_: JsonObject) => Promise<JsonObject>;
export type NativeCloudGuard = Pick<ProjectProposal, "project_id" | "expected_files" | "file_hashes">;
export interface NativeProjectProposal {
  version: number; projectId: string; baseHash: string; candidateHash: string; workingHash: string;
  expectedGeneration: number; expectedFiles: Record<string, string | null>; conflicts: string[];
  base: NativeSource; previousSource: NativeSource; source: NativeSource; digest: string;
}
export interface NativeAcceptanceReceipt {
  version: number; projectId: string; proposalDigest: string; acceptedHash: string;
  acceptedFiles: Record<string, string | null>; generation: number;
  previousSource: NativeSource; acceptedSource: NativeSource; workingHash: string; digest: string;
}
export interface RunEvent {id: number; type: string; data: JsonObject;}
export interface Run {id: string; status: string; model: string; budget_credits: number; spent_credits: number; result: JsonObject | null; error: string | null; created_at: string; updated_at: string;}

export class FantaError extends Error {status: number; type: string; body: JsonObject;}
export class FantaClient {
  constructor(options: {baseUrl: string; apiKey: string | (() => string | Promise<string>); fetch?: typeof fetch});
  request(method: string, path: string, body?: JsonObject, options?: RequestOptions): Promise<JsonObject>;
  download(path: string, options?: Pick<RequestOptions, "signal">): Promise<Uint8Array>;
  run(request: RunCreate, options?: RequestOptions): Promise<Run>;
  getRun(runId: string, options?: RequestOptions): Promise<Run>;
  cancel(runId: string, options?: RequestOptions): Promise<Run>;
  capabilities(options?: RequestOptions): Promise<JsonObject>;
  getPlan(runId: string, options?: RequestOptions): Promise<PlanEnvelope>;
  steer(runId: string, steering: Steering, options?: RequestOptions): Promise<JsonObject>;
  operations(runId: string, options?: RequestOptions): Promise<JsonObject>;
  reconcile(runId: string, operationKey: string, reconciliation: Reconcile, options?: RequestOptions): Promise<JsonObject>;
  proposal(proposalId: string, options?: RequestOptions): Promise<ProposalEnvelope>;
  previewProposal(proposalId: string, localMcp: LocalMcp, options?: RequestOptions): Promise<JsonObject>;
  modelQualifications(options?: RequestOptions): Promise<JsonObject>;
  qualifyModel(qualification: ModelQualification, options?: RequestOptions): Promise<JsonObject>;
  review(proposalId: string, review: Review, options?: RequestOptions): Promise<JsonObject>;
  revise(proposalId: string, revision: Revision, options?: RequestOptions): Promise<Run>;
  rebase(proposalId: string, rebase: Rebase, options?: RequestOptions): Promise<Run>;
  recordReceipt(proposalId: string, receipt: AcceptanceReceipt, options?: RequestOptions): Promise<{proposal_id: string; status: "accepted" | "reverted"}>;
  artifact(runId: string, artifactHash: string, options?: RequestOptions): Promise<JsonObject>;
  downloadArtifact(runId: string, artifactHash: string, options?: RequestOptions): Promise<Uint8Array>;
  engine(request: EngineRequest, options?: RequestOptions): Promise<NativeEngineResponse>;
  author(author: NativeAuthor, options?: RequestOptions): Promise<NativeEngineResponse<{source: NativeSource}>>;
  inspect(source: NativeSource, options?: RequestOptions): Promise<NativeEngineResponse>;
  validate(source: NativeSource, options?: RequestOptions): Promise<NativeEngineResponse>;
  compile(source: NativeSource, options?: RequestOptions): Promise<NativeEngineResponse>;
  render(source: NativeSource, render: NativeRenderOptions, options?: RequestOptions): Promise<NativeEngineResponse<NativeRenderResult>>;
  pack(source: NativeSource, options?: RequestOptions): Promise<NativeEngineResponse<NativePackedProject>>;
  knowledgeSearch(request: SearchIn, options?: RequestOptions): Promise<JsonObject>;
  knowledgeRead(releaseId: string, path: string, options?: RequestOptions): Promise<JsonObject>;
  knowledgeLinks(releaseId: string, path: string, depth?: number, options?: RequestOptions): Promise<JsonObject>;
  knowledgeImport(request: KnowledgeImportRequest, options?: RequestOptions): Promise<JsonObject>;
  knowledgeReleases(options?: RequestOptions): Promise<JsonObject>;
  knowledgeSources(options?: RequestOptions): Promise<JsonObject>;
  knowledgeRelease(releaseId: string, options?: RequestOptions): Promise<JsonObject>;
  knowledgeReview(releaseId: string, review: KnowledgeReviewRequest, options?: RequestOptions): Promise<JsonObject>;
  knowledgeIndex(releaseId: string, options?: RequestOptions): Promise<JsonObject>;
  knowledgeIndexStatus(releaseId: string, options?: RequestOptions): Promise<JsonObject>;
  knowledgeBundle(releaseId: string, options?: RequestOptions): Promise<JsonObject>;
  knowledgePack(releaseId: string, options?: {version?: string; signal?: AbortSignal}): Promise<Uint8Array>;
  knowledgePublishPack(releaseId: string, publish: PackPublishIn, options?: RequestOptions): Promise<JsonObject>;
  knowledgeImportPack(import_: PackImportIn, options?: RequestOptions): Promise<JsonObject>;
  events(runId: string, options?: {after?: number; reconnect?: boolean; signal?: AbortSignal}): AsyncIterable<RunEvent>;
}
export function nativeId(): string;
export function node(data: NativeNode["data"], properties?: Omit<Partial<NativeNode>, "data">): NativeNode;
export function createProposal(localEngine: LocalEngine, proposal: {source: NativeSource; candidate: NativeSource; expectedGeneration: number; workingDocument?: JsonObject}): Promise<NativeEngineResponse>;
export function applyProposal(localEngine: LocalEngine, proposal: {change: NativeProjectProposal; projectRoot: string; expectedGeneration: number; workingDocument?: JsonObject}): Promise<NativeEngineResponse>;
export function revertProposal(localEngine: LocalEngine, proposal: {receipt: NativeAcceptanceReceipt; projectRoot: string; expectedGeneration: number; workingDocument?: JsonObject}): Promise<NativeEngineResponse>;
export function previewProjectProposal(localMcp: LocalMcp, candidate: NativeSource, cloud?: NativeCloudGuard): Promise<JsonObject>;
export function acceptProjectProposal(localMcp: LocalMcp, digest: string): Promise<JsonObject>;
export function revertProjectProposal(localMcp: LocalMcp, receiptDigest: string): Promise<JsonObject>;
