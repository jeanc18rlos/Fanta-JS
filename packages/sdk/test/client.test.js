import assert from "node:assert/strict";
import test from "node:test";
import {acceptProjectProposal, applyProposal, FantaClient, FantaError, nativeId, node, previewProjectProposal, revertProjectProposal} from "../src/index.js";

test("creative run carries typed intent, bearer credentials and stable retry key", async () => {
  const calls = [];
  const client = new FantaClient({baseUrl: "https://fanta.example/", apiKey: () => "private-key", fetch: async (url, options) => {
    calls.push({url, options});
    return Response.json({id: "run-one", status: "queued"}, {status: 202});
  }});
  const request = {task: "Combine a product UI and marketing direction", budget_credits: 20, creative: {version: 1, outcome: "combine", snapshot: {files: {}}}};
  assert.equal((await client.run(request, {idempotencyKey: "same-operation"})).status, "queued");
  await client.run(request, {idempotencyKey: "same-operation"});
  assert.equal(calls[0].url, "https://fanta.example/v2/agents/runs");
  assert.equal(calls[0].options.headers.authorization, "Bearer private-key");
  assert.equal(calls[0].options.headers["idempotency-key"], calls[1].options.headers["idempotency-key"]);
  assert.deepEqual(JSON.parse(calls[0].options.body), request);
  assert.equal(calls[0].options.redirect, "error");
});

test("SSE reconnect resumes cursor and deduplicates replayed events", async () => {
  const cursors = [];
  const client = new FantaClient({baseUrl: "https://fanta.example", apiKey: "key", fetch: async url => {
    if (!url.includes("events")) return Response.json({status: "running"});
    cursors.push(new URL(url).searchParams.get("after"));
    const content = cursors.length === 1
      ? ': heartbeat\r\nid: 2\r\nevent: creative.planned\r\ndata: {"version":1}\r\n\r\n'
      : 'id: 2\nevent: creative.planned\ndata: {"version":1}\n\nid: 3\nevent: succeeded\ndata: {"proposal_id":"proposal"}\n\n';
    const bytes = new TextEncoder().encode(content);
    return new Response(new ReadableStream({start(controller) {
      controller.enqueue(bytes.slice(0, 11)); controller.enqueue(bytes.slice(11)); controller.close();
    }}));
  }});
  const events = [];
  for await (const event of client.events("run-one", {after: 1})) events.push(event);
  assert.deepEqual(cursors, ["1", "2"]);
  assert.deepEqual(events.map(event => event.id), [2, 3]);
  assert.equal(events[0].data.version, 1);
});

test("API errors retain status and conflict category", async () => {
  const client = new FantaClient({baseUrl: "https://fanta.example", apiKey: "key", fetch: async () => Response.json({error: {type: "invalid_request_error", message: "Plan changed"}}, {status: 409})});
  await assert.rejects(client.steer("run", {message: "Adjust", expected_plan_version: 1}), error => error instanceof FantaError && error.status === 409 && error.message === "Plan changed");
});

