# 大肥鱼 · 智能体开发版

版本 0.24.0。开发版面向用户自己的智能体、二次开发与问题排查：保留完整日常功能、性能诊断和实验对照，附应用源码、测试、构建配置与维护文档。普通使用选择用户版。

## 打开与工作目录

完整解压名称包含 `developer` 的 ZIP，运行 `Install.ps1` 或 `DeepSeek-chan.exe`。开发快捷方式和窗口会标识“开发版”。用户版与开发版分别保存数据，不自动复制或覆盖彼此的模型路径、配对码、DSH 会话和实验设置。

| 项目 | 用户版 | 开发版 |
|---|---|---|
| 推荐安装根目录 | `%LOCALAPPDATA%\Programs\DeepSeekChan` | `%LOCALAPPDATA%\Programs\DeepSeekChanDeveloper` |
| 个人数据目录（在程序文件夹旁） | `DeepSeek-chan-data` | `DeepSeek-chan-developer-data` |
| 默认本地服务端口 | `39181` | `39182` |
| 默认专用 DSH 后端端口 | `63616` | `63617` |
| 默认全局快捷键 | 注册日常快捷键 | 不注册，保留界面按钮 |

新开发 profile 的 DSH_HOME 默认为其个人数据目录下的 `dsh-home`，这是独立空目录。需要智能体为该 home 配置模型与凭据；也可由用户明确指定已有 DSH home 和目标 A 会话，但不能自动复制用户版账号或为了测试替换正在工作的会话。不要仅凭相同程序名把用户版后端当作开发版后端。

若确实需要开发版全局快捷键，在启动前显式设置 `COMPANION_DEV_HOTKEYS=1`；两版同时注册相同快捷键会冲突。临时独立测试可显式设置 `COMPANION_PORT`，浏览器扩展、MCP 和 DSH 配置也须对应该端口，不能只改服务端。

包内可修改的工程位于 `resources/app`。这个目录包含 `src`、`desktop`、`server`、`integrations`、`extension`、`public`、`scripts`、`tests`、构建配置与 `package-lock.json`；运行依赖随包提供，开发依赖需要安装。模型、个人数据、Git 历史、历史视频工程与开发依赖缓存不随包发送。

在 `resources/app` 打开终端：

```powershell
npm ci
npm run setup:live2d
npm run build
npm start
```

`npm ci` 需要 Node.js 22.12 或更新版本及 npm，首次下载依赖和 SDK 需要联网。源码构建默认是开发版。原便携程序使用自身 Electron；`npm start` 使用新装的开发依赖，两者的运行目录和数据设置应分别核对。

若要使用历史版本对照、提交修改或拉取更新，先克隆公开仓库；开发包不假装携带 Git 历史。仓库地址：<https://github.com/lcyyun/deepseek-chan-companion>。

## 功能边界

| 能力 | 用户版 | 开发版 |
|---|---|---|
| 聊天、语音、一起看、MCP 与 DSH 原生工具 | 保留 | 保留 |
| 表情／肢体预览、客制化、真实摸头敲盆与彩蛋 | 保留 | 保留 |
| 画质 | 固定高清 | 高清、均衡、省资源、自动对照 |
| GPU 数据复用、SDK 兼容快照 | 固定采用稳定策略，无开关 | 保留实验开关 |
| 性能报告、原始 rAF 统计、15 秒 GPU 计时 | 不采集、不提供入口 | 保留 |
| 强制播放胸前互动的某个阶段 | 无入口 | 保留阶段预览 |
| 深层 DSH 诊断、开发者工具 | 无测试入口 | 保留 |
| 前端源码、测试、构建脚本与完整维护资料 | 不随普通运行包分发 | 包含 |

用户版对调试 IPC 和 `GET /api/performance` 同时作运行时限制，不能靠隐藏按钮之外的直接调用重新打开测试功能。正常 `/api/state` 与 `avatar_state` 仍提供角色、聊天和 MCP 连接状态，`performance` 是 MCP 通道状态，不是渲染测速字段。

## 给接手智能体的工作方式

先读取 `package.json`、本指南、`docs/maintenance-guide.md` 和 `docs/model-control-quickstart.md`。确认正在操作开发版、自己的端口与 profile，再修改代码；不要在用户的实际 DSH 工作回合里做取消或重载实验。

