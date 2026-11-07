import {
  ArcRotateCamera,
  Engine,
  HemisphericLight,
  MeshBuilder,
  Scene,
  Vector3,
} from "@babylonjs/core";

// Real minimal Babylon.js scene: engine, scene, camera, light, ground mesh,
// render loop. `window.__GAMOS_BABYLON_READY__` flips after the first rendered
// frame so downstream verification can assert real rendering happened.
const canvas = document.getElementById("renderCanvas");
const engine = new Engine(canvas, true);
const scene = new Scene(engine);

new ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 2.5, 10, Vector3.Zero(), scene);
new HemisphericLight("light", new Vector3(0, 1, 0), scene);
MeshBuilder.CreateGround("ground", { width: 6, height: 6 }, scene);

document.title = "babylon-fixture";

engine.runRenderLoop(() => {
  if (!window.__GAMOS_BABYLON_READY__) {
    window.__GAMOS_BABYLON_READY__ = true;
  }
  scene.render();
});
