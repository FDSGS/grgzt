# 个人工作台 Workbench

三列今日任务看板（待办 / 进行中 / 已完成），Electron 桌面应用，Windows 与 macOS 通用。
数据保存在本机（localStorage），三档主题（日间 / 暮色 / 暗夜）。

## 本地开发

```bash
npm install
npm start
```

## 本地打包

```bash
npm run dist:win    # 生成 Windows 安装包与免安装版 → release/
npm run dist:mac    # 仅能在 macOS 上生成 macOS 安装包
```

注意：macOS 的 `.dmg` 必须在 Mac 上构建，Windows 上无法交叉编译，所以 CI 里用两个系统分别编译。

## 上传到 GitHub 并自动产出安装包

GitHub Actions 会在云端分别用 Windows 和 macOS 机器编译，产物自动附在运行记录里。

1. 新建一个空仓库（GitHub 网页右上角 + → New repository，不要勾选 README）。
2. 在本目录执行：

```bash
git init
git add .
git commit -m "feat: 个人工作台桌面版"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

3. 打开仓库的 Actions 页面，选择左侧 `build`，点 `Run workflow` 手动触发一次。
4. 跑完后进入该次运行记录，页面底部 Artifacts 里可下载：
   - `workbench-win` → `.exe`（安装版 + 免安装版）
   - `workbench-mac` → `.dmg`（Intel 与 Apple Silicon）

也可以打标签让构建自动触发：

```bash
git tag v1.0.0
git push origin v1.0.0
```

## 关于 macOS 签名

CI 产出的 `.dmg` 未做开发者签名与公证。首次打开若提示"已损坏"或"无法验证开发者"，可执行：

```bash
xattr -cr /Applications/Workbench.app
```

或右键 App → 打开 → 仍要打开。
需要免提示分发时，在仓库 Secrets 里配置 `CSC_LINK`、`CSC_KEY_PASSWORD`、`APPLE_ID` 等证书信息。
