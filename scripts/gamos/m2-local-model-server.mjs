#!/usr/bin/env node
/* eslint-disable max-lines -- Deterministic local model endpoint for the M2 engine journey. */
/**
 * Gamos M2 — deterministic local Anthropic-Messages endpoint (journey-owned).
 *
 * Derived from scripts/gamos/m1-local-model-server.mjs (same protocol scaffolding,
 * same honesty model), extended for the M2 §9 engine journeys:
 *
 * HONESTY MODEL (unchanged from M1):
 *   - This endpoint is a scripted deterministic model, NOT a real LLM. It exists
 *     so the journey can verify the APP side of the engine integrations (provider
 *     configuration, session turns, tool-use round-trips through the real agent
 *     runtime, MCP plugin tool dispatch, permission gates, engine execution,
 *     artifact evidence, session history) without an external paid inference
 *     provider. No evidence produced against this endpoint may claim real-LLM
 *     authorship; the transcript records every request (including the tool list
 *     the app actually offered — the engine tool visibility proof).
 *   - The tool calls it emits reference ONLY the journey's own staged workspaces
 *     (the .blend bootstrap, the committed Babylon fixture, the Unity fixture)
 *     through the plugins' REAL typed-operation schemas. The endpoint never
 *     invents capabilities: every tool name it calls is matched against the
 *     tool list the app actually sent in the request.
 *
 * SCENARIO ENGINE (M2): requests are matched on the LAST USER TEXT MESSAGE plus
 * the tool-use history, and — critically — against the REQUEST'S OWN tool list:
 * the engine MCP tools are called under whatever name the app exposed them as
 * (mcp__plugin_<name>_engine__<tool>), directly when present, or through
 * DeferredToolCall when the app runs with tool-search enabled. A task whose
 * engine tool is NOT in the offered tool list fails VISIBLELY (structured error
 * text) instead of silently calling a name the app would reject.
 *
 * Env:
 *   M2_LOCAL_MODEL_PORT       — listen port (default 4373)
 *   M2_LOCAL_MODEL_DELAY_MS   — artificial response delay (default 300)
 *   M2_LOCAL_MODEL_TRANSCRIPT — JSONL request transcript path (evidence)
 */
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const PORT = Number(process.env.M2_LOCAL_MODEL_PORT ?? 4373);
const HOST = "127.0.0.1";
const DELAY_MS = Math.max(0, Number(process.env.M2_LOCAL_MODEL_DELAY_MS ?? 300));
const TRANSCRIPT = process.env.M2_LOCAL_MODEL_TRANSCRIPT ?? "";
const MODEL_ID = process.env.M2_LOCAL_MODEL_MODEL_ID ?? "gamos-m2-deterministic-model";
const STARTED_AT = new Date().toISOString();

let served = 0;
let counter = 0;
const nextId = (prefix) => `${prefix}_local_${String(++counter).padStart(3, "0")}`;

function log(...args) {
  console.log(`[m2-local-model] ${args.join(" ")}`);
}

function transcript(entry) {
  if (!TRANSCRIPT) return;
  try {
    appendFileSync(TRANSCRIPT, `${JSON.stringify(entry)}\n`);
  } catch { /* evidence best-effort — never break the endpoint */ }
}

/* ------------------------------------------------------------------ */
/* Request parsing                                                     */
/* ------------------------------------------------------------------ */

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 32 * 1024 * 1024) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function messageText(message) {
  if (!isRecord(message)) return "";
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!isRecord(part)) return "";
      if (typeof part.text === "string") return part.text;
      if (part.type === "tool_result") return messageContentText(part.content);
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function messageContentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

function messageHasToolResult(message) {
  if (!isRecord(message) || !Array.isArray(message.content)) return false;
  return message.content.some((part) => isRecord(part) && part.type === "tool_result");
}

