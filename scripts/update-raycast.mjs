import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareScreenshotDemo } from "./prepare-screenshot-demo.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generated = new Set([".build", ".swiftpm", ".raycast-swift-build", "compiled_raycast_swift", "raycast.d.ts"]);

function run(command, args, cwd = root, capture = false) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 执行失败（${result.signal ?? result.status}）${capture ? `：${result.stderr.trim()}` : ""}`);
  return result.stdout?.trim();
}

function files(directory, skipGenerated = false, prefix = "", normalizeSourceMaps = false) {
  const result = {};
  for (const name of readdirSync(directory).sort()) {
    if (skipGenerated && generated.has(name)) continue;
    const filename = path.join(directory, name);
    const relative = path.posix.join(prefix, name);
    const stat = lstatSync(filename);
    if (stat.isSymbolicLink()) throw new Error(`不支持符号链接：${filename}`);
    if (stat.isDirectory()) Object.assign(result, files(filename, skipGenerated, relative, normalizeSourceMaps));
    else if (stat.isFile()) {
      let content = readFileSync(filename);
      if (normalizeSourceMaps && name.endsWith(".js.map")) {
        // esbuild records sources relative to each output directory. Preserve all map content,
        // but compare the same source paths as absolute paths when staging and installation differ.
        const map = JSON.parse(content.toString("utf8"));
        map.sources = map.sources.map((source) => /^[a-z][a-z\d+.-]*:/i.test(source) ? source : path.resolve(directory, map.sourceRoot ?? "", source));
        delete map.sourceRoot;
        content = Buffer.from(JSON.stringify(map));
      }
      result[relative] = createHash("sha256").update(content).digest("hex");
    }
    else throw new Error(`不支持的文件类型：${filename}`);
  }
  return result;
}

function sourceFingerprint() {
  const inputs = {};
  for (const name of ["src", "vendor", "assets", "swift", "package.json", "package-lock.json", "tsconfig.json", "scripts/demo-entry.tsx", "scripts/demo-data.ts"]) {
    const filename = path.join(root, name);
    if (lstatSync(filename).isDirectory()) Object.assign(inputs, files(filename, true, name));
    else inputs[name] = createHash("sha256").update(readFileSync(filename)).digest("hex");
  }
  return createHash("sha256").update(JSON.stringify(inputs)).digest("hex");
}

function validateExtension(directory, name, command, compiled = false) {
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new Error(`安装目录无效：${directory}`);
  const manifest = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
  if (manifest.name !== name || manifest.commands?.length !== 1 || manifest.commands[0].name !== command) {
    throw new Error(`扩展标识不匹配：${directory}`);
  }
  if (compiled) {
    const plugin = JSON.parse(readFileSync(path.join(directory, "plugin.json"), "utf8"));
    if (plugin.name !== name) throw new Error(`插件标识不匹配：${name}`);
    for (const filename of [`${command}.js`, `assets/${manifest.icon}`, "assets/compiled_raycast_swift/goose-2fa"]) {
      const stat = lstatSync(path.join(directory, filename));
      if (!stat.isFile() || stat.size === 0) throw new Error(`缺少构建产物：${name}/${filename}`);
    }
  }
}

function verifyInstalled(entry) {
  validateExtension(entry.destination, entry.name, entry.command, true);
  // Raycast keeps development logs and may retain old source maps; compare every new build file.
  const actual = files(entry.destination, false, "", true);
  for (const [filename, digest] of Object.entries(entry.checksums)) {
    if (actual[filename] !== digest) throw new Error(`安装产物校验失败：${entry.name}/${filename}`);
  }
}

export function updateExtensions(entries, backupDirectory, install) {
  for (const entry of entries) {
    validateExtension(entry.destination, entry.name, entry.command);
    if (existsSync(path.join(entry.destination, "cli.pid"))) {
      const pid = Number(readFileSync(path.join(entry.destination, "cli.pid"), "utf8").trim());
      if (Number.isSafeInteger(pid) && pid > 0) {
        let running = true;
        try { process.kill(pid, 0); }
        catch (error) { if (error.code !== "ESRCH") throw error; running = false; }
        if (running) throw new Error(`${entry.name} 正由 ray develop 更新，请先结束该开发进程。`);
      }
    }
    validateExtension(entry.output, entry.name, entry.command, true);
    entry.checksums = files(entry.output, false, "", true);
  }
  mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  const backups = entries.map((entry) => {
    const backup = path.join(backupDirectory, entry.name);
    const checksums = files(entry.destination);
    cpSync(entry.destination, backup, { recursive: true, errorOnExist: true, force: false });
    if (JSON.stringify(files(backup)) !== JSON.stringify(checksums)) throw new Error(`备份校验失败：${entry.name}`);
    return { ...entry, backup, previousChecksums: checksums };
  });
  try {
    for (const entry of entries) {
      install(entry);
      verifyInstalled(entry);
    }
  } catch (error) {
    const failures = [];
    for (const entry of backups) {
      try {
        rmSync(entry.destination, { recursive: true, force: true });
        cpSync(entry.backup, entry.destination, { recursive: true });
        if (JSON.stringify(files(entry.destination)) !== JSON.stringify(entry.previousChecksums)) throw new Error(`恢复校验失败：${entry.name}`);
      } catch (failure) { failures.push(failure); }
    }
    if (failures.length) throw new AggregateError([error, ...failures], `更新失败且恢复未完成；备份：${backupDirectory}`);
    throw new Error(`更新失败，已恢复原有产物；备份：${backupDirectory}`, { cause: error });
  }
  return entries.map(({ name, command, checksums }) => ({ name, command, checksums }));
}

function main() {
  if (process.platform !== "darwin") throw new Error("本地更新仅支持 macOS。");
  if (run("git", ["branch", "--show-current"], root, true) !== "main") throw new Error("只允许从 main 更新 Raycast。");
  const ray = path.join(root, "node_modules/.bin/ray");
  if (!existsSync(ray)) throw new Error("缺少依赖，请先运行 npm ci。");
  const configFile = path.join(homedir(), ".config/raycast/config.json");
  const flavor = process.env.RAY_Target || (existsSync(configFile) ? JSON.parse(readFileSync(configFile, "utf8")).Target : undefined);
  if (flavor && flavor !== "release") throw new Error("此流程只更新正式 Raycast 安装目录，不支持其他 Raycast 分发版本。");
  const extensions = path.join(homedir(), ".config/raycast/extensions");
  const entries = [{ name: "goose-2fa", command: "codes", source: root, destination: path.join(extensions, "goose-2fa") }];
  if (!existsSync(entries[0].destination)) throw new Error("未找到已安装的 Goose 2FA；此命令更新现有扩展。");
  const demo = path.join(extensions, "goose-2fa-review-demo");
  if (existsSync(demo)) entries.push({ name: "goose-2fa-review-demo", command: "demo-codes", destination: demo });
  for (const entry of entries) validateExtension(entry.destination, entry.name, entry.command);
  const cache = path.join(homedir(), ".cache/goose-2fa");
  mkdirSync(cache, { recursive: true, mode: 0o700 });
  const lock = path.join(cache, "update.lock");
  try { mkdirSync(lock, { mode: 0o700 }); }
  catch (error) {
    if (error.code === "EEXIST") throw new Error(`已有更新流程或未清理的锁，请检查：${lock}`);
    throw error;
  }
  let workspace;
  try {
    writeFileSync(path.join(lock, "pid"), String(process.pid));
    workspace = mkdtempSync(path.join(tmpdir(), "goose-2fa-build-"));
    const commit = run("git", ["rev-parse", "HEAD"], root, true);
    const source = sourceFingerprint();
    if (entries.length === 2) entries[1].source = prepareScreenshotDemo();
    for (const entry of entries) {
      entry.output = path.join(workspace, entry.name);
      console.log(`构建 ${entry.name}…`);
      run(ray, ["build", "-e", "dev", "--output", entry.output, "--non-interactive", "--exit-on-error"], entry.source);
      validateExtension(entry.output, entry.name, entry.command, true);
    }
    if (sourceFingerprint() !== source) throw new Error("构建期间源码发生变化，尚未更新；请重新运行。");
    const backups = path.join(cache, "backups");
    mkdirSync(backups, { recursive: true, mode: 0o700 });
    const backupDirectory = mkdtempSync(path.join(backups, `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${commit.slice(0, 7)}-`));
    const installed = updateExtensions(entries, backupDirectory, (entry) => {
      if (sourceFingerprint() !== source) throw new Error("源码发生变化，停止更新。");
      console.log(`更新 ${entry.name}…`);
      // Omitting --output uses Raycast's registered installation and background build-refresh notification.
      run(ray, ["build", "-e", "dev", "--non-interactive", "--exit-on-error"], entry.source);
      if (sourceFingerprint() !== source) throw new Error("更新期间源码发生变化。");
    });
    writeFileSync(path.join(backupDirectory, "update.json"), `${JSON.stringify({ commit, source, installed, verifiedAt: new Date().toISOString() }, null, 2)}\n`);
    console.log(`已更新并校验：${installed.map((entry) => entry.name).join("、")}\n备份：${backupDirectory}`);
  } finally {
    if (workspace) rmSync(workspace, { recursive: true, force: true });
    rmSync(lock, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) {
    console.error(error.message);
    if (error.cause) console.error(error.cause.message);
    if (error.errors) for (const cause of error.errors) console.error(cause.message);
    process.exitCode = 1;
  }
}
