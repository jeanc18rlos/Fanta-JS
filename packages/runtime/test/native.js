import {spawnSync} from "node:child_process";
import {existsSync} from "node:fs";
import {fileURLToPath} from "node:url";

// fanta-runtime loads bundles and has no FNX/FSS parser, so the tests compile
// their sources with fanta-edit's native playback fixture. The same binary is
// the parity oracle: the bundle it prints is the one the WebAssembly side loads,
// and its results are what the WebAssembly player must reproduce.
const defaultExecutable = fileURLToPath(new URL("../../../.engine/fanta-edit/target/debug/examples/playback_fixture", import.meta.url));
export const buildInstructions = "Build the native fixture (cargo build -p fanta-runtime --example playback_fixture in fanta-edit) or set FANTA_NATIVE_FIXTURE to one built elsewhere";

export function nativeFixture() {
  const executable = process.env.FANTA_NATIVE_FIXTURE ?? defaultExecutable;
  if (existsSync(executable)) return executable;
  if (process.env.FANTA_NATIVE_FIXTURE) throw new Error(`Missing native fixture ${executable}`);
  return null;
}

function byteArray(value) {
  if (typeof value === "string") return [...new TextEncoder().encode(value)];
  if (value instanceof Uint8Array) return [...value];
  if (value instanceof ArrayBuffer) return [...new Uint8Array(value)];
  throw new TypeError("Source files and font bytes must be strings, Uint8Array, or ArrayBuffer");
}

function sourceBundle(source) {
  const files = Object.fromEntries(Object.entries(source.files).map(([path, value]) => [path, byteArray(value)]));
  const fonts = (source.fonts ?? []).map(({family, weight, italic, faceIndex, bytes}) => ({family, weight, italic, face_index: faceIndex, bytes: byteArray(bytes)}));
  return {files, fonts, font_substitutions: source.fontSubstitutions ?? {}};
}

/**
 * Compile `source` natively, play `commands` on a player created with
 * `options` ({width, height, start, fit}; the fixture's defaults are 320×180
 * and contain), and return the bundle it played as bytes and base64 together
 * with one result per command.
 */
export function compileNatively(source, {options, commands = []} = {}) {
  const executable = nativeFixture();
  if (!executable) throw new Error(buildInstructions);
  const native = spawnSync(executable, {input: JSON.stringify({source: sourceBundle(source), options, commands}), encoding: "utf8", maxBuffer: 256 * 1024 * 1024});
  if (native.error) throw native.error;
  if (native.status !== 0) throw new Error(`The native fixture failed (exit ${native.status}): ${native.stderr.trim()}`);
  const {bundle, results} = JSON.parse(native.stdout);
  return {bundle: new Uint8Array(Buffer.from(bundle, "base64")), bundleBase64: bundle, results};
}
