import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const license = readFileSync(join(root, "LICENSE"));
const temporary = mkdtempSync(join(tmpdir(), "fanta-package-verification-"));
const packages = {
  runtime: [
    "src/index.js",
    "src/index.d.ts",
    "dist/fanta-runtime.mjs",
    "dist/fanta_runtime_wasm.wasm",
    "site/viewer.js",
    "site/viewer.css",
  ],
  sdk: ["src/index.js", "src/index.d.ts", "src/contracts.d.ts"],
};

try {
  const userConfig = join(temporary, "user.npmrc");
  const globalConfig = join(temporary, "global.npmrc");
  writeFileSync(userConfig, "");
  writeFileSync(globalConfig, "");
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^npm_config_/i.test(key) && !/^(npm_token|node_auth_token)$/i.test(key)));
  Object.assign(environment, {
    NPM_CONFIG_USERCONFIG: userConfig,
    NPM_CONFIG_GLOBALCONFIG: globalConfig,
    NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
    NPM_CONFIG_LOGLEVEL: "error",
  });

  for (const [name, required] of Object.entries(packages)) {
    const directory = join(root, "packages", name);
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
    assert.equal(manifest.name, `fanta-${name}`);
    assert.equal(manifest.version, "0.1.1");
    assert.equal(manifest.license, "GPL-3.0-only");
    assert.equal(manifest.publishConfig?.access, "public");
    assert.notEqual(manifest.private, true);
    assert.deepEqual(readFileSync(join(directory, "LICENSE")), license,
      `${manifest.name} must include the complete repository license`);

    const result = spawnSync("pnpm", ["dlx", "npm@11.6.2", "pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: directory,
      env: environment,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `npm pack failed for ${manifest.name} (exit ${result.status})`);
    const output = JSON.parse(result.stdout);
    assert.equal(output.length, 1, "npm pack must describe exactly one package");
    const packed = output[0];
    assert.equal(packed.name, manifest.name);
    assert.equal(packed.version, manifest.version);
    const files = new Map(packed.files.map(file => [file.path, file.size]));
    for (const path of ["package.json", "README.md", "LICENSE", ...required]) {
      assert.ok(files.has(path), `${manifest.name} is missing ${path}`);
      assert.ok(files.get(path) > 0, `${manifest.name} contains an empty ${path}`);
    }
    assert.equal(files.get("LICENSE"), license.length);
    for (const path of files.keys()) {
      assert.ok(!/(^|\/)(?:\.npmrc|\.env(?:\..*)?|node_modules|\.git|test-results)(\/|$)/.test(path),
        `${manifest.name} contains an unexpected private or generated file: ${path}`);
    }
    if (name === "runtime") {
      assert.deepEqual(readFileSync(join(directory, "dist/fanta_runtime_wasm.wasm")).subarray(0, 4),
        Buffer.from([0, 97, 115, 109]), "runtime distribution must contain built WebAssembly");
    }
    console.log(`${packed.name}@${packed.version}: verified ${files.size} packed files (${packed.size} bytes), complete GPL license, and public access`);
  }
} finally {
  rmSync(temporary, {recursive: true, force: true});
}
