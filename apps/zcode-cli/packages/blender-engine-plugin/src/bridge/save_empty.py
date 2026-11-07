"""Gamos blender bridge: save an empty scene.

Fixed, committed template. Reads a JSON input file (argv after ``--``):

    {"outputPath": "..."}

Deletes every object in the factory-startup scene and saves an empty scene to
the requested path ATOMICALLY (save to a temp file, then os.replace onto the
target so no reader ever observes a half-written .blend).
"""

import json
import os
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


def main():
    argv = bridge_argv()
    if len(argv) < 2:
        raise SystemExit("usage: blender -b --factory-startup --python save_empty.py -- <input.json> <report.json>")
    config_path, report_path = argv[0], argv[1]
    with open(config_path) as handle:
        config = json.load(handle)

    output_path = config.get("outputPath")
    if not isinstance(output_path, str) or not output_path:
        raise ValueError("missing outputPath")

    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)

    tmp = output_path + ".gamos-tmp.blend"
    bpy.ops.wm.save_as_mainfile(filepath=tmp, copy=True)
    os.replace(tmp, output_path)

    if not os.path.exists(output_path) or os.path.getsize(output_path) <= 0:
        raise RuntimeError("saved blend is missing or empty: %r" % (output_path,))

    write_report(
        report_path,
        {
            "ok": True,
            "writtenTo": output_path,
            "bytes": os.path.getsize(output_path),
            "blenderVersion": bpy.app.version_string,
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
    sys.stderr.write("save_empty bridge failed: %s\n" % (exc,))
    sys.exit(1)
