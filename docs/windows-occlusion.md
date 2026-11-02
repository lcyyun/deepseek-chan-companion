# Windows：桌宠显示时其他应用画面停住

修复版本：0.20.1。诊断日期：2026-11-02。

## 现象与原因

桌宠显示时 DSH、Codex 的画面不再更新，但后台仍执行；隐藏桌宠后恢复。实际桌宠的 HWND 覆盖整个屏幕工作区，模型附近的 `setShape` 通常是一个偏向右下角的简单矩形。

Chromium 的 Windows 遮挡检测会忽略复杂区域，但对简单区域仍使用整个 `GetWindowRect`，不使用区域偏移。Electron 的 DirectComposition 逐像素透明在本机没有声明 `WS_EX_LAYERED`，因此其他 Chromium 进程把整个桌宠 HWND 当成不透明遮挡，并暂停下层窗口绘制。

依据：[Chromium 142 原生窗口判断](https://raw.githubusercontent.com/chromium/chromium/142.0.7444.52/ui/gfx/win/hwnd_util.cc)、[Electron 39.8.10 窗口透明度实现](https://raw.githubusercontent.com/electron/electron/v39.8.10/shell/browser/native_window_views.cc)。

## 修复

在 `desktop/main.cjs` 创建 Windows `pet` 窗口后、首次显示前调用 `win.setOpacity(254 / 255)`。这会声明原生 layered alpha=254，让遮挡检测知道该窗口并非不透明。整体不透明度约 99.6%，模型内部的逐像素透明仍由原渲染器处理。

不要把数值恢复为 1；CSS／canvas 透明本身不能替代此原生属性。该设置只应用于桌宠窗口，不改 DSH/Codex 配置，不关闭硬件加速，不取消 `setShape` 的鼠标保护，也不改变用户置顶选择。

## 验证记录

两个独立 Electron 进程：探针位于左上角，覆盖层的可见形状只在右下角，实际不遮住探针。

| 覆盖层 | 探针可见状态 | 5 秒动画帧 |
|---|---|---:|
| 隐藏 | visible | 1200 |
| 显示、opacity=1 | hidden | 0 |
| 显示、opacity=254/255 | visible | 1200 |
| 再改回 opacity=1 | hidden | 0 |
| 再隐藏 | visible | 1200 |

原生 alpha=254 后，继续改变区域、切换置顶、使用全窗捕获、隐藏再显示，均保持 visible，5 秒记录 1184–1201 帧。帧数与本机刷新率有关，验收重点是绘制持续推进而非固定帧数。

本机原始记录在被忽略的 `output/occlusion-check/`。生产窗口回归在 `tests/desktop-pointer-fixture.cjs` 检查初始化及输入模式切换后的透明度；目标 Windows 设备还应检查模型可见、摸头与点击保护，以及 DSH/Codex 在桌宠显示时持续更新。

本机 0.20.1 实例检查到窗口实际可见、layered 属性有效、alpha=254、LWA_ALPHA=2；模型与 DSH 聊天桥均就绪。用户随后确认 DSH/Codex 画面恢复、摸头正常。251 项 CI 通过；生产指针 fixture 在现有启动模式 `--no-sandbox` 下通过。普通 Electron 子进程测试入口仍遇到本机已有的 `0x80000003` 限制，此处不宣称完整桌面测试集已通过，也没有为本修复新增或修改 DSH/Codex 的启动参数。