test("author helpers use native NodeData and unique canonical ULIDs", async () => {
  const identifiers = new Set(Array.from({length: 100}, nativeId));
  assert.equal(identifiers.size, 100);
  for (const id of identifiers) assert.match(id, /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
  const root = node({type: "group", clip_size: [100, 80]}, {name: "Root"});
  assert.equal(root.data.type, "group");
  assert.equal(root.name, "Root");
  assert.equal(root.type, undefined);
  const calls = [];
  await applyProposal(async request => {calls.push(request); return {ok: true};}, {change: {id: "proposal"}, projectRoot: "/project", expectedGeneration: 4});
  assert.equal(calls[0].operation, "proposal_apply");
  assert.equal(calls[0].proposal.expectedGeneration, 4);
});

test("binary artifact download decodes the explicit base64 envelope", async () => {
  const client = new FantaClient({baseUrl: "https://fanta.example", apiKey: "key", fetch: async () => Response.json({base64: "Rk5Y"})});
  assert.equal(new TextDecoder().decode(await client.downloadArtifact("run", "hash")), "FNX");
});

test("editor proposal helpers delegate live guards and preserve full MCP image results", async () => {
  const calls = [];
  const preview = {content: [{type: "text", text: '{"digest":"reviewed"}'}, {type: "image", mimeType: "image/png", data: "cHJldmlldw=="}]};
  const localMcp = async (tool, arguments_) => {calls.push({tool, arguments_}); return preview;};
  const candidate = {files: {"main.fnx": "candidate"}};
  assert.equal(await previewProjectProposal(localMcp, candidate), preview);
  await acceptProjectProposal(localMcp, "reviewed");
  await revertProjectProposal(localMcp, "receipt");
  assert.deepEqual(calls, [
    {tool: "preview_project_proposal", arguments_: {candidate}},
    {tool: "apply_project_proposal", arguments_: {digest: "reviewed"}},
    {tool: "revert_project_proposal", arguments_: {digest: "receipt"}},
  ]);
});

test("cloud preview resolves source and retains stale-base guards without accepting", async () => {
  const paths = [];
  const candidate = {files: {"main.fnx": "candidate"}};
  const cloud = {project_id: "project", source_ref: "source-hash", expected_files: {"main.fnx": "base-hash", "new.fnx": null}, file_hashes: {"main.fnx": "candidate-hash", "new.fnx": "new-hash"}};
  const client = new FantaClient({baseUrl: "https://fanta.example", apiKey: "key", fetch: async url => {
    paths.push(new URL(url).pathname);
    return Response.json(url.includes("proposals") ? {run_id: "run", proposal: cloud} : candidate);
  }});
  const stale = {content: [{type: "text", text: '{"stale":true,"needsRebase":true,"applied":false}'}]};
  const calls = [];
  assert.equal(await client.previewProposal("proposal", async (tool, arguments_) => {calls.push({tool, arguments_}); return stale;}), stale);
  assert.deepEqual(paths, ["/v2/creative/proposals/proposal", "/v2/creative/runs/run/artifacts/source-hash"]);
  assert.deepEqual(calls, [{tool: "preview_project_proposal", arguments_: {candidate, cloud: {project_id: cloud.project_id, expected_files: cloud.expected_files, file_hashes: cloud.file_hashes}}}]);
  calls.length = 0;
  assert.equal(await previewProjectProposal(async (tool, arguments_) => {calls.push({tool, arguments_}); return stale;}, candidate, cloud), stale);
  assert.deepEqual(calls[0].arguments_.cloud, {project_id: cloud.project_id, expected_files: cloud.expected_files, file_hashes: cloud.file_hashes});
});

test("model qualification forwards reviewed evidence and reads workspace qualification status", async () => {
  const calls = [];
  const client = new FantaClient({baseUrl: "https://fanta.example", apiKey: "key", fetch: async (url, options) => {
    calls.push({path: new URL(url).pathname, ...options}); return Response.json({enabled: false});
  }});
  const qualification = {model_id: "candidate", capability: "fnx.author", enabled: false, supported_features: ["text", "json"], evaluation: {contract_tests_passed: true, reviewed: true, suite_revision: "suite-1"}};
  await client.qualifyModel(qualification);
  await client.modelQualifications();
  assert.deepEqual(calls.map(call => call.method), ["PUT", "GET"]);
  assert.equal(calls[0].path, "/v2/creative/models/qualifications");
  assert.deepEqual(JSON.parse(calls[0].body), qualification);
});

test("rebase starts a fresh guarded run and receipt reporting preserves actual local hashes", async () => {
  const calls = [];
  const client = new FantaClient({baseUrl: "https://fanta.example", apiKey: "key", fetch: async (url, options) => {
    calls.push({path: new URL(url).pathname, ...options});
    return Response.json(url.endsWith("/rebase") ? {id: "new-run", status: "queued"} : {proposal_id: "proposal", status: "accepted"}, {status: url.endsWith("/rebase") ? 202 : 200});
  }});
  const rebase = {snapshot: {files: {"main.fnx": "current"}}, base_revision: "revision-2", budget_credits: 20, notes: "Preserve the new header"};
  const receipt = {action: "accepted", project_id: "project", receipt_digest: "a".repeat(64), revision: "revision-3", accepted_files: {"main.fnx": "actual-local-hash"}};
  assert.equal((await client.rebase("proposal", rebase, {idempotencyKey: "rebase-once"})).status, "queued");
  await client.recordReceipt("proposal", receipt);
  assert.equal(calls[0].headers["idempotency-key"], "rebase-once");
  assert.deepEqual(JSON.parse(calls[0].body), rebase);
  assert.equal(calls[1].path, "/v2/creative/proposals/proposal/receipt");
  assert.deepEqual(JSON.parse(calls[1].body), receipt);
});

test("knowledge packs download as binary and preserve publishing/import request contracts", async () => {
  const calls = [];
  const archive = new Uint8Array([0x1f, 0x8b, 8, 0]);
  const client = new FantaClient({baseUrl: "https://fanta.example", apiKey: "key", fetch: async (url, options) => {
    calls.push({url, ...options});
    return url.includes("/pack?") ? new Response(archive, {headers: {"content-type": "application/gzip"}}) : Response.json({status: "pending"}, {status: 201});
  }});
  assert.deepEqual(await client.knowledgePack("release", {version: "2.0.0"}), archive);
  await client.knowledgePublishPack("release", {design_system_id: "system", version: "2.0.0", notes: "Reviewed"});
  await client.knowledgeImportPack({design_system_id: "system", version: "latest"});
  assert.equal(calls[0].url, "https://fanta.example/v2/knowledge/releases/release/pack?version=2.0.0");
  assert.equal(calls[0].headers.authorization, "Bearer key");
  assert.equal(calls[0].redirect, "error");
  assert.deepEqual(JSON.parse(calls[1].body), {design_system_id: "system", version: "2.0.0", notes: "Reviewed"});
  assert.equal(calls[2].url, "https://fanta.example/v2/knowledge/packs/import");
});
