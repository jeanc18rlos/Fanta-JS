# Fanta SDK

`@jeanc18rlos/sdk` provides JavaScript and TypeScript clients for creative runs, plans, steering, proposals, artifacts, native FNX authoring and curated OKF knowledge. Node 22+ supplies fetch and secure randomness; the client also accepts an injected fetch implementation. The feature is initially an internal workspace canary, so server authorization and the creative allowlist still apply.

```js
import {FantaClient, nativeId, node, previewProjectProposal} from "@jeanc18rlos/sdk";

const fanta = new FantaClient({
  baseUrl: process.env.FANTA_API_URL,
  apiKey: process.env.FANTA_API_KEY,
});
const run = await fanta.run({
  task: "Design a coherent product experience and marketing direction from the brief",
  budget_credits: 100,
  creative: {outcome: "auto", profile: {direction: "Calm, editorial, clear hierarchy"}},
}, {idempotencyKey: "my-project-first-direction"});

for await (const event of fanta.events(run.id)) console.log(event.type, event.data);
const plan = await fanta.getPlan(run.id);
```

Supply the same `idempotencyKey` whenever retrying the same create/revise request. A different body with that key is rejected by the server. A new call without a supplied key creates a fresh request identity. `events` reconnects when the bounded server stream closes and resumes from its last event ID; replayed IDs are discarded. Use `after` to resume an earlier stream and an `AbortSignal` to stop waiting. Transport errors propagate to the caller.

Author native structures without constructing FNX markup:

```js
const authored = await fanta.author({
  projectId: nativeId(),
  title: "Product direction",
  artifacts: [{kind: "page", root: node({type: "group", clip_size: [1440, 900]}, {name: "Overview"})}],
});
if (!authored.ok) throw new Error(JSON.stringify(authored.diagnostics));
const source = authored.result.source;
const validation = await fanta.validate(source);
```

`node` allocates a canonical ULID, keeps native `data` separate from wrapper properties, and preserves IDs supplied by the caller. Native authoring, validation, sidecar generation and rendering are performed by the Rust engine. Query `engine({operation: "schema"})` for its supported NodeData and resource contract. Supply font bytes, assets and substitutions explicitly when rendering text or media. No SDK parser or default font substitution overrides the native engine.

Cloud proposal review changes proposal status. For the open desktop project, `previewProjectProposal(localMcp, candidate)` calls the editor's local `preview_project_proposal` tool, which derives the saved source, unsaved state and generation itself. The helper preserves the full MCP text and image result. After the user accepts that exact reviewed digest, call `acceptProjectProposal(localMcp, digest)`; `revertProjectProposal(localMcp, receiptDigest)` uses the acceptance receipt to preserve intervening edits.

`previewProposal` resolves a cloud proposal's source reference and passes its project identity, expected base hashes and reviewed candidate file hashes to local preview:

```js
const preview = await fanta.previewProposal(proposalId, localMcp);
```

Here `localMcp` is the editor integration's `(toolName, arguments) => Promise<fullMcpResult>` function. A stale base returns `needsRebase` with no acceptance digest; the complete result is retained for the caller to review. When calling the lower-level preview helper directly, supply the hosted proposal as its third argument to preserve these guards. Cloud `ProjectProposal` contains artifact references; it is a different contract from the native `NativeProjectProposal` with its candidate source and digest. `createProposal`, `applyProposal` and `revertProposal` are also available for trusted CLI hosts that explicitly supply the native executor, actual project root and document generation.

`rebase(proposalId, {snapshot, base_revision, budget_credits, notes}, options)` starts a fresh modify run against the current snapshot and retains the original proposal as authorized context. It produces a new reviewable proposal. `recordReceipt` reports actual accepted/reverted editor state to the hosted API after guarded local application; it does not apply edits. Preserve the same idempotency key when retrying a rebase, and report actual local hashes rather than replacing them with cloud manifest hashes.

`modelQualifications` reads the workspace's routing qualifications. `qualifyModel` submits evaluation evidence as a workspace administrator; enabling a route requires passing contract tests and a reviewed, versioned evaluation suite. It does not run inference or an evaluation automatically.

`artifact` returns the artifact JSON. `downloadArtifact` decodes an explicit `{base64}` binary envelope; other JSON artifacts download as UTF-8 JSON. Use `pack(source)` for a native project archive. Knowledge methods expose search, concept inspection, links, import, releases and bundle export. Plugin capability schemas appear in `capabilities()` only for the calling workspace's installed plugins.

`knowledgePack` downloads a reviewed OKF content pack as gzip bytes. `knowledgePublishPack` publishes an approved release to an authorized design-system registry, and `knowledgeImportPack` imports a registry version for workspace review. Content packs contain documentation and native resources; their publication does not install executable plugins. Binary downloads are bounded to 40 MB.

Request types and plan/proposal response types in `src/contracts.d.ts` are generated from the backend's OpenAPI. Regenerate/check both SDKs from the backend checkout:

```sh
cd /path/to/fanta-backend-creative/v2
uv run python scripts/generate_creative_sdk.py --typescript-out /path/to/fanta-edit/packages/sdk/src/contracts.d.ts
uv run python scripts/generate_creative_sdk.py --check --typescript-out /path/to/fanta-edit/packages/sdk/src/contracts.d.ts
```

Run `npm test` here. Tests use mock HTTP and make no inference or cloud deployment calls. The package remains private to the workspace until a separate publish action.
