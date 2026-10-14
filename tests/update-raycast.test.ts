import { afterEach, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { updateExtensions } from "../scripts/update-raycast.mjs";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "goose-2fa-update-test-"));
  directories.push(directory);
  const entries = [
    { name: "goose-2fa", command: "codes" },
    { name: "goose-2fa-review-demo", command: "demo-codes" },
  ].map((extension) => {
    const entry = {
      ...extension,
      destination: path.join(directory, "installed", extension.name),
      output: path.join(directory, "build", extension.name),
    };
    for (const [target, version] of [[entry.destination, "old"], [entry.output, "new"]]) {
      mkdirSync(path.join(target, "assets/compiled_raycast_swift"), { recursive: true });
      writeFileSync(path.join(target, "package.json"), JSON.stringify({ name: extension.name, icon: "icon.png", commands: [{ name: extension.command }] }));
      writeFileSync(path.join(target, "plugin.json"), JSON.stringify({ name: extension.name }));
      writeFileSync(path.join(target, `${extension.command}.js`), version);
      writeFileSync(path.join(target, "assets/icon.png"), "fixture-icon");
      writeFileSync(path.join(target, "assets/compiled_raycast_swift/goose-2fa"), `swift-${version}`);
    }
    return entry;
  });
  const dataFile = path.join(directory, "account-data.json");
  writeFileSync(dataFile, "untouched account storage");
  return { entries, backup: path.join(directory, "backup"), dataFile };
}

test("updates both installed extensions, keeps recoverable backups, and leaves account storage alone", () => {
  const { entries, backup, dataFile } = fixture();
  const installed = updateExtensions(entries, backup, (entry) => cpSync(entry.output, entry.destination, { recursive: true }));
  expect(installed.map((entry) => entry.name)).toEqual(entries.map((entry) => entry.name));
  for (const entry of entries) {
    expect(readFileSync(path.join(entry.destination, `${entry.command}.js`), "utf8")).toBe("new");
    expect(readFileSync(path.join(backup, entry.name, `${entry.command}.js`), "utf8")).toBe("old");
  }
  expect(readFileSync(dataFile, "utf8")).toBe("untouched account storage");
});

test("a failure updating the second extension restores both extensions and removes partial new files", () => {
  const { entries, backup, dataFile } = fixture();
  expect(() => updateExtensions(entries, backup, (entry) => {
    cpSync(entry.output, entry.destination, { recursive: true });
    writeFileSync(path.join(entry.destination, "partial-output.js"), "partial");
    if (entry.name.endsWith("review-demo")) throw new Error("simulated second build failure");
  })).toThrow("已恢复");
  for (const entry of entries) {
    expect(readFileSync(path.join(entry.destination, `${entry.command}.js`), "utf8")).toBe("old");
    expect(readFileSync(path.join(entry.destination, "assets/compiled_raycast_swift/goose-2fa"), "utf8")).toBe("swift-old");
    expect(existsSync(path.join(entry.destination, "partial-output.js"))).toBe(false);
  }
  expect(readFileSync(dataFile, "utf8")).toBe("untouched account storage");
});

test("a build with a different identity is rejected before touching either installed extension", () => {
  const { entries, backup } = fixture();
  writeFileSync(path.join(entries[1].output, "package.json"), JSON.stringify({ name: "foreign-extension", commands: [{ name: "demo-codes" }] }));
  let called = false;
  expect(() => updateExtensions(entries, backup, () => { called = true; })).toThrow("标识不匹配");
  expect(called).toBe(false);
  expect(existsSync(backup)).toBe(false);
  for (const entry of entries) expect(readFileSync(path.join(entry.destination, `${entry.command}.js`), "utf8")).toBe("old");
});

test("a mismatching installed bundle triggers rollback instead of reporting success", () => {
  const { entries, backup } = fixture();
  expect(() => updateExtensions(entries, backup, (entry) => {
    cpSync(entry.output, entry.destination, { recursive: true });
    if (entry.name.endsWith("review-demo")) writeFileSync(path.join(entry.destination, `${entry.command}.js`), "stale");
  })).toThrow("已恢复");
  for (const entry of entries) expect(readFileSync(path.join(entry.destination, `${entry.command}.js`), "utf8")).toBe("old");
});

test("source maps resolve to the same sources even when staging and installation paths differ", () => {
  const { entries, backup } = fixture();
  const writeMap = (entry, directory, mappings = "AAAA") => {
    writeFileSync(path.join(directory, `${entry.command}.js.map`), JSON.stringify({
      version: 3,
      sources: [path.relative(directory, path.join(entries[0].destination, "../../source/code.tsx")), "swift:/runtime/Scanner"],
      sourcesContent: ["export default function Code() {}", "bundled scanner"],
      mappings,
      names: [],
    }));
  };
  for (const entry of entries) {
    const nested = path.join(entry.output, "../nested", entry.name);
    cpSync(entry.output, nested, { recursive: true });
    entry.output = nested;
    writeMap(entry, entry.output);
  }
  expect(() => updateExtensions(entries, backup, (entry) => {
    cpSync(entry.output, entry.destination, { recursive: true });
    writeMap(entry, entry.destination);
  })).not.toThrow();
  expect(() => updateExtensions(entries, `${backup}-corrupt`, (entry) => {
    cpSync(entry.output, entry.destination, { recursive: true });
    writeMap(entry, entry.destination, "different mappings");
  })).toThrow("已恢复");
});