| 修改目标 | 主要位置 |
|---|---|
| 窗口、悬浮球、原生输入、置顶和数据目录 | `desktop/main.cjs`、`desktop/pet-input.cjs`、`desktop/stable-pet-shape.cjs` |
| 聊天界面与用户操作 | `src/renderer/main.tsx`、`src/renderer/setup-panel.tsx` |
| 表情、肢体、组合、触摸与物理编排 | `src/shared/behavior.mjs` 及相关目录中的方案模块 |
| Cubism 资源、绘制、手臂镜像与性能计数 | `src/renderer/live2d.ts`、`src/renderer/owned-gl-state.ts` |
| HTTP、WebSocket、鉴权、对话提供方 | `server/service.mjs`、`server/adapters.mjs` |
| DSH 原生工具、隐藏提示、会话与恢复 | `integrations/dsh`、`server/dsh-manager.mjs`、`desktop/dsh-connect.cjs` |
| 两版边界、构建、安装和导出 | `desktop/app-edition.cjs`、`src/renderer/edition.ts`、`scripts/package.mjs`、`scripts/release.mjs`、`scripts/install-release.ps1` |

保留动作的进出过渡、停止／新回合取消逻辑、表情与肢体独立通道。新动作或表情先加真实 ID、能力说明和使用限制，再让智能体选择；不要通过拼接长用户提示来替代工具契约。DSH 自己维护历史，每轮只接收新用户正文，短规约走匹配回合的系统 section。

## 性能诊断

在“设置 → 性能与画质”选择对照档位，或使用 GPU 数据复用、兼容快照开关。每次只改变一项，等待模型重新加载后，在相同大小与同一动作下比较。实验选项保留用于定位，不代表开启后必然更快。

“复制性能诊断”提供同一报告窗口的 `sampleFps`、`sampleRafFps`、`sampleSkippedFrames`、`sampleRenderMeanMs` 及有界历史。`averageRenderMs` 是生命周期均值；`state/intent` 只是采样终点，跨动作窗口不能当作单一动作稳态。

点击“采集 GPU 用时（15 秒）”后播放目标动作，约 20 秒后复制报告。查询默认关闭；隐藏或重载会停止；扩展不支持、时钟失效、超时或诊断自身开销过高都会记录原因。`GET /api/performance` 只读结果，不启动采集。GPU 查询不包括桌面合成、显示扫描与端到端输入延迟，CPU 与 GPU 时间也不能直接相加。

源码中的独立探针：`scripts/benchmark-compositor.cjs` 测完整生产窗口；`scripts/benchmark-gpu-time.cjs` 测 GPU 计时；画面等价检查见 `scripts/verify-*-equivalence.cjs`。请显式提供自己的模型，使用独立 profile 和回环端口；脚本入口注释说明运行方式。它们不应用来关闭、替换或重载用户正在工作的实例。

开发 ZIP 没有 Git 历史，当前源码探针仍可运行，报告会将版本标为 `working-tree/no-git` 并保留实际源码 SHA。历史 `baseline` 对照必须在包含对应提交的 Git 克隆里运行；缺少历史时会明确停止，不会拿当前源码冒充旧版。

## 验证与构建

```powershell
npm test
npx tsc --noEmit
npm run build
```

`npm test` 禁止子进程，检查行为、协议、配置和模拟环境，不访问真实模型服务。正常 Windows 桌面环境可另跑 `npm run test:desktop`；真正的模型画面、鼠标和账号接入仍需单独验收。

DSH 沙箱不能启动 esbuild 子进程时，在已安装依赖后使用：

```powershell
npm run setup:live2d:restricted
npm run build:restricted
```

生成两种便携包：

```powershell
npm run package -- --edition=user
npm run package -- --edition=developer
```

打包默认选择用户版。打包时按版本和 edition 写入元数据，再构建对应前端；不要手动混用两版的 `dist`、`package.json` 或发行清单。开发测试不要修改用户版以绕过 edition 边界；从开发源码重建目标版本。

导出 ZIP、SHA256 与文件清单的具体命令见包内 `docs/release-quickstart.md`。用户包不包含源码测试树或调试入口；开发包包含完整应用工程，但不包括个人模型、会话、密钥、账号缓存或 `output` 产物。

## 文档与已知边界

`docs/maintenance-guide.md` 解释架构与维护，`docs/dsh-agent-guide.md` 说明 DSH 操作，`docs/agent-integration.md` 说明 API/MCP，`docs/render-performance.md` 说明性能字段与实验边界，`docs/model-control-evaluation.md` 给出表情、肢体与口型测试集。

保留桌宠 `254/255` 的原生透明度声明，它修复过其他 Chromium 应用被误判遮挡而停止刷新的问题。不要把单台电脑的 60 帧结果外推到所有电脑，也不要为获得测试数字关闭沙箱、修改系统安全标签或结束用户进程。运行错误保留脱敏摘要即可，配对码、登录信息和真实聊天不应进入公共 issue 或提交。
