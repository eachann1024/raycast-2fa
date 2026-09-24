import { Action, ActionPanel, Form, Toast, popToRoot, showToast, useNavigation } from "@raycast/api";
import { deduplicateImports } from "../vendor/lib/data-transfer";
import { normalizeNewAccountInput } from "../vendor/lib/account-validation";
import type { AccountData, NewAccountInput } from "../vendor/lib/types";
import { commit } from "./lib/commit";
import { t } from "./lib/i18n";
import { addAccounts, setAccountText } from "./lib/vault-ops";
import { getVaultState } from "./lib/vault-store";

interface FormValues {
  name?: string;
  issuer?: string;
  secret?: string;
  type?: "totp" | "hotp";
  digits?: string;
  period?: string;
  algorithm?: "SHA-1" | "SHA-256" | "SHA-512";
  note?: string;
  remark?: string;
}

export default function AccountForm({ mode, account, initial }: { mode: "create" | "edit"; account?: AccountData; initial?: NewAccountInput }) {
  const { pop } = useNavigation();
  return (
    <Form
      navigationTitle={initial ? t("Edit Scanned Account", "编辑扫描结果") : mode === "create" ? t("Add Account", "添加账户") : t("Edit Account", "编辑账户")}
      actions={<ActionPanel><Action.SubmitForm title={t("Save Account", "保存账户")} onSubmit={async (values: FormValues) => {
        if (mode === "create") {
          const input = normalizeNewAccountInput({
            name: values.name,
            issuer: values.issuer,
            secret: values.secret,
            type: values.type,
            digits: Number(values.digits),
            period: Number(values.period || 30),
            algorithm: values.algorithm,
            counter: initial?.counter ?? 0,
            originalName: initial?.originalName,
            groupId: initial?.groupId,
            note: values.note,
            remark: values.remark,
          });
          if (!input) {
            await showToast({ style: Toast.Style.Failure, title: t("Invalid account details", "账户信息不合法"), message: t("Check the Base32 secret, digits and period.", "请检查 Base32 密钥、位数与周期。") });
            return;
          }
          if (!deduplicateImports([input], getVaultState().accounts).newAccounts.length) {
            await showToast({ style: Toast.Style.Failure, title: t("Account Already Exists", "账户已存在") });
            return;
          }
          const ok = await commit((snapshot) => addAccounts(snapshot, [input], input.groupId ?? null), t("Account added", "已添加账户"));
          if (ok) initial ? await popToRoot() : pop();
          return;
        }
        if (!account) return;
        const ok = await commit(
          (snapshot) => setAccountText(snapshot, account.id, {
            name: values.name || account.name,
            issuer: values.issuer ?? account.issuer,
            note: values.note,
            remark: values.remark,
          }),
          t("Account saved", "已保存账户"),
        );
        if (ok) pop();
      }} /></ActionPanel>}
    >
      <Form.TextField id="name" title={t("Name", "名称")} defaultValue={account?.name ?? initial?.name} placeholder="alice@example.com" />
      <Form.TextField id="issuer" title={t("Issuer", "发行方")} defaultValue={account?.issuer ?? initial?.issuer} placeholder="GitHub" />
      {mode === "create" && <Form.PasswordField id="secret" title={t("Base32 Secret", "Base32 密钥")} defaultValue={initial?.secret} />}
      {mode === "create" && <Form.Dropdown id="type" title={t("Type", "类型")} defaultValue={initial?.type ?? "totp"}>
        <Form.Dropdown.Item value="totp" title={t("TOTP (time-based)", "TOTP（基于时间）")} />
        <Form.Dropdown.Item value="hotp" title={t("HOTP (counter-based)", "HOTP（基于计数器）")} />
      </Form.Dropdown>}
      {mode === "create" && <Form.Dropdown id="digits" title={t("Digits", "位数")} defaultValue={String(initial?.digits ?? 6)}>
        <Form.Dropdown.Item value="6" title={t("6 digits", "6 位")} />
        <Form.Dropdown.Item value="8" title={t("8 digits", "8 位")} />
      </Form.Dropdown>}
      {mode === "create" && <Form.TextField id="period" title={t("Period (seconds)", "周期（秒）")} defaultValue={String(initial?.period ?? 30)} />}
      {mode === "create" && <Form.Dropdown id="algorithm" title={t("Algorithm", "算法")} defaultValue={initial?.algorithm ?? "SHA-1"}>
        <Form.Dropdown.Item value="SHA-1" title="SHA-1" />
        <Form.Dropdown.Item value="SHA-256" title="SHA-256" />
        <Form.Dropdown.Item value="SHA-512" title="SHA-512" />
      </Form.Dropdown>}
      <Form.TextArea id="note" title={t("Note", "备注")} defaultValue={account?.note ?? initial?.note} />
      <Form.TextArea id="remark" title={t("Remark", "标记")} defaultValue={account?.remark ?? initial?.remark} />
    </Form>
  );
}
