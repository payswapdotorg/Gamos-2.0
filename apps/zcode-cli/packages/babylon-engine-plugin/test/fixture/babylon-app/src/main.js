import {
  ArcRotateCamera,
  Engine,
  HemisphericLight,
  MeshBuilder,
  Scene,
  SceneLoader,
  Vector3,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import gamosAssets from "./gamos-assets.json";

// Real minimal Babylon.js scene: engine, scene, camera, light, ground mesh,
// render loop. `window.__GAMOS_BABYLON_READY__` flips after the first rendered
// frame so downstream verification can assert real rendering happened; the
// engine/scene handles are exposed for the M2 journey's LIVE-behavior
// assertions (fps > 0 proves the render loop is still producing frames — a
// static DOM cannot fake engine.getFps()).
const canvas = document.getElementById("renderCanvas");
const engine = new Engine(canvas, true);
const scene = new Scene(engine);
window.__GAMOS_BABYLON_ENGINE__ = engine;
window.__GAMOS_BABYLON_SCENE__ = scene;

new ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 2.5, 10, Vector3.Zero(), scene);
new HemisphericLight("light", new Vector3(0, 1, 0), scene);
MeshBuilder.CreateGround("ground", { width: 6, height: 6 }, scene);

// Gamos asset integration (M3.2 target leg): import EXACTLY the committed
// registry entries through Babylon's real glTF loader. The loader is
// deterministic and bounded — no dynamic code, no arbitrary URLs; the only
// fetched URL is /assets/<file> where <file> comes from the committed
// registry and must match the plain .glb filename pattern. A failed import is
// a VISIBLE failure (errors array + __GAMOS_BABYLON_ASSET_ERROR__), never
// silent; __GAMOS_BABYLON_ASSETS_READY__ flips only after every import has
// settled (readiness means "attempted"; success means an empty errors array).
window.__GAMOS_BABYLON_ASSETS__ = { loaded: [], errors: [] };
const GAMOS_ASSET_FILE_PATTERN = /^[a-z0-9][a-z0-9-]*\.glb$/;
const assetImports = gamosAssets.assets.map((asset) => {
  if (!GAMOS_ASSET_FILE_PATTERN.test(asset.file)) {
    const error = `registry file "${asset.file}" does not match the supported .glb filename pattern`;
    window.__GAMOS_BABYLON_ASSETS__.errors.push({ assetName: asset.assetName, file: asset.file, error });
    window.__GAMOS_BABYLON_ASSET_ERROR__ = `${asset.assetName} (${asset.file}): ${error}`;
    return Promise.resolve();
  }
  return SceneLoader.ImportMeshAsync("", "/assets/" + asset.file, "", scene)
    .then((result) => {
      const meshes = Array.isArray(result && result.meshes) ? result.meshes : [];
      window.__GAMOS_BABYLON_ASSETS__.loaded.push({
        assetName: asset.assetName,
        meshNames: meshes.map((mesh) => mesh.name),
        vertices: meshes.reduce(
          (total, mesh) => total + (typeof mesh.getTotalVertices === "function" ? mesh.getTotalVertices() : 0),
          0,
        ),
      });
    })
    .catch((error) => {
      const reason = error instanceof Error ? error.message : String(error);
      window.__GAMOS_BABYLON_ASSETS__.errors.push({ assetName: asset.assetName, file: asset.file, error: reason });
      window.__GAMOS_BABYLON_ASSET_ERROR__ = `${asset.assetName} (${asset.file}): ${reason}`;
    });
});
Promise.all(assetImports).then(() => {
  window.__GAMOS_BABYLON_ASSETS_READY__ = true;
});

document.title = "babylon-fixture";

engine.runRenderLoop(() => {
  if (!window.__GAMOS_BABYLON_READY__) {
    window.__GAMOS_BABYLON_READY__ = true;
  }
  scene.render();
});
