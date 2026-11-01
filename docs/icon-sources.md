# 图标来源与格式

按 **0.18.0** 核对：**2026-11-01**。[文档导航](README.md)

本次核对下列本地文件的尺寸／校验记录及源码使用位置；图标资产没有因对话来源或菜单更新而更换。

## 悬浮球：DeepSeek 官方标志

- 本地文件：`public/icons/deepseek.svg`。
- 来源：[DeepSeek 官方品牌素材库 ICON.svg](https://github.com/deepseek-ai/awesome-deepseek-integration/blob/main/docs/_logo%20svg/ICON.svg)。
- [原始 SVG 下载地址](https://raw.githubusercontent.com/deepseek-ai/awesome-deepseek-integration/main/docs/_logo%20svg/ICON.svg)。
- Git blob SHA：`2e4650aee9fd05f4681c426cdb74ee2aeff1fb07`。
- 文件 SHA-256：`b15083e3cbb398bd35619b758c43adc0a632efccc7e2d69f2481a860862910fe`。
- 2009 字节，原始 `viewBox="0 0 71.69 52.76"`，颜色 `#4d6bfe`。完整保留下载字节，没有重新描绘、改色或添加文字。
- 页面使用 `/icons/deepseek.svg`，建议通过 `<img>` 加 `object-fit: contain` 保持原比例。

品牌素材遵循 [DeepSeek 官方使用规范](https://github.com/deepseek-ai/awesome-deepseek-integration/blob/main/docs/_logo%20svg/guidelines.md)：在实际接入 DeepSeek 模型或 API 时使用，准确保留标志，不暗示本应用为官方产品或存在官方合作关系。这里使用的是标志原件，不是 AI 生成的仿标志。

## 应用图标：DeepSeek-chan 大头

- 输入：用户本地模型目录中的 `大肥鱼.png`，原模型不收录在本仓库。
- 方法：先查看原图，然后使用内置 `image_gen` 的透明背景编辑模式；没有使用 CLI/API 后备路径。
- 生成原稿保存在本机图像生成缓存；后续构建直接使用随仓库保存的 PNG/ICO，不依赖这份缓存。
- 项目文件：`public/icons/app-avatar.png`，1024 × 1024，RGBA，真实透明背景。保留人物蓝发、鱼鳍状耳朵、女仆头饰、DS 发夹及五官；显示头部与少量衣领，无钢盆、外框或背景。
- Windows 文件：`public/icons/app.ico`，包含 16、20、24、32、40、48、64、96、128、256 像素的十种尺寸。
- 技术处理仅用 Pillow 将 1254 × 1254 的生成原稿等比缩为 1024 × 1024，并生成 ICO 各尺寸；未通过脚本修改画面内容或重建透明通道。
- 原人物素材及衍生头像仍保留原模型的素材使用约束。本图用于这个桌宠应用的本地图标，不表示 DeepSeek 官方应用身份。

生成时的完整提示词：

```text
Use case: identity-preserve. Asset type: transparent square Windows application icon. Edit the provided original DeepSeek-chan portrait into one polished 1024x1024 square head icon. Preserve this exact character's identity and existing anime illustration style: blue hair with cyan highlights, blue eyes, characteristic blue-and-white outward fish-fin ears, white ruffled maid headband, curved blue ahoge, small DS hair clip. Retain the original face shape and friendly small closed-mouth smile with subtle pink cheeks. Composition: centered large head, complete ears, complete headband and ahoge, with about 7% transparent margin on every side. Show only head plus a very small amount of neck/collar; no bust, shoulders, hands or long trailing hair below the collar. Adapt the silhouette for clear readability at 32px and 64px while keeping the face recognizably identical. Actual transparent RGBA background, clean antialiased edges, no white or black matte, no checkerboard pixels. Do not add any container, circle, tile, border, shadow, text, watermark, steel basin, new accessories or objects. Do not crop the face, ears, headband or ahoge. Preserve artwork colors, no dramatic redesign.
```

## 打包接入

普通 Vite 构建和进程内受限构建都会将 `public/icons/` 复制到 `dist/icons/`。Electron 窗口使用 `dist/icons/app.ico`，托盘读取头像 PNG；Windows EXE 资源使用 `public/icons/app.ico`。`scripts/package.mjs` 在复制 Electron 可执行文件后，调用开发依赖 `rcedit` 的本地 Windows 工具写入图标和产品名称/版本；不会修改 `node_modules/electron` 的原始程序。该工具只用于打包，发行包不包含它。版本由锁文件固定，后续替换时须验证 EXE 图标和版本资源。

校验值：

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| `app-avatar.png` | 1042472 | `9d4e2df70f54acc91abc33c0bff4e22c2a4b705128389215c51447897042683b` |
| `app.ico` | 161237 | `811139b977ea338167cd3fc81da10e6d08cda6e6b45046da275feb70c0c32f1a` |

已检查 PNG 的 alpha 通道和完整头像轮廓，ICO 十种尺寸均能由 Pillow 重新读出。行为、模型、运行时源码未因图标制作而修改。
