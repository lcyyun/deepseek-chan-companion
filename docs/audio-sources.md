# 敲击音效来源

按 **0.18.0** 核对：**2026-11-01**。[文档导航](README.md) · [声音与口型](../README.md#声音与口型)

这里记录敲击音效；默认晓伊朗读和视频独立配音分别见[语音接入](agent-integration.md)与[视频记录](video-introduction.md)。本次核对本地音效文件与下列 SHA-256 一致，不改变素材来源和使用约束。

- **金属敲盆**（`basin`）：本项目 `src/shared/basin-sound.mjs` 的本地模态合成，沿用原有音色。
- **经典钢管掉落**（`pipe`）：Myinstants 的 [Metal Pipe Falling Sound Effect](https://www.myinstants.com/en/instant/metal-pipe-falling-sound-effect-7737/) 页面提供的 [Download MP3](https://www.myinstants.com/media/sounds/metal-pipe-falling-sound-effect.mp3)，页面上传者为 aiden1014。2026-11-01 下载到 `public/audio/metal-pipe-falling.mp3`，保留下载文件原始字节；不是合成替代音。

本地文件为 51,662 字节，MP3、44,100 Hz、双声道，时长约 3.173 秒。SHA-256：`cf1568639d5c99f8d576138c92e5e39fc8e0835c62418a2032edce2b459e2223`。

播放器只读取随包本地副本，运行时不访问上述网站。解码后将峰值归一到与敲盆音相同的余量，再经过共用音量和压缩器；不改动原文件。来源页面提供公开下载，未标注独立的再发行许可证。
