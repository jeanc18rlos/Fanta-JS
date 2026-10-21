import {readFileSync} from "node:fs";
import {gzipSync, brotliCompressSync, constants} from "node:zlib";
import {fileURLToPath} from "node:url";

// Print the built runtime module's raw, gzip and brotli sizes so each build
// measures the shipped WebAssembly against the previous release.
const dist = new URL("../packages/runtime/dist/", import.meta.url);
for (const name of ["fanta_runtime_wasm.wasm", "fanta-runtime.mjs"]) {
  const bytes = readFileSync(fileURLToPath(new URL(name, dist)));
  const gzip = gzipSync(bytes, {level: 9}).length;
  const brotli = brotliCompressSync(bytes, {params: {[constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length}}).length;
  console.log(`${name}: ${bytes.length} bytes raw, ${gzip} gzip, ${brotli} brotli`);
}
