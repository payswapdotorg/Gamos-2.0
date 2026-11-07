"""Gamos blender bridge: export the scene (or a named selection) to OBJ/GLTF/FBX.

Fixed, committed template. Reads a JSON input file (argv after ``--``):

    {"outputPath": "...", "format": "OBJ"|"GLTF"|"FBX", "selection": ["Name"]|null}

Uses the built-in exporters per format. GLTF exports binary .glb (Blender's
default); the actual written path is resolved and reported as ``writtenTo``.
"""

import json
import os
import sys
import traceback

import bpy

MARKER = "GAMOS_BRIDGE_REPORT:"

ALLOWED_FORMATS = ("OBJ", "GLTF", "FBX")


def bridge_argv():
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return []


def write_report(report_path, payload):
    with open(report_path, "w") as handle:
        json.dump(payload, handle)
    print(MARKER + report_path)
    sys.stdout.flush()


def set_selection(selection):
    """Select exactly the named objects (or everything when selection is None)."""
    if selection is not None:
        missing = [name for name in selection if name not in bpy.data.objects]
        if missing:
            raise ValueError("selection objects not found: %r" % (missing,))
    for obj in bpy.data.objects:
        obj.select_set(selection is None or obj.name in selection)
    if selection:
        active = bpy.data.objects.get(selection[0])
        if active is not None:
            try:
                bpy.context.view_layer.objects.active = active
            except Exception:  # noqa: BLE001 - non-fatal context tweak
                pass
    return bool(selection)


def main():
    argv = bridge_argv()
    if len(argv) < 2:
        raise SystemExit("usage: blender -b <file> --python export_asset.py -- <config.json> <report.json>")
    config_path, report_path = argv[0], argv[1]
    with open(config_path) as handle:
        config = json.load(handle)

    export_format = config.get("format")
    if export_format not in ALLOWED_FORMATS:
        raise ValueError("unsupported export format: %r" % (export_format,))
    output_path = config.get("outputPath")
    if not isinstance(output_path, str) or not output_path:
        raise ValueError("missing outputPath")

    selection = config.get("selection")
    if selection is not None and not isinstance(selection, list):
        raise ValueError("selection must be a list of object names")
    selected_only = set_selection(selection)

    if export_format == "OBJ":
        bpy.ops.wm.obj_export(filepath=output_path, export_selected_objects=selected_only)
    elif export_format == "GLTF":
        bpy.ops.export_scene.gltf(filepath=output_path, use_selection=selected_only)
    elif export_format == "FBX":
        bpy.ops.export_scene.fbx(filepath=output_path, use_selection=selected_only)

    base, ext = os.path.splitext(output_path)
    candidates = [output_path, output_path + ".glb", base + ".glb", base + ".bin"]
    written = next((candidate for candidate in candidates if os.path.exists(candidate)), None)
    if written is None:
        raise RuntimeError("export did not produce an artifact at %r" % (output_path,))
    if os.path.getsize(written) <= 0:
        raise RuntimeError("export artifact is empty: %r" % (written,))

    write_report(
        report_path,
        {
            "ok": True,
            "writtenTo": written,
            "bytes": os.path.getsize(written),
            "format": export_format,
            "selection": selection,
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
    sys.stderr.write("export_asset bridge failed: %s\n" % (exc,))
    sys.exit(1)
