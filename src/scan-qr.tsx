import { Action, ActionPanel, Form, Icon, List, Toast, showToast, useNavigation } from "@raycast/api";
import { statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { useEffect, useState } from "react";
import { deduplicateImports, parseImportBundle } from "../vendor/lib/data-transfer";
import type { NewAccountInput } from "../vendor/lib/types";
import AccountForm from "./account-form";
import { captureScreenToTempFile, detectBarcodes } from "./lib/helper";
import { t } from "./lib/i18n";
import { getVaultState, useVault } from "./lib/vault-store";

export default function ScanQr({ source = "screen" }: { source?: "screen" | "image" }) {
  const vault = useVault();
  const { pop, push } = useNavigation();
  const [entries, setEntries] = useState<NewAccountInput[]>([]);
  const [status, setStatus] = useState<"selecting" | "scanning" | "ready" | "empty">(source === "image" ? "selecting" : "scanning");
  const newInputs = new Set(deduplicateImports(entries, vault.accounts).newAccounts);

  async function scan(imagePath: string) {
    try {
      const found = (await detectBarcodes(imagePath)).flatMap((payload) => parseImportBundle(payload)?.accounts ?? []);
      const unique = deduplicateImports(found, getVaultState().accounts).newAccounts;
      setEntries(found);
      setStatus(found.length ? "ready" : "empty");
      if (unique.length === 1 && found.length === 1) push(<AccountForm mode="create" initial={unique[0]} />);
    } catch (error) {
      await showToast({ style: Toast.Style.Failure, title: t("Scan Failed", "识别失败"), message: error instanceof Error ? error.message : String(error) });
      setStatus("empty");
    }
  }

  useEffect(() => {
    if (source !== "screen") return;
    let active = true;
    void (async () => {
      const imagePath = await captureScreenToTempFile();
      if (!imagePath) {
        if (active) pop();
        return;
      }
      try {
        if (active) await scan(imagePath);
      } finally {
        try { unlinkSync(imagePath); } catch { /* System may have removed the temporary screenshot. */ }
      }
    })();
    return () => { active = false; };
    // ponytail: one capture per mounted scanner; a new scan is a new navigation, not a reactive effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === "selecting") return (
    <Form navigationTitle={t("Import QR Image", "从图片识码")} actions={<ActionPanel><Action.SubmitForm title={t("Scan Image", "识别图片")} onSubmit={async (values: { files?: string[] }) => {
      const file = values.files?.[0];
      if (!file) {
        await showToast({ style: Toast.Style.Failure, title: t("Choose an image", "请选择图片") });
        return;
      }
      try {
        const stat = statSync(file);
        if (!stat.isFile() || !stat.size || stat.size > 5 * 1024 * 1024 || ![".png", ".jpg", ".jpeg", ".heic", ".heif"].includes(path.extname(file).toLowerCase())) throw new Error();
      } catch {
        await showToast({ style: Toast.Style.Failure, title: t("Invalid image", "图片无效"), message: t("Choose a PNG, JPEG or HEIC image under 5 MB.", "请选择小于 5 MB 的 PNG、JPEG 或 HEIC 图片。") });
        return;
      }
      setStatus("scanning");
      await scan(file);
    }} /></ActionPanel>}>
      <Form.FilePicker id="files" title={t("QR Image", "二维码图片")} allowMultipleSelection={false} />
    </Form>
  );

  return (
    <List isLoading={status === "scanning" || vault.syncStatus === "writing"} searchBarPlaceholder={t("Search scan results", "搜索识别结果")}>
      {status === "empty" && <List.Item icon={Icon.MagnifyingGlass} title={t("No QR Code Found", "没有识别到二维码")} subtitle={t("No supported account was found in the image.", "图片中没有可识别的账户。")}
        actions={<ActionPanel>{source === "image" ? <Action title={t("Choose Another Image", "选择另一张图片")} icon={Icon.Upload} onAction={() => setStatus("selecting")} /> : <Action title={t("Back to Codes", "返回验证码")} icon={Icon.ArrowLeft} onAction={pop} />}</ActionPanel>} />}
      {entries.map((input, index) => (
        <List.Item key={`${input.name}-${index}`} icon={Icon.Key} title={input.name} subtitle={input.issuer} accessories={[{ text: newInputs.has(input) ? input.type.toUpperCase() : t("Already Added", "已存在") }]}
          actions={<ActionPanel><Action.Push title={t("Edit and Save Account", "编辑并保存账户")} icon={Icon.Pencil} target={<AccountForm mode="create" initial={input} />} /></ActionPanel>} />
      ))}
    </List>
  );
}
