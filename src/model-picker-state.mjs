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

// Per-model visibility overrides for the Codex picker. Hiding a model only
// changes the merged catalog for this machine; the registry stays untouched.
//
// `hidden` answers "is this model off"; `seeded` answers the different question
// "has this model ever been decided" -- by the operator, or by a default the
// catalog build applied once. Absence from `hidden` cannot answer it, because
// that is also what a model nobody has ever seen looks like, and a default
// that cannot tell the two apart re-applies itself over the operator's choice
// on the next rebuild (see `seedModelsHidden`).
function readPickerState() {
  const empty = {
    hidden: new Set(),
    seeded: new Set(),
    priorities: new Map(),
    labels: new Map(),
  };
  if (!existsSync(MODEL_PICKER_STATE_PATH)) return empty;
  try {
    const parsed = JSON.parse(readFileSync(MODEL_PICKER_STATE_PATH, "utf8"));
    if (parsed?.version !== 1 || !Array.isArray(parsed.hidden)) return empty;
    const slugs = (value) =>
      new Set((Array.isArray(value) ? value : []).map((slug) => String(slug)).filter(Boolean));
    const entries = (value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.entries(value)
        : [];
    const priorities = new Map(
      entries(parsed.priorities).filter(
        ([slug, priority]) => slug && Number.isInteger(priority) && priority >= 0,
      ),
    );
    const labels = new Map(
      entries(parsed.labels).filter(
        ([slug, label]) => slug && typeof label === "string" && label.trim(),
      ),
    );
    return {
      hidden: slugs(parsed.hidden),
      seeded: slugs(parsed.seeded),
      priorities,
      labels,
    };
  } catch {
    return empty;
  }
}

export function readHiddenModels() {
  return readPickerState().hidden;
}

export function readModelPriorities() {
  return readPickerState().priorities;
}

export function readModelLabels() {
  return readPickerState().labels;
}

function sortedObject(values) {
  return Object.fromEntries(
    [...values.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function writePickerState({ hidden, seeded, priorities, labels }) {
  const stateDir = path.dirname(MODEL_PICKER_STATE_PATH);
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  chmodSync(stateDir, 0o700);
  const temporary = `${MODEL_PICKER_STATE_PATH}.tmp.${process.pid}`;
  writeFileSync(
    temporary,
    `${JSON.stringify(
      {
        version: 1,
        hidden: [...hidden].sort(),
        seeded: [...seeded].sort(),
        priorities: sortedObject(priorities),
        labels: sortedObject(labels),
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  protectPrivateFile(temporary);
  renameSync(temporary, MODEL_PICKER_STATE_PATH);
  protectPrivateFile(MODEL_PICKER_STATE_PATH);
  return modelPickerSnapshot();
}

export function modelPickerSnapshot() {
  const { hidden, priorities, labels } = readPickerState();
  return {
    hidden: [...hidden].sort(),
    priorities: sortedObject(priorities),
    labels: sortedObject(labels),
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
  const state = readPickerState();
  for (const value of values) {
    if (visible) state.hidden.delete(value);
    else state.hidden.add(value);
    // The operator just decided this one. Recording it is what stops a
    // shipped default from quietly undoing the decision later.
    state.seeded.add(value);
  }
  return writePickerState(state);
}

export function setAllModelsVisible(slugs, visible) {
  const known = [...new Set(slugs.map((slug) => String(slug).trim()).filter(Boolean))];
  const state = readPickerState();
  return writePickerState({
    ...state,
    hidden: visible ? new Set() : new Set(known),
    seeded: new Set([...state.seeded, ...known]),
  });
}

export function setModelPriority(slug, priority) {
  const value = String(slug || "").trim();
  if (!value) throw new Error("A model slug is required.");
  if (priority !== undefined && (!Number.isInteger(priority) || priority < 0)) {
    throw new Error("Model priority must be a non-negative integer.");
  }
  const state = readPickerState();
  if (priority === undefined) state.priorities.delete(value);
  else state.priorities.set(value, priority);
  return writePickerState(state);
}

export function setModelLabel(slug, label) {
  const value = String(slug || "").trim();
  if (!value) throw new Error("A model slug is required.");
  if (label !== undefined && (typeof label !== "string" || !label.trim())) {
    throw new Error("Model label must be a non-empty string.");
  }
  const state = readPickerState();
  if (label === undefined) state.labels.delete(value);
  else state.labels.set(value, label.trim());
  return writePickerState(state);
}

// Applies a shipped default to models the operator has never decided, and only
// to those. Used by the catalog build for entries that must arrive switched off
// (`src/native-context-variants.mjs`): they cost more per turn than the model
// they shadow, so an update must never turn one on by itself.
//
// Idempotent, and silent when there is nothing to record -- this runs on every
// catalog rebuild, and rewriting the operator's picker state to say nothing new
// is how a protected file starts churning.
export function seedModelsHidden(slugs) {
  const values = [...new Set(
    (Array.isArray(slugs) ? slugs : []).map((slug) => String(slug || "").trim()).filter(Boolean),
  )];
  const state = readPickerState();
  const fresh = values.filter((value) => !state.seeded.has(value));
  if (fresh.length === 0) return modelPickerSnapshot();
  for (const value of fresh) {
    state.hidden.add(value);
    state.seeded.add(value);
  }
  return writePickerState(state);
}
