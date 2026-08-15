import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { protectPrivateFile } from "./file-security.mjs";
import { STATE_DIR } from "./paths.mjs";

export const MODEL_PICKER_STATE_PATH =
  process.env.MODEL_ROUTER_MODEL_PICKER_STATE ||
  path.join(STATE_DIR, "model-picker.json");

function emptyState() {
  return { hidden: [], priorities: {}, labels: {} };
}

function readState() {
  if (!existsSync(MODEL_PICKER_STATE_PATH)) return emptyState();
  try {
    const parsed = JSON.parse(readFileSync(MODEL_PICKER_STATE_PATH, "utf8"));
    if (parsed?.version !== 1) return emptyState();
    const hidden = Array.isArray(parsed.hidden)
      ? parsed.hidden.map((slug) => String(slug)).filter(Boolean)
      : [];
    const priorities = Object.fromEntries(
      Object.entries(parsed.priorities || {}).filter(
        ([slug, priority]) => slug && Number.isInteger(priority) && priority >= 0,
      ),
    );
    const labels = Object.fromEntries(
      Object.entries(parsed.labels || {}).filter(
        ([slug, label]) => slug && typeof label === "string" && label.trim(),
      ),
    );
    return { hidden, priorities, labels };
  } catch {
    return emptyState();
  }
}

function writeState(hidden, priorities, labels) {
  const stateDir = path.dirname(MODEL_PICKER_STATE_PATH);
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  chmodSync(stateDir, 0o700);
  const temporary = `${MODEL_PICKER_STATE_PATH}.tmp.${process.pid}`;
  writeFileSync(
    temporary,
    `${JSON.stringify({
      version: 1,
      hidden: [...hidden].sort(),
      priorities: Object.fromEntries(
        [...priorities.entries()].sort(([left], [right]) => left.localeCompare(right)),
      ),
      labels: Object.fromEntries(
        [...labels.entries()].sort(([left], [right]) => left.localeCompare(right)),
      ),
    }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  protectPrivateFile(temporary);
  renameSync(temporary, MODEL_PICKER_STATE_PATH);
  protectPrivateFile(MODEL_PICKER_STATE_PATH);
}

// Per-model visibility overrides for the Codex picker. Hiding a model only
// changes the merged catalog for this machine; the registry stays untouched.
export function readHiddenModels() {
  return new Set(readState().hidden);
}

export function readModelPriorities() {
  return new Map(Object.entries(readState().priorities));
}

export function readModelLabels() {
  return new Map(Object.entries(readState().labels));
}

export function modelPickerSnapshot() {
  const state = readState();
  return {
    hidden: [...state.hidden].sort(),
    priorities: state.priorities,
    labels: state.labels,
    path: MODEL_PICKER_STATE_PATH,
  };
}

export function setModelVisible(slug, visible) {
  return setModelsVisible([slug], visible);
}

// Changes only the supplied models so provider-level actions preserve every
// other provider's picker choices.
export function setModelsVisible(slugs, visible) {
  const values = [...new Set(slugs.map((slug) => String(slug || "").trim()).filter(Boolean))];
  if (values.length === 0) throw new Error("At least one model slug is required.");
  const state = readState();
  const hidden = new Set(state.hidden);
  for (const value of values) {
    if (visible) hidden.delete(value);
    else hidden.add(value);
  }
  writeState(
    hidden,
    new Map(Object.entries(state.priorities)),
    new Map(Object.entries(state.labels)),
  );
  return modelPickerSnapshot();
}

export function setAllModelsVisible(slugs, visible) {
  const known = [...new Set(slugs.map((slug) => String(slug).trim()).filter(Boolean))];
  const hidden = visible ? new Set() : new Set(known);
  const state = readState();
  writeState(
    hidden,
    new Map(Object.entries(state.priorities)),
    new Map(Object.entries(state.labels)),
  );
  return modelPickerSnapshot();
}

export function setModelPriority(slug, priority) {
  const value = String(slug || "").trim();
  if (!value) throw new Error("A model slug is required.");
  if (priority !== undefined && (!Number.isInteger(priority) || priority < 0)) {
    throw new Error("Model priority must be a non-negative integer.");
  }
  const state = readState();
  const priorities = new Map(Object.entries(state.priorities));
  if (priority === undefined) priorities.delete(value);
  else priorities.set(value, priority);
  writeState(new Set(state.hidden), priorities, new Map(Object.entries(state.labels)));
  return modelPickerSnapshot();
}

export function setModelLabel(slug, label) {
  const value = String(slug || "").trim();
  if (!value) throw new Error("A model slug is required.");
  if (label !== undefined && (typeof label !== "string" || !label.trim())) {
    throw new Error("Model label must be a non-empty string.");
  }
  const state = readState();
  const labels = new Map(Object.entries(state.labels));
  if (label === undefined) labels.delete(value);
  else labels.set(value, label.trim());
  writeState(
    new Set(state.hidden),
    new Map(Object.entries(state.priorities)),
    labels,
  );
  return modelPickerSnapshot();
}
