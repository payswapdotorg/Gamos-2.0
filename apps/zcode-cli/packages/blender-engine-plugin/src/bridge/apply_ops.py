"""Gamos blender bridge: apply typed scene operations.

Fixed, committed template. Reads a JSON input file (argv after ``--``):

    {"blendFile": "...", "operations": [...], "save": true}

and applies each typed operation through explicit bpy calls. There is a strict
allowlist of operation names; anything else is an error. No eval, no exec, no
dynamic imports, and no payload from the input ever becomes code.

Writes a JSON report next to the given report path and prints
``GAMOS_BRIDGE_REPORT:<report path>`` on stdout. Failures are reported as
``{"ok": false, "error": ...}`` with exit code 1.
"""

import json
import os
import sys
import traceback

import bpy

MARKER = "GAMOS_BRIDGE_REPORT:"

ALLOWED_PRIMITIVES = ("cube", "sphere", "cylinder", "plane", "monkey")
ALLOWED_OPS = ("add-primitive", "set-transform", "rename", "delete", "set-material-color")


def bridge_argv():
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return []


def write_report(report_path, payload):
    with open(report_path, "w") as handle:
        json.dump(payload, handle)
    print(MARKER + report_path)
    sys.stdout.flush()


def require_object(target):
    if not isinstance(target, str) or not target:
        raise ValueError("missing object target")
    obj = bpy.data.objects.get(target)
    if obj is None:
        raise ValueError("object not found: %r" % (target,))
    return obj


def as_triple(value, field):
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise ValueError("%s must be a 3-number list" % (field,))
    return (float(value[0]), float(value[1]), float(value[2]))


def apply_add_primitive(op):
    primitive = op.get("primitive")
    if primitive not in ALLOWED_PRIMITIVES:
        raise ValueError("unknown primitive: %r" % (primitive,))
    operators = {
        "cube": bpy.ops.mesh.primitive_cube_add,
        "sphere": bpy.ops.mesh.primitive_uv_sphere_add,
        "cylinder": bpy.ops.mesh.primitive_cylinder_add,
        "plane": bpy.ops.mesh.primitive_plane_add,
        "monkey": bpy.ops.mesh.primitive_monkey_add,
    }
    location = as_triple(op.get("location", (0.0, 0.0, 0.0)), "location")
    rotation = as_triple(op.get("rotation", (0.0, 0.0, 0.0)), "rotation")
    operators[primitive](location=location, rotation=rotation)
    obj = bpy.context.active_object
    if obj is None:
        raise RuntimeError("primitive_add produced no active object")
    if op.get("name"):
        if not isinstance(op["name"], str) or not op["name"]:
            raise ValueError("name must be a non-empty string")
        obj.name = op["name"]
    if op.get("scale") is not None:
        obj.scale = as_triple(op["scale"], "scale")
    return {
        "op": "add-primitive",
        "primitive": primitive,
        "name": obj.name,
        "location": list(obj.location),
        "scale": list(obj.scale),
    }


def apply_set_transform(op):
    obj = require_object(op.get("target"))
    if op.get("location") is not None:
        obj.location = as_triple(op["location"], "location")
    if op.get("rotation") is not None:
        obj.rotation_euler = as_triple(op["rotation"], "rotation")
    if op.get("scale") is not None:
        obj.scale = as_triple(op["scale"], "scale")
    return {
        "op": "set-transform",
        "target": obj.name,
        "location": list(obj.location),
        "rotation": list(obj.rotation_euler),
        "scale": list(obj.scale),
    }


def apply_rename(op):
    obj = require_object(op.get("target"))
    name = op.get("name")
    if not isinstance(name, str) or not name:
        raise ValueError("rename requires a non-empty name")
    previous = obj.name
    obj.name = name
    return {"op": "rename", "from": previous, "to": obj.name}


def apply_delete(op):
    obj = require_object(op.get("target"))
    name = obj.name
    bpy.data.objects.remove(obj, do_unlink=True)
    return {"op": "delete", "target": name}


def apply_set_material_color(op):
    obj = require_object(op.get("target"))
    color = as_triple(op.get("color"), "color")
    material = obj.active_material
    if material is None:
        material = bpy.data.materials.new(name="%s_material" % (obj.name,))
        obj.data.materials.append(material)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    if bsdf is None:
        raise RuntimeError("Principled BSDF node not found on material %r" % (material.name,))
    bsdf.inputs["Base Color"].default_value = (color[0], color[1], color[2], 1.0)
    return {"op": "set-material-color", "target": obj.name, "color": list(color)}


APPLIERS = {
    "add-primitive": apply_add_primitive,
    "set-transform": apply_set_transform,
    "rename": apply_rename,
    "delete": apply_delete,
    "set-material-color": apply_set_material_color,
}


def main():
    argv = bridge_argv()
    if len(argv) < 2:
        raise SystemExit("usage: blender -b <file> --python apply_ops.py -- <ops.json> <report.json>")
    ops_path, report_path = argv[0], argv[1]
    with open(ops_path) as handle:
        payload = json.load(handle)
    operations = payload.get("operations", [])
    if not isinstance(operations, list):
        raise ValueError("operations must be a list")
    save = bool(payload.get("save", False))

    applied = []
    for op in operations:
        if not isinstance(op, dict) or op.get("op") not in ALLOWED_OPS:
            raise ValueError("unknown operation: %r" % (op.get("op") if isinstance(op, dict) else op,))
        applied.append(APPLIERS[op["op"]](op))

    saved = False
    if save:
        target = bpy.data.filepath
        if not target:
            raise RuntimeError("cannot save: the blend has no file path (open it with -b <file>)")
        tmp = target + ".gamos-tmp.blend"
        bpy.ops.wm.save_as_mainfile(filepath=tmp, copy=True)
        os.replace(tmp, target)
        saved = True

    write_report(
        report_path,
        {"ok": True, "applied": applied, "saved": saved, "blendFile": bpy.data.filepath},
    )


try:
    main()
except SystemExit:
    raise
except Exception as exc:  # noqa: BLE001 - report every failure to the engine
    argv = bridge_argv()
    if len(argv) >= 2:
        try:
            write_report(
                argv[1],
                {
                    "ok": False,
                    "error": "%s: %s" % (type(exc).__name__, exc),
                    "traceback": traceback.format_exc(),
                },
            )
        except Exception:  # noqa: BLE001 - best effort only
            pass
    sys.stderr.write("apply_ops bridge failed: %s\n" % (exc,))
    sys.exit(1)