/** Parsed view of the request messages used by every scenario matcher. */
function analyzeMessages(requestJson) {
  const messages = Array.isArray(requestJson?.messages) ? requestJson.messages : [];
  const toolUses = new Map(); // tool_use id -> tool name
  const toolUseNames = new Set();
  for (const message of messages) {
    if (!isRecord(message) || message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (isRecord(part) && part.type === "tool_use" && typeof part.name === "string") {
        toolUses.set(part.id, part.name);
        toolUseNames.add(part.name);
      }
    }
  }
  let lastUserTaskText = "";
  let lastUserTaskIndex = -1;
  // The attempt anchor: the last REAL task message (non-tool-result user
  // message). When the browser pane is open the app injects
  // <in-app-browser-context> blocks as ADDITIONAL user messages AFTER tool
  // results — anchoring on the last non-tool-result message would then drop
  // the current attempt's results from the window (run-15 lesson: the
  // successfully-stopped project_stop result was hidden and the scenario
  // re-issued the call in a loop). Prefer the last message carrying a
  // GAMOS-M2 task marker; fall back to the last non-tool-result message.
  let fallbackTaskIndex = -1;
  let fallbackTaskText = "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!isRecord(message) || message.role !== "user") continue;
    if (messageHasToolResult(message)) continue;
    const text = messageText(message);
    if (lastUserTaskIndex === -1 && text.includes("GAMOS-M2-")) {
      lastUserTaskText = text;
      lastUserTaskIndex = i;
      break;
    }
    if (fallbackTaskIndex === -1) {
      fallbackTaskIndex = i;
      fallbackTaskText = text;
    }
  }
  if (lastUserTaskIndex === -1) {
    lastUserTaskIndex = fallbackTaskIndex;
    lastUserTaskText = fallbackTaskText;
  }
  // ALL tool results of the CURRENT attempt (after the anchor message) IN
  // ORDER — a resubmitted task must not inherit the previous attempt's
  // denied/failed results (the approved retry after a denial starts clean),
  // while multi-step flows still see results beyond the last message
  // (run-9 lesson: after a render result the modify result lives earlier in
  // the history).
  const toolResults = [];
  for (let i = Math.max(lastUserTaskIndex, 0); i < messages.length; i += 1) {
    const message = messages[i];
    if (!isRecord(message) || message.role !== "user" || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (isRecord(part) && part.type === "tool_result") {
        toolResults.push({ name: toolUses.get(part.tool_use_id) ?? "(unknown)", text: messageContentText(part.content) });
      }
    }
  }
  const last = messages[messages.length - 1];
  let lastToolResult = null;
  if (isRecord(last) && last.role === "user" && messageHasToolResult(last)) {
    const names = [];
    for (const part of last.content) {
      if (isRecord(part) && part.type === "tool_result") {
        names.push({ name: toolUses.get(part.tool_use_id) ?? "(unknown)", text: messageContentText(part.content) });
      }
    }
    lastToolResult = { names };
  }
  return { lastUserTaskText, toolUseNames, lastToolResult, toolResults, messageCount: messages.length };
}

