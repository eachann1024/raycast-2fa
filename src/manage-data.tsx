import {
  Action,
  ActionPanel,
  Clipboard,
  Form,
  Icon,
  List,
  Toast,
  openExtensionPreferences,
  showToast,
  useNavigation,
} from "@raycast/api";
import { readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { useState } from "react";
import { normalizeNewAccountInput } from "../vendor/lib/account-validation";
import { exportAsJson, exportAsSyncJson } from "../vendor/lib/data-transfer";
import type { AccountData, NewAccountInput, VaultGroup } from "../vendor/lib/types";
import { syncStatus, t } from "./lib/i18n";
import { commit } from "./lib/commit";
import { normalizePath, resolveVaultPath, writeBackupFile, writeVaultFile } from "./lib/vault-file";
import {
  addAccounts,
  addGroup,
  deleteForever,
  emptyTrash,
  moveToTrash,
  previewImport,
  removeGroup,
  renameGroup,
  restoreFromTrash,
  setAccountGroup,
  setAccountText,
} from "./lib/vault-ops";
import { clearCreatedSource, createDataSource, clearSyncLock, getVaultState, refreshVault, resetLocalVault, resolveConflict, selectCreatedSource, useVault } from "./lib/vault-store";
import ScanQr from "./scan-qr";

export default function ManageData() {
  const vault = useVault();
  const { push } = useNavigation();

  return (
    <List isLoading={vault.status === "loading" || vault.syncStatus === "writing"} searchBarPlaceholder="搜索账户或分组">
      <List.Section title="数据源">
        <List.Item
          icon={vault.source === "file" ? Icon.HardDrive : Icon.Desktop}
          title={vault.source === "file" ? vault.filePath : "未配置文件，使用 Raycast 本地库"}
          subtitle={vault.message ?? vault.notice ?? `同步状态：${vault.syncStatus}`}
          accessories={vault.conflict ? [{ text: "冲突待处理", icon: Icon.Warning }] : undefined}
          actions={
            <ActionPanel>
              <Action
                title="重新读取数据源文件"
                icon={Icon.ArrowClockwise}
                onAction={() => void refreshVault()}
              />
              <Action title={t("Open Extension Preferences", "打开扩展设置")} icon={Icon.Gear} onAction={openExtensionPreferences} />
              <Action.Push title={t("Create Data Source in Folder", "指定目录新建数据源")} icon={Icon.NewDocument} target={<CreateSourceForm />} />
              <Action title={t("Use File or Local Vault from Extension Preferences", "改用扩展设置选择的文件或本地库")} icon={Icon.ArrowCounterClockwise} onAction={() => void clearCreatedSource()} />
              {vault.source === "file" && vault.needsCreate && (
                <Action
                  title={t("Create Data Source File (save current data)", "新建数据源文件（写入当前数据）")}
                  icon={Icon.NewDocument}
                  onAction={() => void createDataSource()}
                />
              )}
              {vault.localBroken && (
                <ActionPanel.Section title="本地库损坏">
                  <Action
                    title="打开扩展偏好设置（改用数据源文件）"
                    icon={Icon.Gear}
                    onAction={() => void openExtensionPreferences()}
                  />
                  <Action
                    title="重建本地库（放弃损坏的旧数据）"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    onAction={async () => {
                      const ok = await resetLocalVault();
                      await showToast(
                        ok
                          ? { style: Toast.Style.Success, title: "本地库已重建" }
                          : { style: Toast.Style.Failure, title: "本地库未重建", message: getVaultState().message ?? "请重试。" },
                      );
                    }}
                  />
                </ActionPanel.Section>
              )}
              {vault.lockHeld !== null && (
                <ActionPanel.Section title="残留锁">
                  <Action
                    title="清理残留锁文件（确认没有其他端在写）"
                    icon={Icon.LockUnlocked}
                    style={Action.Style.Destructive}
                    onAction={async () => {
                      const removed = await clearSyncLock();
                      await showToast(
                        removed
                          ? { style: Toast.Style.Success, title: "已清理残留锁", message: "请重新执行刚才的改动。" }
                          : { style: Toast.Style.Failure, title: "没有找到锁文件", message: "可能已被持有者释放。" },
                      );
                    }}
                  />
                </ActionPanel.Section>
              )}
              {vault.conflict && (
                <ActionPanel.Section title="冲突">
                  <Action title="以文件为准" icon={Icon.Download} onAction={() => void resolveConflict("file")} />
                  <Action
                    title="以本地为准（覆盖文件）"
                    icon={Icon.Upload}
                    style={Action.Style.Destructive}
                    onAction={() => void resolveConflict("local")}
                  />
                </ActionPanel.Section>
              )}
              <ActionPanel.Section title="账户">
                <Action title="添加账户" icon={Icon.Plus} onAction={() => push(<AccountForm mode="create" />)} />
              </ActionPanel.Section>
            </ActionPanel>
          }
        />
      </List.Section>

      <List.Section title={`账户 (${vault.accounts.length})`}>
        {vault.accounts.map((account) => (
          <AccountItem key={account.id} account={account} groups={vault.groups} push={push} />
        ))}
      </List.Section>

      <List.Section title={`分组 (${vault.groups.length})`}>
        <List.Item
          icon={Icon.Plus}
          title="新建分组"
          actions={
            <ActionPanel>
              <Action title="新建分组" icon={Icon.Plus} onAction={() => push(<GroupForm mode="create" />)} />
            </ActionPanel>
          }
        />
        {vault.groups.map((group) => (
          <List.Item
            key={group.id}
            icon={Icon.Folder}
            title={group.name}
            subtitle={`${vault.accounts.filter((account) => account.groupId === group.id).length} 个账户`}
            actions={
              <ActionPanel>
                <Action title="重命名分组" icon={Icon.Pencil} onAction={() => push(<GroupForm mode="rename" group={group} />)} />
                <Action
                  title="删除分组（账户回到未分组）"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  onAction={() => void commit((snapshot) => removeGroup(snapshot, group.id), "已删除分组")}
                />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>

      <List.Section title={`回收站 (${vault.trash.length})`}>
        <List.Item
          icon={Icon.Trash}
          title="清空回收站"
          subtitle="30 天前的条目在每次载入时自动清理"
          actions={
            <ActionPanel>
              <Action
                title="清空回收站"
                icon={Icon.Trash}
                style={Action.Style.Destructive}
                onAction={() => void commit((snapshot) => emptyTrash(snapshot), "回收站已清空")}
              />
            </ActionPanel>
          }
        />
        {vault.trash.map((account) => (
          <List.Item
            key={account.id}
            icon={Icon.Trash}
            title={account.note || account.name}
            subtitle={`${account.issuer} · 删除于 ${new Date(account.deletedAt ?? 0).toLocaleString()}`}
            actions={
              <ActionPanel>
                <Action
                  title="恢复账户"
                  icon={Icon.ArrowCounterClockwise}
                  onAction={() => void commit((snapshot) => restoreFromTrash(snapshot, account.id), "已恢复账户")}
                />
                <Action
                  title="永久删除"
                  icon={Icon.DeleteDocument}
                  style={Action.Style.Destructive}
                  onAction={() => void commit((snapshot) => deleteForever(snapshot, account.id), "已永久删除")}
                />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>

      <List.Section title="导入导出">
        <List.Item
          icon={Icon.Download}
          title="从剪贴板导入"
          subtitle="支持 otpauth://、Google 迁移码与 goose-2fa JSON 备份"
          actions={
            <ActionPanel>
              <Action
                title="从剪贴板导入"
                icon={Icon.Download}
                onAction={async () => {
                  const text = await Clipboard.readText();
                  if (!text) {
                    await showToast({ style: Toast.Style.Failure, title: "剪贴板没有文本" });
                    return;
                  }
                  const preview = previewImport(text, getVaultState());
                  if (!preview) {
                    await showToast({ style: Toast.Style.Failure, title: "无法解析剪贴板内容" });
                    return;
                  }
                  await commit(
                    (snapshot) => previewImport(text, snapshot)?.snapshot ?? snapshot,
                    `已导入 ${preview.added} 个账户${preview.dupeCount ? `，跳过 ${preview.dupeCount} 个重复` : ""}`,
                  );
                }}
              />
            </ActionPanel>
          }
        />
        <List.Item
          icon={Icon.Upload}
          title="从文件导入"
          actions={
            <ActionPanel>
              <Action title="选择备份文件" icon={Icon.Upload} onAction={() => push(<ImportForm />)} />
            </ActionPanel>
          }
        />
        <List.Item
          icon={Icon.Clipboard}
          title="导出到剪贴板"
          subtitle="含 id/回收站的完整数据源格式"
          actions={
            <ActionPanel>
              <Action
                title="复制完整备份"
                icon={Icon.Clipboard}
                onAction={async () => {
                  const snapshot = getVaultState();
                  await Clipboard.copy(exportAsSyncJson(snapshot.accounts, snapshot.groups, snapshot.trash));
                  await showToast({ style: Toast.Style.Success, title: "完整备份已复制" });
                }}
              />
              <Action
                title="复制兼容导入的备份"
                icon={Icon.Clipboard}
                onAction={async () => {
                  const snapshot = getVaultState();
                  await Clipboard.copy(exportAsJson(snapshot.accounts, snapshot.groups));
                  await showToast({ style: Toast.Style.Success, title: "备份已复制（不含回收站）" });
                }}
              />
            </ActionPanel>
          }
        />
        <List.Item
          icon={Icon.SaveDocument}
          title="导出到文件"
          actions={
            <ActionPanel>
              <Action title="选择导出路径" icon={Icon.SaveDocument} onAction={() => push(<ExportForm />)} />
            </ActionPanel>
          }
        />
      </List.Section>
    </List>
  );
}

function AccountItem({
  account,
  groups,
  push,
}: {
  account: AccountData;
  groups: VaultGroup[];
  push: ReturnType<typeof useNavigation>["push"];
}) {
  const groupName = account.groupId ? groups.find((group) => group.id === account.groupId)?.name : undefined;
  return (
    <List.Item
      icon={account.type === "hotp" ? Icon.Hashtag : Icon.Key}
      title={account.note || account.name}
      subtitle={[account.issuer, groupName].filter(Boolean).join(" · ")}
      accessories={[{ text: account.type.toUpperCase() }]}
      actions={
        <ActionPanel>
          <Action title="编辑备注与名称" icon={Icon.Pencil} onAction={() => push(<AccountForm mode="edit" account={account} />)} />
          <ActionPanel.Section title="移动到分组">
            <Action
              title="未分组"
              icon={Icon.Folder}
              onAction={() => void commit((snapshot) => setAccountGroup(snapshot, account.id, null), "已移动账户")}
            />
            {groups.map((group) => (
              <Action
                key={group.id}
                title={group.name}
                icon={Icon.Folder}
                onAction={() => void commit((snapshot) => setAccountGroup(snapshot, account.id, group.id), "已移动账户")}
              />
            ))}
          </ActionPanel.Section>
          <ActionPanel.Section>
            <Action
              title="移入回收站"
              icon={Icon.Trash}
              style={Action.Style.Destructive}
              onAction={() => void commit((snapshot) => moveToTrash(snapshot, account.id), "已移入回收站")}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

function AccountForm({ mode, account }: { mode: "create" | "edit"; account?: AccountData }) {
  const { pop } = useNavigation();
  return (
    <Form
      navigationTitle={mode === "create" ? "添加账户" : "编辑账户"}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={mode === "create" ? "添加" : "保存"}
            onSubmit={async (values: FormValues) => {
              if (mode === "create") {
                const input = normalizeNewAccountInput({
                  name: values.name,
                  issuer: values.issuer,
                  secret: values.secret,
                  type: values.type,
                  digits: Number(values.digits),
                  period: Number(values.period || 30),
                  algorithm: values.algorithm,
                  note: values.note,
                  remark: values.remark,
                });
                if (!input) {
                  await showToast({ style: Toast.Style.Failure, title: "账户信息不合法", message: "请检查 Base32 密钥、位数与周期。" });
                  return;
                }
                const groupId = values.group === UNGROUPED ? null : values.group;
                const ok = await commit((snapshot) => addAccounts(snapshot, [input], groupId ?? null), "已添加账户");
                if (ok) pop();
                return;
              }
              if (!account) return;
              const ok = await commit(
                (snapshot) =>
                  setAccountText(snapshot, account.id, {
                    name: values.name || account.name,
                    issuer: values.issuer ?? account.issuer,
                    note: values.note,
                    remark: values.remark,
                  }),
                "已保存账户",
              );
              if (ok) pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField id="name" title="名称" defaultValue={account?.name} placeholder="alice@example.com" />
      <Form.TextField id="issuer" title="发行方" defaultValue={account?.issuer} placeholder="GitHub" />
      {mode === "create" && (
        <Form.TextField id="secret" title="Base32 密钥" placeholder="JBSWY3DPEHPK3PXP" />
      )}
      {mode === "create" && (
        <Form.Dropdown id="type" title="类型" defaultValue="totp">
          <Form.Dropdown.Item value="totp" title="TOTP（基于时间）" />
          <Form.Dropdown.Item value="hotp" title="HOTP（基于计数器）" />
        </Form.Dropdown>
      )}
      {mode === "create" && (
        <Form.Dropdown id="digits" title="位数" defaultValue="6">
          <Form.Dropdown.Item value="6" title="6 位" />
          <Form.Dropdown.Item value="8" title="8 位" />
        </Form.Dropdown>
      )}
      {mode === "create" && <Form.TextField id="period" title="周期（秒）" defaultValue="30" />}
      {mode === "create" && (
        <Form.Dropdown id="algorithm" title="算法" defaultValue="SHA-1">
          <Form.Dropdown.Item value="SHA-1" title="SHA-1" />
          <Form.Dropdown.Item value="SHA-256" title="SHA-256" />
          <Form.Dropdown.Item value="SHA-512" title="SHA-512" />
        </Form.Dropdown>
      )}
      <Form.TextArea id="note" title="备注" defaultValue={account?.note} />
      <Form.TextArea id="remark" title="标记" defaultValue={account?.remark} />
    </Form>
  );
}

function GroupForm({ mode, group }: { mode: "create" | "rename"; group?: VaultGroup }) {
  const { pop } = useNavigation();
  return (
    <Form
      navigationTitle={mode === "create" ? "新建分组" : "重命名分组"}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={mode === "create" ? "新建" : "保存"}
            onSubmit={async (values: FormValues) => {
              const name = values.name ?? "";
              const ok = mode === "create"
                ? await commit((snapshot) => addGroup(snapshot, name).snapshot, "已新建分组")
                : await commit((snapshot) => renameGroup(snapshot, group?.id ?? "", name), "已重命名分组");
              if (ok) pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField id="name" title="分组名" defaultValue={group?.name} placeholder="工作" />
    </Form>
  );
}

function ImportForm() {
  const { pop } = useNavigation();
  return (
    <Form
      navigationTitle="从文件导入"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="导入"
            onSubmit={async (values: FormValues) => {
              const target = normalizePath(values.path ?? "");
              if (!target) return;
              let text: string;
              try {
                text = readFileSync(target, "utf8");
              } catch {
                await showToast({ style: Toast.Style.Failure, title: "无法读取文件", message: target });
                return;
              }
              const ok = await commit((snapshot) => previewImport(text, snapshot)?.snapshot ?? snapshot, "导入完成");
              if (ok) pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField id="path" title="备份文件路径" placeholder="~/Downloads/goose-2fa-backup.json" />
    </Form>
  );
}

function ExportForm() {
  const { pop } = useNavigation();
  const [path, setPath] = useState(`~/Downloads/goose-2fa-backup-${new Date().toISOString().slice(0, 10)}.json`);
  return (
    <Form
      navigationTitle={t("Export to File", "导出到文件")}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={t("Export", "导出")}
            onSubmit={async () => {
              const target = normalizePath(path);
              if (!target) return;
              const snapshot = getVaultState();
              try {
                writeBackupFile(target, exportAsSyncJson(snapshot.accounts, snapshot.groups, snapshot.trash));
              } catch (error) {
                await showToast({
                  style: Toast.Style.Failure,
                  title: t("Export Failed", "导出失败"),
                  message: error instanceof Error ? error.message : String(error),
                });
                return;
              }
              await showToast({ style: Toast.Style.Success, title: t("Full backup exported", "已导出完整备份"), message: target });
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField id="path" title={t("Export Path", "导出路径")} value={path} onChange={setPath} />
      <Form.Description text={t("The full data source (including IDs and trash) can be used as a data source on another device.", "导出的是完整数据源格式（含 id 与回收站），可直接作为另一台设备的数据源文件。")} />
    </Form>
  );
}

const UNGROUPED = "__ungrouped__";

function CreateSourceForm() {
  const { pop } = useNavigation();
  return <Form navigationTitle={t("Create Data Source at Location", "指定位置新建数据源")} actions={<ActionPanel><Action.SubmitForm title={t("Create and Use This File", "新建并使用此文件")} onSubmit={async (values: { directory?: string[]; fileName?: string }) => {
    const directory = values.directory?.[0];
    const name = values.fileName?.trim() || "goose-2fa.json";
    if (!directory || !path.isAbsolute(directory) || !/^[^/\\\0]+\.json$/i.test(name)) {
      await showToast({ style: Toast.Style.Failure, title: t("Choose a folder and enter a .json filename", "请选择目录并填写 .json 文件名") });
      return;
    }
    try {
      if (!statSync(directory).isDirectory()) throw new Error(t("Folder does not exist", "目录不存在"));
      const target = resolveVaultPath(path.join(realpathSync.native(directory), name));
      if (getVaultState().localBroken) throw new Error(t("Local vault is corrupted; incomplete data cannot be written to a new file", "本地库已损坏；不能把不完整数据写成新文件"));
      const current = getVaultState();
      const result = await writeVaultFile(target, exportAsSyncJson(current.accounts, current.groups, current.trash), null, true);
      if (result.status !== "ok") throw new Error(result.status === "conflict" ? t("File already exists; select it in extension preferences", "文件已存在，请在扩展设置中选择它") : t("Could not create file; check folder permissions or write lock", "无法创建文件，请检查目录权限或写入锁"));
      await selectCreatedSource(target);
      await showToast({ style: Toast.Style.Success, title: t("Data source created", "已新建数据源"), message: target });
      pop();
    } catch (error) {
      await showToast({ style: Toast.Style.Failure, title: t("Creation Failed", "新建失败"), message: error instanceof Error ? error.message : String(error) });
    }
  }} /></ActionPanel>}>
    <Form.FilePicker id="directory" title={t("Save Folder", "保存目录")} allowMultipleSelection={false} canChooseDirectories canChooseFiles={false} />
    <Form.TextField id="fileName" title={t("Filename", "文件名")} defaultValue="goose-2fa.json" />
    <Form.Description text={t("File contains plaintext 2FA secrets. Select the same iCloud file on another computer to sync. Existing files are never overwritten.", "文件含明文 2FA 密钥；在另一台电脑选择同一 iCloud 文件即可读取。已有文件不会被覆盖。")} />
  </Form>;
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
  group?: string;
  path?: string;
}
