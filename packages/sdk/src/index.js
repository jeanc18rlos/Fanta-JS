const terminalEvents = new Set(["succeeded", "failed", "canceled", "expired"]);

export class FantaError extends Error {
  constructor(status, body) {
    super(body?.error?.message ?? `Fanta request failed (${status})`);
    this.name = "FantaError";
    this.status = status;
    this.type = body?.error?.type ?? "api_error";
    this.body = body;
  }
}

function pathPart(value) {
  return encodeURIComponent(value);
}

function newKey() {
  return globalThis.crypto.randomUUID();
}

export class FantaClient {
  constructor({baseUrl, apiKey, fetch: fetchFunction = globalThis.fetch}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.fetch = fetchFunction;
  }

  async request(method, path, body, {idempotencyKey, signal} = {}) {
    const token = typeof this.apiKey === "function" ? await this.apiKey() : this.apiKey;
    const headers = {accept: "application/json", authorization: `Bearer ${token}`};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method, headers, signal, redirect: "error", ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
    let result;
    try { result = await response.json(); }
    catch { throw new FantaError(response.ok ? 502 : response.status, {error: {type: "api_error", message: "Fanta returned an invalid JSON response"}}); }
    if (!response.ok) throw new FantaError(response.status, result);
    return result;
  }

  async download(path, {signal} = {}) {
    const token = typeof this.apiKey === "function" ? await this.apiKey() : this.apiKey;
    const response = await this.fetch(`${this.baseUrl}${path}`, {method: "GET", headers: {authorization: `Bearer ${token}`, accept: "application/octet-stream"}, signal, redirect: "error"});
    if (!response.ok) {
      let body;
      try {body = await response.json();}
      catch {body = {error: {type: "api_error", message: "Fanta download failed"}};}
      throw new FantaError(response.status, body);
    }
    const maximum = 40 * 1024 * 1024;
    if (!response.body) throw new FantaError(502, {error: {type: "api_error", message: "Fanta download has no body"}});
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maximum) throw new FantaError(502, {error: {type: "api_error", message: "Fanta download exceeds 40 MB"}});
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    const content = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {content.set(chunk, offset); offset += chunk.byteLength;}
    return content;
  }

  run(request, {idempotencyKey = newKey(), ...options} = {}) {
    return this.request("POST", "/v2/agents/runs", {...request, creative: request.creative ?? {version: 1, outcome: "auto"}}, {idempotencyKey, ...options});
  }
  getRun(runId, options) { return this.request("GET", `/v2/agents/runs/${pathPart(runId)}`, undefined, options); }
  cancel(runId, options) { return this.request("POST", `/v2/agents/runs/${pathPart(runId)}/cancel`, {}, options); }
  capabilities(options) { return this.request("GET", "/v2/creative/capabilities", undefined, options); }
  getPlan(runId, options) { return this.request("GET", `/v2/creative/runs/${pathPart(runId)}/plan`, undefined, options); }
  steer(runId, steering, options) { return this.request("POST", `/v2/creative/runs/${pathPart(runId)}/steer`, steering, options); }
  operations(runId, options) { return this.request("GET", `/v2/creative/runs/${pathPart(runId)}/operations`, undefined, options); }
  reconcile(runId, operationKey, reconciliation, options) { return this.request("POST", `/v2/creative/runs/${pathPart(runId)}/operations/${pathPart(operationKey)}/reconcile`, reconciliation, options); }
  proposal(proposalId, options) { return this.request("GET", `/v2/creative/proposals/${pathPart(proposalId)}`, undefined, options); }
  async previewProposal(proposalId, localMcp, options) {
    const envelope = await this.proposal(proposalId, options);
    const candidate = await this.artifact(envelope.run_id, envelope.proposal.source_ref, options);
    return previewProjectProposal(localMcp, candidate, envelope.proposal);
  }
  modelQualifications(options) { return this.request("GET", "/v2/creative/models/qualifications", undefined, options); }
  qualifyModel(qualification, options) { return this.request("PUT", "/v2/creative/models/qualifications", qualification, options); }
  review(proposalId, review, options) { return this.request("POST", `/v2/creative/proposals/${pathPart(proposalId)}/review`, review, options); }
  revise(proposalId, revision, {idempotencyKey = newKey(), ...options} = {}) { return this.request("POST", `/v2/creative/proposals/${pathPart(proposalId)}/revise`, revision, {idempotencyKey, ...options}); }
  rebase(proposalId, rebase, {idempotencyKey = newKey(), ...options} = {}) { return this.request("POST", `/v2/creative/proposals/${pathPart(proposalId)}/rebase`, rebase, {idempotencyKey, ...options}); }
  recordReceipt(proposalId, receipt, options) { return this.request("POST", `/v2/creative/proposals/${pathPart(proposalId)}/receipt`, receipt, options); }
  artifact(runId, artifactHash, options) { return this.request("GET", `/v2/creative/runs/${pathPart(runId)}/artifacts/${pathPart(artifactHash)}`, undefined, options); }
  async downloadArtifact(runId, artifactHash, options) {
    const artifact = await this.artifact(runId, artifactHash, options);
    if (typeof artifact.base64 === "string") return Uint8Array.from(atob(artifact.base64), character => character.charCodeAt(0));
    return new TextEncoder().encode(JSON.stringify(artifact));
  }
  engine(request, options) { return this.request("POST", "/v2/creative/engine", request, options); }
  author(author, options) { return this.engine({operation: "author", author}, options); }
  inspect(source, options) { return this.engine({operation: "inspect", source}, options); }
  validate(source, options) { return this.engine({operation: "validate", source}, options); }
  compile(source, options) { return this.engine({operation: "compile", source}, options); }
  render(source, render, options) { return this.engine({operation: "render", source, render}, options); }
  pack(source, options) { return this.engine({operation: "pack", source}, options); }
  knowledgeSearch(query, options) { return this.request("POST", "/v2/knowledge/search", query, options); }
  knowledgeRead(releaseId, path, options) { return this.request("GET", `/v2/knowledge/releases/${pathPart(releaseId)}/concepts/${path.split("/").map(pathPart).join("/")}`, undefined, options); }
  knowledgeLinks(releaseId, path, depth = 1, options) { return this.request("GET", `/v2/knowledge/releases/${pathPart(releaseId)}/links/${path.split("/").map(pathPart).join("/")}?depth=${depth}`, undefined, options); }
  knowledgeImport(request, options) { return this.request("POST", "/v2/knowledge/releases", request, options); }
  knowledgeReleases(options) { return this.request("GET", "/v2/knowledge/releases", undefined, options); }
  knowledgeSources(options) { return this.request("GET", "/v2/knowledge/sources", undefined, options); }
  knowledgeRelease(releaseId, options) { return this.request("GET", `/v2/knowledge/releases/${pathPart(releaseId)}`, undefined, options); }
  knowledgeReview(releaseId, review, options) { return this.request("POST", `/v2/knowledge/releases/${pathPart(releaseId)}/review`, review, options); }
  knowledgeIndex(releaseId, options) { return this.request("POST", `/v2/knowledge/releases/${pathPart(releaseId)}/index`, {}, options); }
  knowledgeIndexStatus(releaseId, options) { return this.request("GET", `/v2/knowledge/releases/${pathPart(releaseId)}/index`, undefined, options); }
  knowledgeBundle(releaseId, options) { return this.request("GET", `/v2/knowledge/releases/${pathPart(releaseId)}/bundle`, undefined, options); }
  knowledgePack(releaseId, {version = "1.0.0", ...options} = {}) { return this.download(`/v2/knowledge/releases/${pathPart(releaseId)}/pack?version=${pathPart(version)}`, options); }
  knowledgePublishPack(releaseId, publish, options) { return this.request("POST", `/v2/knowledge/releases/${pathPart(releaseId)}/publish-pack`, publish, options); }
  knowledgeImportPack(import_, options) { return this.request("POST", "/v2/knowledge/packs/import", import_, options); }

  async *events(runId, {after = 0, reconnect = true, signal} = {}) {
    let cursor = after;
    while (!signal?.aborted) {
      const token = typeof this.apiKey === "function" ? await this.apiKey() : this.apiKey;
      const response = await this.fetch(`${this.baseUrl}/v2/agents/runs/${pathPart(runId)}/events?after=${cursor}`, {
        headers: {authorization: `Bearer ${token}`, accept: "text/event-stream"}, signal, redirect: "error",
      });
      if (!response.ok) throw new FantaError(response.status, await response.json());
      if (!response.body) throw new Error("Fanta event response has no stream");
      let finished = false;
      for await (const event of parseEvents(response.body)) {
        if (!Number.isSafeInteger(event.id) || event.id <= cursor) continue;
        cursor = event.id;
        finished ||= terminalEvents.has(event.type);
        yield event;
      }
      if (finished || !reconnect || signal?.aborted) return;
      const run = await this.getRun(runId, {signal});
      if (terminalEvents.has(run.status)) return;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(done, 250);
        function done() { signal?.removeEventListener("abort", abort); resolve(); }
        function abort() { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal.reason ?? new Error("Aborted")); }
        signal?.addEventListener("abort", abort, {once: true});
        if (signal?.aborted) abort();
      });
    }
  }
}