/** The tool names the app actually offered in this request (visibility proof). */
function offeredToolNames(requestJson) {
  const tools = Array.isArray(requestJson?.tools) ? requestJson.tools : [];
  return tools.map((t) => (isRecord(t) && typeof t.name === "string" ? t.name : null)).filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* Engine tool-call helpers (matched against the OFFERED tool list)    */
/* ------------------------------------------------------------------ */

const BLENDER_MODIFY_TOOL = /mcp__plugin_blender-engine_\w*__scene_modify/;
const BLENDER_RENDER_TOOL = /mcp__plugin_blender-engine_\w*__scene_render/;
const BLENDER_INSPECT_TOOL = /mcp__plugin_blender-engine_\w*__scene_inspect/;
const BABYLON_INSPECT_TOOL = /mcp__plugin_babylon-engine_\w*__project_inspect/;
const BABYLON_BUILD_TOOL = /mcp__plugin_babylon-engine_\w*__project_build/;
const BABYLON_RUN_TOOL = /mcp__plugin_babylon-engine_\w*__project_run/;
const BABYLON_STOP_TOOL = /mcp__plugin_babylon-engine_\w*__project_stop/;
const UNITY_INSPECT_TOOL = /mcp__plugin_unity-engine_\w*__project_inspect/;
const UNITY_MODIFY_TOOL = /mcp__plugin_unity-engine_\w*__scene_modify/;
const DEFERRED_TOOL = /^DeferredToolCall$/;

/**
 * Builds a tool_use response entry for an engine operation, calling the tool
 * DIRECTLY when the app offered it in this request, or through
 * DeferredToolCall (with the canonical namespaced tool name — the naming is
 * deterministic: mcp__plugin_<plugin>_<server>__<tool>) when the app runs with
 * local tool-search and the MCP tools are deferred. Returns null when neither
 * surface can carry the call — the scenario then fails visibly instead of
 * inventing a name the app would reject.
 */
function toolCallFor(offer, toolPattern, canonicalName, input) {
  const direct = offer.tools.find((t) => toolPattern.test(t));
  if (direct) return { name: direct, input };
  const deferred = offer.tools.find((t) => DEFERRED_TOOL.test(t));
  if (deferred && canonicalName) {
    return { name: "DeferredToolCall", input: { name: canonicalName, input } };
  }
  return null;
}

const CANONICAL = {
  blenderModify: "mcp__plugin_blender-engine_engine__scene_modify",
  blenderRender: "mcp__plugin_blender-engine_engine__scene_render",
  babylonBuild: "mcp__plugin_babylon-engine_engine__project_build",
  babylonRun: "mcp__plugin_babylon-engine_engine__project_run",
  babylonStop: "mcp__plugin_babylon-engine_engine__project_stop",
  unityInspect: "mcp__plugin_unity-engine_engine__project_inspect",
  unityModify: "mcp__plugin_unity-engine_engine__scene_modify",
};

/* ------------------------------------------------------------------ */
/* Scripted task texts                                                 */
/* ------------------------------------------------------------------ */

function extractJsonField(text, key) {
  const m = text.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`));
  return m?.[1] ?? null;
}

function extractBlendPath(task) {
  return extractJsonField(task, "blendFile") ?? /([\w./\\-]+\.blend)/.exec(task)?.[1] ?? null;
}

function extractRenderPath(task) {
  return extractJsonField(task, "renderOutput") ?? /([\w./\\-]+\.(?:png|jpg))/i.exec(task)?.[1] ?? null;
}

function extractBabylonRoot(task) {
  return extractJsonField(task, "projectRoot") ?? /([\w./\\-]*babylon[\w./\\-]*)/.exec(task)?.[1] ?? null;
}

function extractUnityRoot(task) {
  return extractJsonField(task, "projectRoot") ?? /([\w./\\-]*unity[\w./\\-]*)/.exec(task)?.[1] ?? null;
}

/* ------------------------------------------------------------------ */
/* Scenario table                                                      */
/* ------------------------------------------------------------------ */

function resolveScenario(requestJson) {
  const { lastUserTaskText, toolUseNames, toolResults } = analyzeMessages(requestJson);
  const tools = offeredToolNames(requestJson);
  const offer = { tools, toolsJoined: tools.join("\n") };
  const task = lastUserTaskText;

  // Full-history result lookup (run-9 lesson: multi-step scenarios must see
  // results BEYOND the last message — after the render result, the modify
  // result lives earlier in the history). DeferredToolCall-wrapped calls come
  // back attributed to the wrapper; match those by RESULT CONTENT signature.
  const resultFor = (pattern, contentPattern) => {
    const hit = [...toolResults].reverse().find((n) => {
      if (pattern.test(n.name)) return true;
      if (DEFERRED_TOOL.test(n.name) && contentPattern && contentPattern.test(n.text)) return true;
      return false;
    });
    return hit ?? null;
  };

  // ---------- Blender journey leg ----------
  if (task.includes("GAMOS-M2-BLENDER-TASK")) {
    const blend = extractBlendPath(task);
    const render = extractRenderPath(task);
    const modifyResult = resultFor(BLENDER_MODIFY_TOOL, /"applied"|blendSha256|GamosJourneyCube|scene_modify/i);
    const renderResult = resultFor(BLENDER_RENDER_TOOL, /imageSha256|"rendered"|scene_render/i);
    const denied = modifyResult && /denied|rejected|permission|not approved|取消|拒绝/i.test(modifyResult.text);
    const failed = modifyResult && /blender-unavailable|unexpected-error|invalid-input|PATH_SAFETY|inputSchema validation|schema violation/i.test(modifyResult.text);

    // Step 1 — modify (the permission-gated native mutation).
    if (!modifyResult) {
      const call = toolCallFor(offer, BLENDER_MODIFY_TOOL, CANONICAL.blenderModify, {
        blendFile: blend,
        operations: [
          { op: "add-primitive", primitive: "cube", name: "GamosJourneyCube", location: [0, 0, 1] },
          { op: "set-material-color", target: "GamosJourneyCube", color: [0.8, 0.2, 0.2] },
        ],
        save: true,
      });
      if (!call) {
        return {
          scenario: "blender-tool-missing",
          text: `STRUCTURED FAILURE: the app did not offer a Blender scene_modify MCP tool in this request (offered: ${tools.filter((t) => /blender/i.test(t)).join(", ") || "none"}). The engine plugin is not enabled or its MCP server is not registered — refusing to fabricate a tool call.`,
        };
      }
      return {
        scenario: "blender-scene-modify",
        toolUses: [call],
      };
    }
    // Step 2 — render (only after a successful modify).
    if (modifyResult && !denied && !failed && !renderResult) {
      const call = toolCallFor(offer, BLENDER_RENDER_TOOL, CANONICAL.blenderRender, {
        blendFile: blend,
        outputPath: render,
        engine: "CYCLES",
        resolution: { x: 160, y: 120 },
      });
      if (!call) {
        return {
          scenario: "blender-render-tool-missing",
          text: `STRUCTURED FAILURE: scene_modify succeeded but no scene_render MCP tool was offered (offered blender tools: ${tools.filter((t) => /blender/i.test(t)).join(", ") || "none"}).`,
        };
      }
      return { scenario: "blender-scene-render", toolUses: [call] };
    }
    // Step 3 — final text summarizing the verified artifacts (or the honest failure).
    if (denied) {
      return {
        scenario: "blender-denied-summary",
        text: [
          "The Blender scene modification was NOT performed: the permission request was denied by the user.",
          "No .blend file was rewritten (the engine mutation is blocked at the existing ZCode permission gate — this denial is the honest negative path).",
          "I will not retry the modification without an explicit approval.",
        ].join("\n"),
      };
    }
    if (failed) {
      return {
        scenario: "blender-failure-summary",
        text: `The Blender engine operation failed with a structured error: ${modifyResult.text.slice(0, 400)}`,
      };
    }
    if (renderResult) {
      const sha = /"imageSha256"\s*:\s*"([0-9a-f]{64})"/.exec(renderResult.text)?.[1] ?? "(see tool result)";
      const savedSha = /"sha256"\s*:\s*"([0-9a-f]{64})"/.exec(modifyResult.text)?.[1] ?? "(see tool result)";
      return {
        scenario: "blender-final-summary",
        text: [
          "Blender journey leg complete — the typed operations ran through the real engine:",
          `- scene_modify: add-primitive cube "GamosJourneyCube" + set-material-color, saved; the engine re-opened and VERIFIED the scene state. Saved .blend sha256: ${savedSha}.`,
          `- scene_render: real Cycles CPU render; PNG artifact sha256: ${sha}.`,
          "Both artifacts exist on disk with recorded hashes; the results above are the engine's own verified outputs (not process exits).",
        ].join("\n"),
      };
    }
    return { scenario: "blender-modify-summary", text: `scene_modify completed: ${modifyResult.text.slice(0, 400)}` };
  }

  // ---------- Babylon journey leg ----------
  if (task.includes("GAMOS-M2-BABYLON-TASK")) {
    const root = extractBabylonRoot(task);
    const buildResult = resultFor(BABYLON_BUILD_TOOL, /"dist"|indexHtmlSha256|project_build|vite/i);
    const runResult = resultFor(BABYLON_RUN_TOOL, /"url"|runtime url|project_run|127\.0\.0\.1:\d+/i);
    const stopResult = resultFor(BABYLON_STOP_TOOL, /stopped|port[\s_]?free|project_stop/i);

    if (!buildResult) {
      const call = toolCallFor(offer, BABYLON_BUILD_TOOL, CANONICAL.babylonBuild, { projectRoot: root });
      if (!call) {
        return {
          scenario: "babylon-tool-missing",
          text: `STRUCTURED FAILURE: no Babylon project_build MCP tool was offered (offered: ${tools.filter((t) => /babylon/i.test(t)).join(", ") || "none"}). The engine plugin is not enabled or its MCP server is not registered — refusing to fabricate a tool call.`,
        };
      }
      return { scenario: "babylon-project-build", toolUses: [call] };
    }
    if (buildResult && !runResult) {
      const call = toolCallFor(offer, BABYLON_RUN_TOOL, CANONICAL.babylonRun, { projectRoot: root });
      if (!call) {
        return {
          scenario: "babylon-run-tool-missing",
          text: `STRUCTURED FAILURE: project_build succeeded but no project_run MCP tool was offered (offered babylon tools: ${tools.filter((t) => /babylon/i.test(t)).join(", ") || "none"}).`,
        };
      }
      return { scenario: "babylon-project-run", toolUses: [call] };
    }
    if (runResult && !stopResult) {
      const url = /(https?:\/\/127\.0\.0\.1:\d+)/.exec(runResult.text)?.[1] ?? "(url in tool result)";
      return {
        scenario: "babylon-run-summary",
        text: [
          "Babylon runtime leg complete — the typed operations ran through the real Node/Vite toolchain:",
          `- project_build: real vite build; dist artifact verified with sha256 (see tool result).`,
          `- project_run: the declared dev script started a REAL dev server; its health-checked runtime URL is ${url}.`,
          `The running Babylon experience is now verifiable in the ZCode Browser at ${url} — the page mounts a real Babylon.js engine on a <canvas> and flips window.__GAMOS_BABYLON_READY__ after the first rendered frame.`,
          "The server keeps running (tracked runtime); it will be cancelled through project_stop after the browser verification.",
        ].join("\n"),
      };
    }
    if (stopResult) {
      return {
        scenario: "babylon-stop-summary",
        text: "The Babylon dev-server runtime was cancelled through project_stop (process-group termination; the port was verified free). Journey leg closed.",
      };
    }
    return { scenario: "babylon-build-summary", text: `project_build completed: ${buildResult.text.slice(0, 300)}` };
  }

  // ---------- Babylon stop task (separate user turn after browser verification) ----------
  if (task.includes("GAMOS-M2-BABYLON-STOP")) {
    // A completed stop result ends the flow with the summary (run-16 lesson:
    // this branch unconditionally re-issued the call, looping the engine
    // stop + permission dialog until the turn timed out).
    const stopDone = resultFor(BABYLON_STOP_TOOL, /stopped|port[\s_]?freed|project_stop|cancelled/i);
    if (stopDone) {
      return {
        scenario: "babylon-stop-summary",
        text: "The Babylon dev-server runtime was cancelled through project_stop (process-group termination; the port was verified free). Journey leg closed.",
      };
    }
    // The pid was in the project_run tool result earlier in the conversation.
    const pidMatch = /"pid"\s*:\s*(\d+)/.exec(task) ?? /pid[=: ]+(\d+)/.exec(task);
    const pid = pidMatch ? Number(pidMatch[1]) : null;
    if (!pid) {
      return { scenario: "babylon-stop-missing-pid", text: "STRUCTURED FAILURE: no runtime pid available to stop — the project_run result did not carry one." };
    }
    const call = toolCallFor(offer, BABYLON_STOP_TOOL, CANONICAL.babylonStop, { pid });
    if (!call) {
      return { scenario: "babylon-stop-tool-missing", text: `STRUCTURED FAILURE: no project_stop MCP tool was offered (offered babylon tools: ${tools.filter((t) => /babylon/i.test(t)).join(", ") || "none"}).` };
    }
    return { scenario: "babylon-project-stop", toolUses: [call] };
  }

  // ---------- Unity honest-negative journey leg ----------
  if (task.includes("GAMOS-M2-UNITY-TASK")) {
    const root = extractUnityRoot(task);
    const inspectResult = resultFor(UNITY_INSPECT_TOOL, /unityVersion|projectVersion|project_inspect|"family"\s*:\s*"unity"/i);
    const modifyResult = resultFor(UNITY_MODIFY_TOOL, /exitStatus|unity-editor-unavailable|scene_modify|add-cube/i);

    if (!inspectResult) {
      const call = toolCallFor(offer, UNITY_INSPECT_TOOL, CANONICAL.unityInspect, { projectRoot: root });
      if (!call) {
        return {
          scenario: "unity-tool-missing",
          text: `STRUCTURED FAILURE: no Unity project_inspect MCP tool was offered (offered: ${tools.filter((t) => /unity/i.test(t)).join(", ") || "none"}). The engine plugin is not enabled or its MCP server is not registered — refusing to fabricate a tool call.`,
        };
      }
      return { scenario: "unity-project-inspect", toolUses: [call] };
    }
    if (inspectResult && !modifyResult) {
      const call = toolCallFor(offer, UNITY_MODIFY_TOOL, CANONICAL.unityModify, {
        projectRoot: root,
        operation: "scene.add-cube",
        parameters: { name: "GamosJourneyCube", location: [0, 1, 0] },
      });
      if (!call) {
        return {
          scenario: "unity-modify-tool-missing",
          text: `STRUCTURED FAILURE: project_inspect succeeded but no scene_modify MCP tool was offered (offered unity tools: ${tools.filter((t) => /unity/i.test(t)).join(", ") || "none"}).`,
        };
      }
      return { scenario: "unity-scene-modify", toolUses: [call] };
    }
    if (modifyResult) {
      const unavailable = /unity-editor-unavailable|unavailable|license|not discovered/i.test(modifyResult.text);
      return {
        scenario: unavailable ? "unity-honest-unavailable-summary" : "unity-modify-summary",
        text: unavailable
          ? [
              "The Unity scene modification was NOT performed — the honest unavailable state surfaced by the engine:",
              modifyResult.text.slice(0, 500),
              "No Unity Editor is installed/licensed on this machine, so the mutation fails closed with an explicit reason instead of being fabricated. This is the honest negative path: the capability, permission gate and typed contract are all real; only the external engine prerequisite is missing.",
            ].join("\n")
          : `scene_modify completed: ${modifyResult.text.slice(0, 400)}`,
      };
    }
    return { scenario: "unity-inspect-summary", text: `project_inspect completed: ${inspectResult.text.slice(0, 300)}` };
  }

  // ---------- Fallback (sidecar requests: titles, notifications) ----------
  return { scenario: "fallback-text", text: "Understood — proceeding. (deterministic local endpoint)" };
}

/* ------------------------------------------------------------------ */
/* Anthropic Messages response synthesis (same shapes as the M1 server)*/
/* ------------------------------------------------------------------ */

function usage(inputTokens = 512, outputTokens = 64) {
  return {
    input_tokens: inputTokens,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: outputTokens,
    service_tier: "standard",
  };
}

function sseEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function textSseBody(model, text) {
  return [
    sseEvent("message_start", {
      type: "message_start",
      message: {
        id: nextId("msg"),
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: usage(512, 0),
      },
    }),
    sseEvent("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    }),
    sseEvent("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    }),
    sseEvent("content_block_stop", { type: "content_block_stop", index: 0 }),
    sseEvent("message_delta", {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: usage(512, 200),
    }),
    sseEvent("message_stop", { type: "message_stop" }),
  ].join("");
}

function toolUsesSseBody(model, toolUses) {
  const events = [
    sseEvent("message_start", {
      type: "message_start",
      message: {
        id: nextId("msg"),
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: usage(512, 0),
      },
    }),
  ];
  toolUses.forEach((toolUse, index) => {
    events.push(
      sseEvent("content_block_start", {
        type: "content_block_start",
        index,
        content_block: {
          type: "tool_use",
          id: nextId("toolu"),
          name: toolUse.name,
          input: {},
        },
      }),
      sseEvent("content_block_delta", {
        type: "content_block_delta",
        index,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(toolUse.input) },
      }),
      sseEvent("content_block_stop", { type: "content_block_stop", index }),
    );
  });
  events.push(
    sseEvent("message_delta", {
      type: "message_delta",
      delta: { stop_reason: "tool_use", stop_sequence: null },
      usage: usage(512, 64 * toolUses.length),
    }),
    sseEvent("message_stop", { type: "message_stop" }),
  );
  return events.join("");
}

function textMessageBody(model, text) {
  return {
    id: nextId("msg"),
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: usage(512, 200),
  };
}

function toolUsesMessageBody(model, toolUses) {
  return {
    id: nextId("msg"),
    type: "message",
    role: "assistant",
    model,
    content: toolUses.map((toolUse) => ({
      type: "tool_use",
      id: nextId("toolu"),
      name: toolUse.name,
      input: toolUse.input,
    })),
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: usage(512, 64 * toolUses.length),
  };
}

/* ------------------------------------------------------------------ */
/* HTTP server                                                         */
/* ------------------------------------------------------------------ */

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";
  served += 1;
  try {
    if (req.method === "GET" && /\/healthz\/?$/.test(url)) {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, model: MODEL_ID, started_at: STARTED_AT, requests_served: served }));
      return;
    }
    if (req.method === "GET" && /\/models\/?$/.test(url)) {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({
        data: [
          {
            id: MODEL_ID,
            type: "model",
            display_name: "Gamos M2 Deterministic Model (local endpoint)",
            created_at: STARTED_AT,
          },
        ],
        has_more: false,
        first_id: MODEL_ID,
        last_id: MODEL_ID,
      }));
      return;
    }
    if (req.method === "POST" && /count_tokens/.test(url)) {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ input_tokens: 256 }));
      return;
    }
    if (req.method === "POST" && /\/(v1\/)?messages/.test(url)) {
      const bodyText = await readRequestBody(req);
      let requestJson = null;
      try {
        requestJson = JSON.parse(bodyText);
      } catch {
        res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "body is not valid JSON" } }));
        return;
      }
      const model = typeof requestJson?.model === "string" ? requestJson.model : MODEL_ID;
      const streaming = requestJson?.stream === true;
      const outcome = resolveScenario(requestJson);
      const kind = outcome.toolUses ? `tool_use:${outcome.toolUses.map((t) => t.name).join("+")}` : "text";
      const tools = offeredToolNames(requestJson);
      transcript({
        at: new Date().toISOString(),
        path: url,
        scenario: outcome.scenario,
        response_kind: kind,
        stream: streaming,
        model,
        messages: analyzeMessages(requestJson).messageCount,
        offered_tools: tools,
        engine_tools_offered: tools.filter((t) => /blender-engine|babylon-engine|unity-engine/.test(t)),
        last_user_task_excerpt: analyzeMessages(requestJson).lastUserTaskText.slice(0, 240),
      });
      log(`POST ${url} -> ${outcome.scenario} (${kind}, stream=${streaming}, engine tools offered: ${tools.filter((t) => /engine/.test(t)).length})`);
      if (DELAY_MS > 0) await new Promise((r) => setTimeout(r, DELAY_MS));
      if (streaming) {
        const body = outcome.toolUses ? toolUsesSseBody(model, outcome.toolUses) : textSseBody(model, outcome.text);
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        });
        res.end(body);
      } else {
        const body = outcome.toolUses ? toolUsesMessageBody(model, outcome.toolUses) : textMessageBody(model, outcome.text);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(body));
      }
      return;
    }
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ type: "error", error: { type: "not_found_error", message: `no handler for ${req.method} ${url}` } }));
  } catch (e) {
    log(`handler failed: ${e instanceof Error ? e.message : String(e)}`);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "local endpoint handler failure" } }));
    } else {
      res.destroy();
    }
  }
});

server.listen(PORT, HOST, () => {
  log(`deterministic local Anthropic-Messages endpoint listening on http://${HOST}:${PORT} (model=${MODEL_ID}, delay=${DELAY_MS}ms)`);
  log(`transcript: ${TRANSCRIPT || "(disabled)"}`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    log(`received ${signal} — closing`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
