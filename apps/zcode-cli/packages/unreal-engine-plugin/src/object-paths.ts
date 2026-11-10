/**
 * Strict Unreal object-path grammar validation (M4 WP-5) — readiness §2.2
 * U-T5: object paths are validated BEFORE any request is built (fail-closed
 * parse, the parseGodotVersion discipline); no free-form URL construction
 * exists anywhere in the connector.
 *
 * The grammar accepts the documented Unreal object-path shapes:
 *   /Game/FirstPerson/Maps/FirstPersonMap.FirstPersonMap:PersistentLevel.Light_1
 *   /Script/Engine.PointLight
 *   /Game/UI/MyWidget.MyWidget_C:WidgetTree:Panel:Opacity
 * i.e. an absolute package path whose segments are identifier-safe, an
 * optional dotted object-name component on the LAST segment, and one to
 * three colon-separated sub-object components. Everything else — relative
 * paths, traversal (`..`), double slashes, query strings, URL-encoded or
 * credential-carrying text, whitespace/control characters, non-ASCII — fails
 * closed with a named reason and NO network round-trip ever happens.
 */

/** The maximum accepted object-path length (bounded input, no runaway parses). */
export const MAX_OBJECT_PATH_LENGTH = 512;

/** Sub-object component limit (`:A:B:C` is the deepest documented shape). */
const MAX_SUBOBJECT_COMPONENTS = 3;

const SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;
const NAME_COMPONENT_PATTERN = /^[A-Za-z0-9_-]+$/;
/** Sub-object components may be dot-chained (`:PersistentLevel.PointLight_1`). */
const SUBOBJECT_COMPONENT_PATTERN = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;

export type ObjectPathParseResult =
  | { ok: true; objectPath: string; path: string; objectName: string; subobjects: string[] }
  | { ok: false; reason: string };

/**
 * Validates an Unreal object path against the strict grammar. Pure and
 * synchronous — this runs client-side BEFORE any request is built (the G2
 * RED-plan "invalid object paths fail closed client-side" row and the G3
 * invalid-object-path challenge).
 */
export function parseUnrealObjectPath(input: string): ObjectPathParseResult {
  if (typeof input !== "string" || input.length === 0) {
    return { ok: false, reason: "object path must be a non-empty string" };
  }
  if (input.length > MAX_OBJECT_PATH_LENGTH) {
    return { ok: false, reason: `object path exceeds the ${MAX_OBJECT_PATH_LENGTH}-character bound` };
  }
  if (!/^[\x20-\x7E]*$/.test(input)) {
    return { ok: false, reason: "object path contains non-printable-ASCII characters" };
  }
  if (/\s/.test(input)) {
    return { ok: false, reason: "object path contains whitespace" };
  }
  if (!input.startsWith("/")) {
    return { ok: false, reason: "object path must be absolute (start with '/')" };
  }
  if (input.startsWith("//")) {
    return { ok: false, reason: "object path contains an empty segment ('//')" };
  }
  if (input.includes("?") || input.includes("&") || input.includes("=") || input.includes("%")) {
    return { ok: false, reason: "object path contains query-string/URL-encoding characters (credential smuggling refused)" };
  }
  if (input.includes("@") || input.includes("://")) {
    return { ok: false, reason: "object path contains URI/credential syntax (refused)" };
  }
  if (input.includes("\\")) {
    return { ok: false, reason: "object path contains a backslash separator (refused)" };
  }

  const colonIndex = input.indexOf(":");
  const pathPart = colonIndex === -1 ? input : input.slice(0, colonIndex);
  const subobjectPart = colonIndex === -1 ? "" : input.slice(colonIndex + 1);

  if (pathPart.endsWith("/") || pathPart === "/") {
    return { ok: false, reason: "object path must not end or consist of a bare separator" };
  }

  const segments = pathPart.slice(1).split("/");
  for (const segment of segments) {
    if (segment.length === 0) {
      return { ok: false, reason: "object path contains an empty segment" };
    }
    if (segment === "." || segment === "..") {
      return { ok: false, reason: "object path contains a traversal segment (refused)" };
    }
    // Interior segments carry no dots: package directories are identifier-safe.
    // The LAST segment may be `ObjectName` or `Package.ObjectName` (dotted
    // object-name component) — validated below.
    if (segment.includes(".") && segment !== segments[segments.length - 1]) {
      return { ok: false, reason: "object path contains a dotted non-final segment (grammar violation)" };
    }
    if (!SEGMENT_PATTERN.test(segment.replace(/\./g, ""))) {
      return { ok: false, reason: "object path segment contains characters outside the identifier grammar" };
    }
  }

  const lastSegment = segments[segments.length - 1] ?? "";
  const nameComponents = lastSegment.split(".");
  if (nameComponents.length > 2) {
    return { ok: false, reason: "object path final segment carries more than one dotted object-name component" };
  }
  for (const component of nameComponents) {
    if (component.length === 0 || !NAME_COMPONENT_PATTERN.test(component)) {
      return { ok: false, reason: "object path object-name component violates the identifier grammar" };
    }
  }

  let subobjects: string[] = [];
  if (colonIndex !== -1) {
    subobjects = subobjectPart.split(":");
    if (subobjects.length === 0 || subobjects.length > MAX_SUBOBJECT_COMPONENTS) {
      return { ok: false, reason: `object path sub-object component count outside 1..${MAX_SUBOBJECT_COMPONENTS}` };
    }
    for (const sub of subobjects) {
      if (sub.length === 0 || !SUBOBJECT_COMPONENT_PATTERN.test(sub)) {
        return { ok: false, reason: "object path sub-object component violates the identifier grammar" };
      }
    }
  }

  return {
    ok: true,
    objectPath: input,
    path: pathPart,
    objectName: nameComponents[nameComponents.length - 1] ?? "",
    subobjects,
  };
}

/**
 * Property-name grammar (shared by property.read's allowlisted name set and
 * the mutation allowlist): identifier-safe, bounded, no traversal or
 * smuggling syntax. Malformed names fail closed BEFORE any request is built.
 */
export const MAX_PROPERTY_NAME_LENGTH = 128;
const PROPERTY_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidPropertyName(name: string): boolean {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= MAX_PROPERTY_NAME_LENGTH &&
    PROPERTY_NAME_PATTERN.test(name)
  );
}

/** Function-name grammar for the reviewed per-function allowlist lookups. */
export const MAX_FUNCTION_NAME_LENGTH = 128;
const FUNCTION_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidFunctionName(name: string): boolean {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= MAX_FUNCTION_NAME_LENGTH &&
    FUNCTION_NAME_PATTERN.test(name)
  );
}
