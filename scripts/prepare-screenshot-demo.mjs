import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(homedir(), ".config/raycast/demo-sources/goose-2fa-review-demo");
mkdirSync(target, { recursive: true });
for (const entry of ["src", "vendor", "assets", "swift", "tsconfig.json", "package-lock.json"]) {
  cpSync(path.join(root, entry), path.join(target, entry), {
    recursive: true,
    filter: (source) => ![".build", ".swiftpm", ".raycast-swift-build", "compiled_raycast_swift"].includes(path.basename(source)),
  });
}
const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
manifest.name = "goose-2fa-review-demo";
manifest.title = "Goose 2FA Screenshot Demo";
manifest.commands[0].name = "demo-codes";
manifest.commands[0].subtitle = "Screenshot Demo";
manifest.commands[0].keywords.push("safe-demo");
writeFileSync(path.join(target, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
cpSync(path.join(root, "scripts/demo-entry.tsx"), path.join(target, "src/demo-codes.tsx"));
cpSync(path.join(root, "scripts/demo-data.ts"), path.join(target, "src/demo-data.ts"));
if (!existsSync(path.join(target, "node_modules"))) symlinkSync(path.join(root, "node_modules"), path.join(target, "node_modules"));
console.log(target);
