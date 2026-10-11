# Goose 2FA Changelog

## 2026-10-11

- 截屏识码时先隐藏 Raycast，完成后自动打开插件并进入账户创建表单；多个识别结果先显示列表，取消截屏则返回验证码列表。
- 手动新增与扫码新增均可在保存前编辑名称、服务名、备注和 TOTP/HOTP 参数，确认保存后才创建账户。

## 2026-09-24

- 首次使用提供添加和导入入口；之后在操作菜单添加账户、截屏或选择图片识别二维码，识别结果可先编辑再保存。
- 验证码列表按服务名突出显示，并以简洁图标区分常见服务。
- 导入备份可直接选择文件；移除宫格布局和真实键盘输入，减少不必要的操作。

## [Initial Release] - {PR_MERGE_DATE}

- Search two-factor accounts in a list or grid and copy or paste codes.
- Import and export accounts with a preview; create a shared JSON data source without overwriting existing files.
- Manage accounts, groups, trash, and QR-code scanning from a single command.
