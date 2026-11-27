# Windows 引导安装与目录选择改造

## Context

当前 Windows 包虽然使用 NSIS 引导安装并允许修改安装目录，但桌面快捷方式不可勾选，缓存和任务数据仍跟随 Electron 默认用户目录。此次改造要让安装、缓存、数据存储位置都在安装向导中清晰可选，默认优先使用非系统盘，并确保只选择盘符或父目录时自动追加应用专属子目录。

已确认：自动目录名使用 `Workbench`、`WorkbenchCache`、`WorkbenchData`；默认按 D 到 Z 选择可用的本地固定盘并排除系统盘，只有 C 盘时明确提示后允许用户手动选择 C 盘。本次不发布新版本，也不干预正在进行的 v1.1.3 码云补传。

## 实施方案

### 1. 接入 electron-builder 的 NSIS 自定义向导

修改 `package.json`：
- 保留 `oneClick: false`、`perMachine: false`、`allowToChangeInstallationDirectory: true`。
- 增加 `nsis.include: "build/installer.nsh"`，不修改 `node_modules`，也不复制整套 NSIS 模板。
- 关闭标准流程的强制桌面快捷方式，显式保留完成后运行功能与 Unicode 安装器。

新增 `build/installer.nsh`：
- 通过 `customHeader` 声明变量和页面函数，通过 `customPageAfterChangeDir` 在安装目录页之后加入“缓存位置 / 数据存储位置 / 桌面快捷方式”页面。
- 通过 `customInstallMode` 固定为当前用户安装，避免共享数据目录导致不同 Windows 用户的数据混用，同时正确处理安装器随后重置 `$INSTDIR` 的行为。
- 保留模板标准完成页，因此“立即运行个人工作台”复选框及以当前桌面用户身份启动应用的逻辑继续使用现有实现。

### 2. 默认磁盘与自动追加目录

- 全新安装优先从 D 到 Z 选择第一个可用的非系统固定盘，三个默认路径分别为 `所选盘:\Workbench`、`所选盘:\WorkbenchCache`、`所选盘:\WorkbenchData`。
- 没有其他固定盘时不虚构 D 盘，提示后允许用户选择 C 盘。
- 安装、缓存、数据三个输入都支持浏览选择；只选 `D:\` 或 `D:\Tools` 等父目录时，分别自动追加对应专属目录。
- 仅判断路径最后一级目录，忽略大小写，避免把 `WorkbenchBackup` 误当成已追加目录，也避免重复生成 `Workbench\Workbench`。
- 缓存和数据目录必须独立于安装目录，防止标准卸载流程删除 `$INSTDIR` 时连带删除任务数据。
- 升级时恢复已有安装记录中的自定义路径；显式 `/D=` 安装目录参数保持有效。

### 3. 快捷方式与路径配置落盘

在 `build/installer.nsh` 的安装阶段：
- 根据复选框创建或不创建“个人工作台”桌面快捷方式；取消勾选时清理旧快捷方式，开始菜单快捷方式保持现有行为。
- 创建缓存和数据目录，将两个路径写入安装目录下的 `storage.ini`，并在安装注册表项保存供升级恢复。
- 在卸载钩子中补充自定义桌面快捷方式清理；默认保留缓存和用户数据，不自动删除。

### 4. 让 Electron 真正使用所选目录

修改 `electron/main.js`，在 `app.whenReady()` 之前同步读取并校验 `storage.ini`：
- Windows 已安装版本使用配置的数据目录调用 `app.setPath('userData', ...)` 和 `app.setPath('sessionData', ...)`，使现有 `localStorage` 任务数据及 `widget.json` 都进入 `WorkbenchData`。
- 使用 Chromium `disk-cache-dir` 指向 `WorkbenchCache`，并在 ready 后、创建窗口前设置默认 Session 的代码缓存路径。
- 目录必须提前创建；配置缺失、损坏或目录不可用时安全回退到原路径。macOS 和便携版不读取此安装配置，现有行为不变。
- 旧版升级到自定义数据目录时，在目标没有数据的前提下一次性迁移现有 `Local Storage` 与 `widget.json`；迁移失败回退旧目录，不覆盖目标数据、不删除旧数据。`index.html`、`widget.html` 的 `STORE_KEY` 和界面代码无需修改。

## 关键文件

- `package.json`：NSIS include、桌面快捷方式和完成页配置。
- `build/installer.nsh`：新增安装页面、默认盘检测、目录规范化、配置保存及快捷方式处理。
- `electron/main.js`：启动前应用缓存/数据目录并兼容迁移旧数据。

## 验证

1. 执行 `npx electron-builder --win nsis --x64 --publish never`，确认安装器与卸载器的 NSIS 脚本均编译成功。
2. 全新安装检查默认目录不在系统盘；分别输入 `D:\`、`D:\Tools`、已含应用名的目录，验证只追加一次且盘符根目录没有散落文件。
3. 分别测试桌面快捷方式勾选/取消，以及完成页立即运行勾选/取消。
4. 使用中文、空格路径安装，创建当天任务并修改主题、小组件位置、锁定和透明度；彻底退出再启动，确认任务和配置仍一致，且数据位于 `WorkbenchData`、磁盘/代码缓存位于 `WorkbenchCache`。
5. 从旧版覆盖安装，确认已有任务与小组件配置可继续使用，已有自定义路径可恢复，不重复追加目录、不覆盖已有目标数据。
6. 测试卸载后桌面快捷方式正确删除、数据目录保留；重新安装并选择同一数据目录后任务可恢复。
7. 检查只有 C 盘、路径不可写、配置损坏时的提示与回退行为，并运行现有应用启动检查，确认 macOS/便携版逻辑未受影响。
