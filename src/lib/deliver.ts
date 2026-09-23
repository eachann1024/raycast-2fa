import { t } from "./i18n";
import { Clipboard, PopToRootType, Toast, closeMainWindow, showHUD, showToast } from "@raycast/api";
import type { AccountData } from "../../vendor/lib/types";
import { typeText } from "./helper";
import { consumeHotp } from "./vault-store";

export type DeliveryMode = "copy" | "paste" | "type";

/** 复制 / 粘贴 / 真实输入。HOTP 必须先落盘递增，成功才允许把这个码交出去。 */
export async function deliverCode(account: AccountData, code: string, mode: DeliveryMode, closeAfterCopy = true): Promise<boolean> {
  if (!/^\d+$/.test(code)) {
    await showToast({ style: Toast.Style.Failure, title: t("Code Unavailable", "验证码不可用"), message: t("Please try again shortly.", "请稍后重试。") });
    return false;
  }
  if (account.type === "hotp" && !(await consumeHotp(account.id))) {
    await showToast({
      style: Toast.Style.Failure,
      title: t("Could Not Save HOTP Counter", "HOTP 计数器未能保存"),
      message: t("Delivery cancelled; please retry.", "已取消发送，请重试。"),
    });
    return false;
  }
  if (mode === "type") {
    const result = await typeText(code);
    if (!result.ok) {
      await showToast({ style: Toast.Style.Failure, title: t("Typing Failed", "真实输入失败"), message: result.message });
      return false;
    }
    await closeMainWindow();
    return true;
  }
  if (mode === "paste") {
    try {
      await Clipboard.paste(code);
    } catch (error) {
      await showToast({ style: Toast.Style.Failure, title: t("Paste Failed", "粘贴失败"), message: String(error) });
      return false;
    }
    try {
      await closeMainWindow({ popToRootType: PopToRootType.Immediate });
    } catch {
      await showToast({ style: Toast.Style.Failure, title: t("Pasted, but could not close Raycast automatically", "已粘贴，但未能自动关闭 Raycast") });
    }
    return true;
  }
  try {
    await Clipboard.copy(code, { concealed: true });
  } catch (error) {
    await showToast({ style: Toast.Style.Failure, title: t("Copy Failed", "复制失败"), message: String(error) });
    return false;
  }
  const label = account.note || account.issuer || account.name;
  if (closeAfterCopy) {
    try {
      await showHUD(t(`Copied ${label} code`, `已复制 ${label} 验证码`), { popToRootType: PopToRootType.Immediate });
    } catch {
      await showToast({ style: Toast.Style.Failure, title: t("Copied, but could not close Raycast automatically", "已复制，但未能自动关闭 Raycast") });
    }
  } else {
    await showToast({ style: Toast.Style.Success, title: t(`Copied ${label} code`, `已复制 ${label} 验证码`) });
  }
  return true;
}
