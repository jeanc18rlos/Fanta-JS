import {defineConfig} from "@playwright/test";

const hardwareGraphics = process.env.FANTA_RUNTIME_HARDWARE_GPU === "1" || process.env.FANTA_RUNTIME_REFERENCE_GATE === "1";
const graphicsArguments = hardwareGraphics
  ? ["--enable-webgl", "--ignore-gpu-blocklist", ...(process.platform === "darwin" ? ["--use-gl=angle", "--use-angle=metal"] : [])]
  : ["--enable-webgl", "--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"];

export default defineConfig({
  testDir:"./test",
  testMatch:"*.spec.js",
  timeout:60000,
  fullyParallel:false,
  workers:1,
  use:{baseURL:"http://127.0.0.1:8765",viewport:{width:1000,height:800},deviceScaleFactor:1,screenshot:"only-on-failure"},
  projects:[{name:"chromium",use:{browserName:"chromium",launchOptions:{args:graphicsArguments}}},{name:"firefox",use:{browserName:"firefox",headless:process.platform!=="linux"}},{name:"webkit",use:{browserName:"webkit"}}],
  webServer:{command:"python3 -m http.server 8765 --bind 127.0.0.1",cwd:"../..",url:"http://127.0.0.1:8765/packages/runtime/examples/blank.html",reuseExistingServer:!process.env.CI},
});
