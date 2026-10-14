import { expect, test } from "bun:test";
import { DEMO_EXTENSION, demoAccounts, initializeDemo } from "../scripts/demo-data";
import { accountSetupUri } from "../src/lib/account-export";
import { parseOtpAuthUri } from "../vendor/lib/otp";

function storage(values = new Map<string, string>()) {
  return {
    values,
    getItem: async (key: string) => values.get(key),
    setItem: async (key: string, value: string) => { values.set(key, value); },
    removeItem: async (key: string) => { values.delete(key); },
  };
}

test("Demo 初始化拒绝正式扩展与共享文件，且不改动存储", async () => {
  const data = storage(new Map([["goose-2fa-accounts", "private"]]));
  await expect(initializeDemo(data, "goose-2fa")).rejects.toThrow();
  await expect(initializeDemo(data, DEMO_EXTENSION, "/private/vault.json")).rejects.toThrow();
  expect([...data.values]).toEqual([["goose-2fa-accounts", "private"]]);
});

test("旧 Demo 被替换为虚构账户，移除旧数据源和回收站", async () => {
  const data = storage(new Map([
    ["goose-2fa-accounts", "legacy accounts"],
    ["goose-2fa-data-source-override", "/private/vault.json"],
    ["goose-2fa-trash", "legacy trash"],
  ]));
  await initializeDemo(data, DEMO_EXTENSION);
  expect(JSON.parse(data.values.get("goose-2fa-accounts")!)).toEqual(demoAccounts());
  expect(data.values.has("goose-2fa-data-source-override")).toBe(false);
  expect(data.values.get("goose-2fa-trash")).toBe("[]");
  for (const account of demoAccounts()) {
    expect(account.name).toBe("demo@example.com");
    expect(account.issuer).not.toMatch(/twitter|xai|^x$/i);
    const { name, issuer, secret, type, algorithm, digits, counter, period } = account;
    expect(parseOtpAuthUri(accountSetupUri(account))).toMatchObject({ name, issuer, secret, type, algorithm, digits, counter, period });
  }
});

test("再次启动不覆盖 Demo 中的编辑和 HOTP 计数", async () => {
  const data = storage();
  await initializeDemo(data, DEMO_EXTENSION);
  const accounts = demoAccounts();
  accounts[3]!.counter = 20;
  await data.setItem("goose-2fa-accounts", JSON.stringify(accounts));
  await initializeDemo(data, DEMO_EXTENSION);
  expect(JSON.parse(data.values.get("goose-2fa-accounts")!)).toEqual(accounts);
});
