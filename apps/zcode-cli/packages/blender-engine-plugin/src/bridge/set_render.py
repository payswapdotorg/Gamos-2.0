"""Gamos blender bridge: configure and run a headless still render.

Fixed, committed template. Reads a JSON input file (argv after ``--``):

    {"outputPath": "...", "engine": "CYCLES"|"BLENDER_EEVEE", "resolution": {"x":160,"y":120}}

Configures the render settings explicitly (Cycles defaults to the CPU device),
then renders frame 1 with ``bpy.ops.render.render(write_still=True)`` so the
artifact lands exactly at the requested path. If the scene has no camera, a
default camera is provisioned so the render can proceed; this is disclosed in
the report (``cameraProvisioned``) — never a silent success.

Note: the render is driven from this script on purpose. Blender processes
command-line arguments in order, so a trailing ``--python`` after ``-a`` runs
only AFTER the animation render (with default settings), and ``-a`` appends
frame numbers to the output path. Script-driven rendering is the only variant
that applies the requested settings and writes the exact requested path.
"""

import json
import os
import sys
import traceback

import bpy

MARKER = "GAMOS_BRIDGE_REPORT:"

ALLOWED_ENGINES = ("CYCLES", "BLENDER_EEVEE")


def bridge_argv():
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return []


def write_report(report_path, payload):
    with open(report_path, "w") as handle:
        json.dump(payload, handle)
    print(MARKER + report_path)
    sys.stdout.flush()


def main():
    argv = bridge_argv()
    if len(argv) < 2:
        raise SystemExit("usage: blender -b <file> --python set_render.py -- <config.json> <report.json>")
    config_path, report_path = argv[0], argv[1]
    with open(config_path) as handle:
        config = json.load(handle)

    scene = bpy.context.scene
    engine = config.get("engine") or "CYCLES"
    if engine not in ALLOWED_ENGINES:
        raise ValueError("unsupported render engine: %r" % (engine,))
    scene.render.engine = engine

    device = None
    if engine == "CYCLES":
        scene.cycles.device = "CPU"
        device = "CPU"

    resolution = config.get("resolution")
    if resolution:
        scene.render.resolution_x = int(resolution["x"])
        scene.render.resolution_y = int(resolution["y"])

    output_path = config.get("outputPath")
    if not isinstance(output_path, str) or not output_path:
        raise ValueError("missing outputPath")

    camera_provisioned = False
    if scene.camera is None:
        bpy.ops.object.camera_add(location=(7.36, -6.93, 4.96), rotation=(1.109, 0.0, 0.815))
        scene.camera = bpy.context.active_object
        camera_provisioned = True

    scene.render.filepath = output_path
    scene.render.image_settings.file_format = "PNG"
    scene.render.use_file_extension = True

    bpy.ops.render.render(write_still=True)

    written = output_path if os.path.exists(output_path) else output_path + ".png"
    if not os.path.exists(written):
        raise RuntimeError("render did not produce an artifact at %r" % (written,))
    if os.path.getsize(written) <= 0:
        raise RuntimeError("render artifact is empty: %r" % (written,))

    write_report(
        report_path,
        {
            "ok": True,
            "writtenTo": written,
            "bytes": os.path.getsize(written),
            "engine": engine,
            "device": device,
            "resolutionX": int(scene.render.resolution_x),
            "resolutionY": int(scene.render.resolution_y),
            "cameraProvisioned": camera_provisioned,
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
    sys.stderr.write("set_render bridge failed: %s\n" % (exc,))
    sys.exit(1)
