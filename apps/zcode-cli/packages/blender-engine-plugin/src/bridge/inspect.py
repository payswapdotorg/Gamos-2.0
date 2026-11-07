"""Gamos blender bridge: inspect the open scene.

Fixed, committed template. Reads a JSON input file (argv after ``--``, currently
empty) and writes a JSON report with the Blender version and every scene's
objects (name, type, location, rotation, scale, material base color).
"""

import json
import sys
import traceback

import bpy

MARKER = "GAMOS_BRIDGE_REPORT:"


def bridge_argv():
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return []


def write_report(report_path, payload):
    with open(report_path, "w") as handle:
        json.dump(payload, handle)
    print(MARKER + report_path)
    sys.stdout.flush()


def material_base_color(obj):
    material = obj.active_material
    if material is None or not material.use_nodes:
        return None
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    if bsdf is None:
        return None
    color = bsdf.inputs["Base Color"].default_value
    return [float(color[0]), float(color[1]), float(color[2])]


def main():
    argv = bridge_argv()
    if len(argv) < 2:
        raise SystemExit("usage: blender -b <file> --python inspect.py -- <input.json> <report.json>")
    report_path = argv[1]

    scenes = []
    for scene in bpy.data.scenes:
        objects = []
        for obj in scene.objects:
            objects.append(
                {
                    "name": obj.name,
                    "type": obj.type,
                    "location": [float(v) for v in obj.location],
                    "rotation": [float(v) for v in obj.rotation_euler],
                    "scale": [float(v) for v in obj.scale],
                    "materialColor": material_base_color(obj),
                }
            )
        scenes.append({"name": scene.name, "objectCount": len(objects), "objects": objects})

    write_report(
        report_path,
        {
            "ok": True,
            "blenderVersion": bpy.app.version_string,
            "sceneCount": len(scenes),
            "scenes": scenes,
        },
    )


try:
    main()
except SystemExit:
    raise
except Exception as exc:  # noqa: BLE001 - report every failure to the engine
    argv = bridge_argv()
    if len(argv) >= 2:
        try:
            write_report(argv[1], {"ok": False, "error": "%s: %s" % (type(exc).__name__, exc), "traceback": traceback.format_exc()})
        except Exception:  # noqa: BLE001 - best effort only
            pass
    sys.stderr.write("inspect bridge failed: %s\n" % (exc,))
    sys.exit(1)