async function* parseEvents(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fields = {id: "", type: "message", data: []};
  try {
    while (true) {
      const {done, value} = await reader.read();
      buffer += decoder.decode(value, {stream: !done});
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (line === "") {
          if (fields.data.length) yield {id: /^\d+$/.test(fields.id) ? Number(fields.id) : NaN, type: fields.type, data: JSON.parse(fields.data.join("\n"))};
          fields = {id: "", type: "message", data: []};
          continue;
        }
        if (line.startsWith(":")) continue;
        const separator = line.indexOf(":");
        const key = separator < 0 ? line : line.slice(0, separator);
        const text = separator < 0 ? "" : line.slice(separator + 1).replace(/^ /, "");
        if (key === "id") fields.id = text;
        if (key === "event") fields.type = text;
        if (key === "data") fields.data.push(text);
      }
      if (buffer.length > 16_000_000 || fields.data.reduce((size, line) => size + line.length, 0) > 16_000_000) throw new Error("Fanta event exceeds 16 MB");
      if (done) return;
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function nativeId() {
  let time = BigInt(Date.now());
  let prefix = "";
  for (let index = 0; index < 10; index += 1) { prefix = alphabet[Number(time & 31n)] + prefix; time >>= 5n; }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(10));
  let random = 0n;
  for (const byte of bytes) random = (random << 8n) | BigInt(byte);
  let suffix = "";
  for (let index = 0; index < 16; index += 1) { suffix = alphabet[Number(random & 31n)] + suffix; random >>= 5n; }
  return prefix + suffix;
}

export function node(data, {id = nativeId(), name = "Node", children = [], ...properties} = {}) {
  return {...properties, id, name, data, children};
}

export function createProposal(localEngine, {source, candidate, expectedGeneration, workingDocument}) {
  return localEngine({operation: "proposal_create", source, proposal: {candidate, expectedGeneration, ...(workingDocument ? {workingDocument} : {})}});
}

export function applyProposal(localEngine, proposal) {
  return localEngine({operation: "proposal_apply", proposal});
}

export function revertProposal(localEngine, proposal) {
  return localEngine({operation: "proposal_revert", proposal});
}

export function previewProjectProposal(localMcp, candidate, cloud) {
  return localMcp("preview_project_proposal", {candidate, ...(cloud ? {cloud: {project_id: cloud.project_id, expected_files: cloud.expected_files, file_hashes: cloud.file_hashes}} : {})});
}

export function acceptProjectProposal(localMcp, digest) {
  return localMcp("apply_project_proposal", {digest});
}

export function revertProjectProposal(localMcp, receiptDigest) {
  return localMcp("revert_project_proposal", {digest: receiptDigest});
}
