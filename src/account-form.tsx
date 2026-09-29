import { Action, ActionPanel, Form, Toast, popToRoot, showToast, useNavigation } from "@raycast/api";
import { deduplicateImports } from "../vendor/lib/data-transfer";
import { normalizeNewAccountInput } from "../vendor/lib/account-validation";
import type { AccountData, NewAccountInput } from "../vendor/lib/types";
import { commit } from "./lib/commit";
import { t } from "./lib/i18n";
import { addAccounts, setAccountText } from "./lib/vault-ops";
import { getVaultState } from "./lib/vault-store";

function nextAccountName(existingNames: string[]): string {
  const names = new Set(existingNames);
  let index = 1;
  while (names.has(`Account ${index}`) || names.has(`账户 ${index}`)) index++;
  return t(`Account ${index}`, `账户 ${index}`);
}

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
          const accounts = getVaultState().accounts;
          const name = initial?.name ?? nextAccountName(accounts.map((existing) => existing.name));
          const input = normalizeNewAccountInput({
            ...initial,
            name,
            issuer: initial?.issuer ?? "",
            secret: values.secret,
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
      {mode === "create" ? <>
        <Form.PasswordField id="secret" title={t("Base32 Secret", "Base32 密钥")} defaultValue={initial?.secret} />
        <Form.Description text={t("Paste your secret key. The account will use the default settings.", "粘贴密钥即可，账户将使用默认设置。")} />
      </> : <>
        <Form.TextField id="name" title={t("Name", "名称")} defaultValue={account?.name} placeholder="alice@example.com" />
        <Form.TextField id="issuer" title={t("Issuer", "发行方")} defaultValue={account?.issuer} placeholder="GitHub" />
        <Form.TextArea id="note" title={t("Note", "备注")} defaultValue={account?.note} />
        <Form.TextArea id="remark" title={t("Remark", "标记")} defaultValue={account?.remark} />
      </>}
    </Form>
  );
}
