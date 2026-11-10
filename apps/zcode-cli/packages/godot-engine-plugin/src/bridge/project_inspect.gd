# Gamos Godot bridge: inspect the project through the ENGINE's own loaded
# state (data-only, fixed committed template).
#
# Invocation shape (argument array, never a shell):
#   godot --headless --path <projectRoot> --script project_inspect.gd \
#         -- <input.json> <report.json>
#
# The input JSON is a frozen typed-op payload (validated in TypeScript before
# the spawn); this bridge re-validates every field it consumes. It maps the
# data to explicit Godot API calls only — no eval-equivalents, no free-form
# GDScript, and no payload value ever becomes code. The report is a JSON file
# written to the given path and pointed at by the stdout marker
# GAMOS_GODOT_REPORT:<path>. Teardown ordering is deterministic: the report is
# written BEFORE quit(); the "ObjectDB instances leaked at exit" warning is a
# benign artifact of the _init()-based SceneTree script pattern (verified
# against Godot 4.2.2-stable).
extends SceneTree

const MARKER: String = "GAMOS_GODOT_REPORT:"
const MAX_SCRIPT_SCAN_DEPTH: int = 8

func _init() -> void:
	var user_args: PackedStringArray = OS.get_cmdline_user_args()
	if user_args.size() != 2:
		push_error("gamos-bridge: expected <input.json> <report.json> after --")
		quit(2)
		return
	var input_path: String = user_args[0]
	var report_path: String = user_args[1]

	var input: Variant = _read_json(input_path)
	if not (input is Dictionary):
		_write_report(report_path, {
			"ok": false,
			"error": "bridge-input-unreadable",
			"path": input_path,
		})
		quit(3)
		return

	var report: Dictionary = _inspect_project(input)
	_write_report(report_path, report)
	quit(0 if report.get("ok", false) else 1)


## Engine-side read-back: everything reported comes from THIS engine run's
## ProjectSettings (loaded from the real project.godot), Engine version info
## and a bounded filesystem scan — never a cached value.
func _inspect_project(_input: Dictionary) -> Dictionary:
	var vi: Dictionary = Engine.get_version_info()
	var features: Variant = ProjectSettings.get_setting("application/config/features", [])
	var config_features: Array = []
	if features is Array or features is PackedStringArray:
		for feature in features:
			config_features.append(str(feature))
	config_features.sort()
	var main_scene: String = str(ProjectSettings.get_setting("run/main_scene", ""))
	return {
		"ok": true,
		"engineVersionInfo": {
			"major": int(vi.get("major", 0)),
			"minor": int(vi.get("minor", 0)),
			"patch": int(vi.get("patch", 0)),
			"status": str(vi.get("status", "")),
			"build": str(vi.get("build", "")),
		},
		"configVersion": _read_config_version("res://project.godot"),
		"projectName": str(ProjectSettings.get_setting("application/config/name", "")),
		"configFeatures": config_features,
		"hasScripts": _scan_scripts("res://", 0),
		"mainScene": "" if main_scene.is_empty() else main_scene,
	}


## Parse config_version from the FIRST line of the real project.godot file as
## read by this engine process (the engine's own header contract).
func _read_config_version(project_path: String) -> int:
	var f: FileAccess = FileAccess.open(project_path, FileAccess.READ)
	if f == null:
		return -1
	var first_line: String = f.get_line()
	f.close()
	var re: RegEx = RegEx.new()
	if re.compile("^\\s*config_version=(\\d+)\\s*$") != Error.OK:
		return -1
	var m: RegExMatch = re.search(first_line)
	if m == null:
		return -1
	return int(m.get_string(1))


## Bounded, deterministic scan for res:// *.gd scripts (sorted; depth-capped;
## dot-directories and generated dirs skipped).
func _scan_scripts(base: String, depth: int) -> Array:
	var found: Array = []
	if depth > MAX_SCRIPT_SCAN_DEPTH:
		return found
	var dir: DirAccess = DirAccess.open(base)
	if dir == null:
		return found
	dir.list_dir_begin()
	var entry: String = dir.get_next()
	while not entry.is_empty():
		if not entry.begins_with(".") and entry != "builds":
			var full: String = base.path_join(entry)
			if dir.current_is_dir():
				found.append_array(_scan_scripts(full, depth + 1))
			elif entry.ends_with(".gd"):
				found.append(full)
		entry = dir.get_next()
	dir.list_dir_end()
	found.sort()
	return found


func _read_json(path: String) -> Variant:
	var f: FileAccess = FileAccess.open(path, FileAccess.READ)
	if f == null:
		return null
	var text: String = f.get_as_text()
	f.close()
	return JSON.parse_string(text)


func _write_report(report_path: String, report: Dictionary) -> void:
	var f: FileAccess = FileAccess.open(report_path, FileAccess.WRITE)
	if f == null:
		push_error("gamos-bridge: cannot write report " + report_path)
		return
	f.store_string(JSON.stringify(report))
	f.close()
	print(MARKER + report_path)
