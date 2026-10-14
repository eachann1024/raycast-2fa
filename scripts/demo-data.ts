import type { AccountData } from "../vendor/lib/types";

export const DEMO_EXTENSION = "goose-2fa-review-demo";
const FIXTURE_KEY = "goose-2fa-screenshot-fixture-version";
const FIXTURE_VERSION = "safe-accounts-v1";

export function demoAccounts(): AccountData[] {
  return ["Google", "OpenAI", "Vercel", "GitHub"].map((issuer, index) => ({
    id: `screenshot-demo-${index}`,
    name: "demo@example.com",
    issuer,
    secret: String.fromCharCode(65 + index).repeat(32),
    type: index === 3 ? "hotp" : "totp",
    algorithm: index === 3 ? "SHA-256" : "SHA-1",
    digits: index === 3 ? 8 : 6,
    period: 30,
    counter: index === 3 ? 8 : 0,
    createdAt: 1,
  }));
}

interface DemoStorage {
  getItem(key: string): Promise<string | undefined>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export async function initializeDemo(storage: DemoStorage, extensionName: string, dataFile?: string): Promise<void> {
  // Fail before any read/write when accidentally used by the real extension.
  if (extensionName !== DEMO_EXTENSION) throw new Error("Demo data is restricted to Screenshot Demo.");
  if (dataFile?.trim()) throw new Error("Clear Screenshot Demo's Data Source File preference to use fictional accounts.");
  // The demo always starts from its own LocalStorage, never a previously selected shared file.
  await storage.removeItem("goose-2fa-data-source-override");
  if (await storage.getItem(FIXTURE_KEY) === FIXTURE_VERSION) return;
  await Promise.all([
    storage.setItem("goose-2fa-accounts", JSON.stringify(demoAccounts())),
    storage.setItem("goose-2fa-groups", "[]"),
    storage.setItem("goose-2fa-trash", "[]"),
    storage.setItem("goose-2fa-onboarded", "true"),
  ]);
  // Mark success last; a failed initialization will retry next launch.
  await storage.setItem(FIXTURE_KEY, FIXTURE_VERSION);
}
