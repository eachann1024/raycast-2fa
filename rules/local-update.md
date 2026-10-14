## 固定本地更新流程

- 功能或修复通过必要验收后，只提交本任务改动并推送 main，然后执行 `bun run update:raycast`（或 `npm run update:raycast`）；执行失败时修复并重试，不再要求用户手动导入。
- 命令先从当前源码构建正式版及已安装的 Screenshot Demo，Demo 重新同步正式版代码并保留独立的虚构账户；两份产物检查通过后备份旧安装，再通过 Raycast CLI 更新并校验全部新构建文件，失败时恢复原有产物。
- 仅更新现有 `goose-2fa` 和 `goose-2fa-review-demo` 扩展；不新增重复扩展，不修改账户、外部数据文件、偏好或快捷键。Raycast CLI 可向正在运行的 Raycast 发送后台构建刷新通知，桌面窗口及界面验收继续由用户控制。
- 备份和本次源码、提交、产物校验记录位于 `~/.cache/goose-2fa/backups/`；报告区分构建安装成功与真实界面验收，Raycast Store 提交和 GitHub 稳定版发布继续使用各自流程。
