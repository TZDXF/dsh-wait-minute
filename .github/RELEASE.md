# 发布流程

推送形如 `v1.0.0` 的版本标签即可触发完整发布：构建客户端 bundle → 运行测试 → 打包安装包 → 创建 GitHub Release。

## 触发条件

| 事件 | 工作流 | 结果 |
| --- | --- | --- |
| 分支推送或 PR | [ci.yml](workflows/ci.yml) | Node 22 / 24 上构建客户端 bundle 并运行测试 |
| 推送 `v*` 标签 | [release.yml](workflows/release.yml) | 校验标签、构建、测试、打包并创建 GitHub Release |
| 手动运行 Package | [package.yml](workflows/package.yml) | 只打包并上传 tgz 构建产物，不创建 Release |

标签与 `package.json` 的 `version` 必须完全一致（`v1.0.0` ↔ `1.0.0`）。不一致时发布在第一步就失败，不会产生任何 Release。

## 发布步骤

1. 确认默认分支（`master`）上待发布的提交已经推送。
2. 确认 `package.json` 的 `version` 就是目标版本（本仓库首个正式版本为 `1.0.0`，后续版本按语义化版本递增）。
3. 修改 [RELEASENOTES.md](../RELEASENOTES.md)，写清本次版本的亮点与升级提醒。
4. 提交并推送默认分支。
5. 创建并推送标签。

```bash
git add -A
git commit -m "chore: release 1.0.0"
git tag -a v1.0.0 -m "v1.0.0"
git push origin master
git push origin v1.0.0
```

推送标签后打开仓库 Actions 页面观察 `Release` 工作流；成功后 Release 附件即为安装包。

## 版本号与预发布

- 标签固定为 `v<major>.<minor>.<patch>`，可带预发布后缀，例如 `v1.0.0-beta.1`。
- 带预发布后缀的标签创建 GitHub prerelease，不会成为 Latest。
- 版本号必须同时体现在 `package.json` 与标签中；DSH 插件页显示的版本来自前者。
- 标签提交必须已包含在 `master` 上，否则校验失败并在日志中给出原因。

## 产物

- **Release 附件**：`dsh-wait-minute-<版本>.tgz`，可直接在 DSH 插件安装入口选择。
- **Actions 构建产物**（保留 30 天）：同名 tgz，便于发布前手工验证。
- tgz 内含 `src/`、`lib/`（构建生成）、`cordis.patch.yml`、`README.md`，不含第三方安装脚本。

## 打标签前的手工验证

```bash
npm run build && npm test
npm pack --pack-destination dist
```

或在 Actions 页面手动运行 `Package`，下载产物并在 DSH 中安装验证。发布工作流会重复执行同样的构建与测试，手工验证只用于提前发现问题。

## 失败处理

- **版本不一致等校验失败**：删除标签后重新发布。
  ```bash
  git push --delete origin v1.0.0
  git tag -d v1.0.0
  ```
- **发布中途失败**：修复后在该工作流运行页选择 “Re-run failed jobs”。如果 Release 已存在，工作流只会覆盖附件，不会重复创建。
- **权限**：工作流只需要 `contents: write`（创建 Release），其余权限保持只读；`checkout` 不保留凭据，发布步骤通过 `GH_TOKEN` 环境变量调用 `gh` CLI。
- **未使用第三方发布 Action**：创建工作流仅依赖 GitHub 官方 Action（`actions/checkout`、`actions/setup-node`、`actions/upload-artifact`）与 runner 自带的 `gh` CLI。
