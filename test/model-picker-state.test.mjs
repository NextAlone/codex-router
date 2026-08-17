import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const stateDir = mkdtempSync(path.join(os.tmpdir(), "model-picker-state-test-"));
process.env.CODEX_ROUTER_STATE_DIR = stateDir;

const {
  MODEL_PICKER_STATE_PATH,
  modelPickerSnapshot,
  readHiddenModels,
  readModelLabels,
  readModelPriorities,
  setAllModelsVisible,
  setModelLabel,
  setModelPriority,
  setModelVisible,
  setModelsVisible,
} = await import("../src/model-picker-state.mjs");

test("picker visibility defaults to no hidden models", () => {
  assert.deepEqual([...readHiddenModels()], []);
  assert.deepEqual(modelPickerSnapshot().hidden, []);
  assert.deepEqual([...readModelPriorities()], []);
  assert.deepEqual([...readModelLabels()], []);
});

test("picker labels round-trip and reset without changing other overrides", () => {
  setModelVisible("grok-oauth/grok-4.6", false);
  setModelPriority("grok-oauth/grok-4.6", 4);
  setModelLabel("grok-oauth/grok-4.6", "Grok 4.6");
  assert.deepEqual([...readModelLabels()], [["grok-oauth/grok-4.6", "Grok 4.6"]]);
  assert.deepEqual(modelPickerSnapshot().labels, { "grok-oauth/grok-4.6": "Grok 4.6" });
  assert.deepEqual(modelPickerSnapshot().hidden, ["grok-oauth/grok-4.6"]);
  assert.equal(modelPickerSnapshot().priorities["grok-oauth/grok-4.6"], 4);

  setModelLabel("grok-oauth/grok-4.6", undefined);
  setModelPriority("grok-oauth/grok-4.6", undefined);
  setModelVisible("grok-oauth/grok-4.6", true);
});

test("picker labels reject empty values", () => {
  assert.throws(() => setModelLabel("grok-oauth/grok-4.6", "  "), /non-empty string/);
});

test("picker priorities round-trip and reset without changing visibility", () => {
  setModelVisible("grok-oauth/grok-4.6", false);
  setModelPriority("grok-oauth/grok-4.6", 4);
  assert.deepEqual([...readModelPriorities()], [["grok-oauth/grok-4.6", 4]]);
  assert.deepEqual(modelPickerSnapshot().priorities, { "grok-oauth/grok-4.6": 4 });
  assert.deepEqual(modelPickerSnapshot().hidden, ["grok-oauth/grok-4.6"]);

  setModelPriority("grok-oauth/grok-4.6", undefined);
  setModelVisible("grok-oauth/grok-4.6", true);
});

test("picker priorities reject invalid values", () => {
  assert.throws(() => setModelPriority("grok-oauth/grok-4.6", -1), /non-negative integer/);
  assert.throws(() => setModelPriority("grok-oauth/grok-4.6", 1.5), /non-negative integer/);
});

test("picker visibility round-trips through protected state", () => {
  setModelVisible("opencode-go/deepseek-v4-flash", false);
  assert.deepEqual([...readHiddenModels()], ["opencode-go/deepseek-v4-flash"]);
  assert.deepEqual(modelPickerSnapshot().hidden, ["opencode-go/deepseek-v4-flash"]);

  setModelVisible("opencode-go/deepseek-v4-flash", true);
  assert.deepEqual([...readHiddenModels()], []);
  assert.ok(MODEL_PICKER_STATE_PATH.startsWith(stateDir));
});

test("picker bulk visibility hides and shows every supplied model", () => {
  const slugs = ["opencode-go/deepseek-v4-flash", "kimi-oauth/k3", "gpt-5.6-sol"];
  setAllModelsVisible(slugs, false);
  assert.deepEqual([...readHiddenModels()].sort(), [...slugs].sort());
  setAllModelsVisible(slugs, true);
  assert.deepEqual([...readHiddenModels()], []);
});

test("provider-sized picker changes preserve other providers", () => {
  setModelsVisible(["commandcode/kimi-k3", "commandcode-messages/claude-opus-4.8"], false);
  setModelVisible("kimi-oauth/k3", false);
  assert.deepEqual(modelPickerSnapshot().hidden, [
    "commandcode-messages/claude-opus-4.8",
    "commandcode/kimi-k3",
    "kimi-oauth/k3",
  ]);

  setModelsVisible(["commandcode/kimi-k3", "commandcode-messages/claude-opus-4.8"], true);
  assert.deepEqual(modelPickerSnapshot().hidden, ["kimi-oauth/k3"]);
});
