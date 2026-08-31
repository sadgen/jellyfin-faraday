# Jellyfin Faraday 转码起播与 Seek 全面修复计划

## 1. 任务背景

Jellyfin Faraday 在选择 `1 Mbps` 等转码画质时存在以下体验问题：

- 首次打开视频等待时间很长。
- 开始播放后通常稳定、流畅。
- 快进、快退和拖动进度条等待时间很长。
- Jellyfin 控制台可能显示 `DirectPlay`，但服务器实际上正在运行 FFmpeg 转码。

本计划用于指导其他 agent 完整修复播放协议、转码定位、HLS 生命周期和 Jellyfin 会话上报。不要只做局部参数调整。

## 2. 已确认的现场证据

以下结论已经通过只读 Jellyfin API 和已有 FFmpeg 日志确认，不需要重新猜测：

- Jellyfin 版本为 `10.11.11`。
- Intel QSV 已启用，设备为 `/dev/dri/renderD128`。
- 硬件编码正常工作，成功任务使用 `h264_qsv`。
- 最近成功转码速度约为实时的 `12.6x～19.1x`，约 `518～596 fps`。
- 当前 `1 Mbps` 请求确实使用：
  - 视频编码器：`h264_qsv`
  - 视频码率：`1,000,000 bps`
  - 音频编码器：`libfdk_aac`
  - HLS MPEG-TS 分片长度：3 秒
  - 实测速度：约 `17.7x`、`566 fps`
- 因此主要问题不是 Unraid 或 QSV 编码性能不足。
- 当前转码日志没有携带服务端起播偏移；用户位于视频后段时，FFmpeg 请求仍可能从 0 开始。
- Faraday 当前主要在 HLS 清单解析后执行 `video.currentTime = target`，没有让 Jellyfin 从目标时间直接开始转码。
- 部分旧任务出现 `scale_vaapi → hwmap → h264_qsv` 滤镜格式协商失败，但最新同类任务已经可以正常使用 QSV。
- Jellyfin 当前存在待重启配置，但这不是本次客户端问题的主要根因。

## 3. 核心根因

### 3.1 HLS URL 缺少服务端起播位置

`getHlsUrl()` 和 `getSmoothHlsUrl()` 没有携带 `StartTimeTicks`。初始续播和远距离 seek 只修改浏览器 `currentTime`，Jellyfin 不能可靠地从目标位置开始生成分片。

### 3.2 Seek 在交互过程中被反复提交

当前键盘、滚轮、鼠标拖动和触摸手势会频繁直接设置 `video.currentTime`。拖动过程可能触发大量无意义的定位和 HLS 请求。

### 3.3 播放逻辑重复且分叉

影院播放器、浮动窗口和 VR 播放器分别维护 HLS、回退、seek 和会话上报逻辑，行为已经不一致，难以保证修复覆盖全部入口。

### 3.4 Jellyfin 会话上报不完整

当前 `reportPlayback()` 缺少 `MediaSourceId`、`PlayMethod` 等字段，导致实际转码时 Jellyfin 控制台仍可能显示 `DirectPlay`。

### 3.5 MediaSource 和浏览器能力判断不准确

当前代码常假设 `MediaSourceId === itemId`，并将 MP4、MKV、AVI 等容器笼统声明为可直放，没有按视频、音频、字幕编码能力判断。

## 4. 总体验收标准

- 1 Mbps 冷启动首帧：局域网内目标不超过 3 秒。
- 缓冲区内 seek：目标不超过 0.5 秒。
- 缓冲区外 seek：目标不超过 3 秒。
- 从 70 分钟处续播时，FFmpeg 必须直接从目标附近开始，不能从 0 追赶。
- 一次拖动手势只允许提交一次最终 seek。
- 每个播放窗口最多存在一个有效 FFmpeg 转码任务。
- 关闭、切换媒体、切换画质或切换音轨后，旧任务在 5～10 秒内结束。
- Jellyfin 控制台正确显示 `Transcode`、真实码率和转码原因。
- 影院、浮窗、VR 三种播放器的播放和 seek 行为一致。
- 不降低原画直放的成功率和速度。

## 5. P0：修正 Jellyfin 播放请求

主要文件：

- `src/api/jellyfinClient.js`
- `src/api/__tests__/jellyfinClient.test.js`

### 5.1 扩展 HLS URL 构造器

让 `getHlsUrl()` 和 `getSmoothHlsUrl()` 接收统一选项：

```js
{
  playSessionId,
  mediaSourceId,
  startTimeTicks,
  audioStreamIndex,
  subtitleStreamIndex,
  videoBitrate,
  audioBitrate
}
```

URL 至少应正确携带：

- `MediaSourceId`
- `PlaySessionId`
- `DeviceId`
- `StartTimeTicks`
- `AudioStreamIndex`（有明确选择时）
- `SubtitleStreamIndex`（需要时）
- 正确的视频与音频码率

参数命名和类型应以 Jellyfin 10.11.11 OpenAPI 为准。`startTimeTicks` 在 `/Videos/{itemId}/master.m3u8` 路由中受支持。

### 5.2 使用真实 MediaSourceId

- 从 PlaybackInfo 的 `MediaSources` 中选择实际媒体源。
- 不再假设 MediaSource ID 与 Item ID 相同。
- 多版本媒体需要保留用户或服务器选定的媒体源。

### 5.3 优先使用 PlaybackInfo 结果

播放前调用 `/Items/{itemId}/PlaybackInfo`，读取：

- `MediaSourceId`
- `PlayMethod`
- `DirectStreamUrl`
- `TranscodingUrl`
- 音轨、字幕流及默认索引
- 转码原因

优先采用 Jellyfin 返回的 URL 或参数；仅在服务端未返回有效 URL 时使用本地 URL 构造器。

### 5.4 修正 DeviceProfile

不要仅凭容器声明浏览器可以直放。设备能力至少要区分：

- 视频编码：H.264、HEVC、VP9、AV1
- 音频编码：AAC、MP3、AC3、EAC3、DTS、TrueHD
- 字幕：VTT、SRT、ASS、PGS、DVD Subtitle
- 容器：MP4、WebM、MKV 等

可以结合 `video.canPlayType()`、MediaCapabilities API 和保守回退规则生成浏览器 DeviceProfile。

## 6. P0：建立统一播放会话控制器

建议新增：

- `src/hooks/useJellyfinPlaybackSession.js`
- 或 `src/utils/playbackSessionController.js`

三个播放器必须复用同一套核心逻辑，组件只负责 UI。

控制器状态建议包含：

```text
idle → loading → playing → seeking → playing
                         ↘ recovering/error
```

需要集中管理：

- 播放模式：`direct` / `transcode`
- Item ID、MediaSource ID
- PlaySession ID
- HLS 实例
- 画质、音轨、字幕
- 起播位置和当前目标位置
- 音量、静音、倍速、暂停状态
- 当前请求代数 `generationId`
- 首帧、seek、错误和恢复状态

### 6.1 防止陈旧事件覆盖新会话

每次重建播放源时递增 `generationId`：

- HLS 事件回调必须确认自己仍属于当前代数。
- 旧清单或旧分片迟到时必须忽略。
- 可配合 `AbortController` 取消仍可取消的请求。

## 7. P0：重新设计 Seek

### 7.1 预览与提交分离

鼠标拖动、触摸拖动和滚轮操作期间：

- 只更新预览时间、进度 UI 和 Trickplay 缩略图。
- 不要在每个 move/wheel 事件中设置 `video.currentTime`。
- 鼠标或手指松开时只提交一次最终目标。
- 滚轮停止 300～500 ms 后提交一次。
- 连续键盘 seek 可短暂累计后统一提交。

### 7.2 缓冲区感知

提交 seek 时检查 `video.buffered`：

- 目标位于已缓冲范围：直接设置 `video.currentTime`。
- 目标不在缓冲范围且为转码模式：重建带 `StartTimeTicks` 的 HLS。
- 原画直放模式：使用浏览器原生 seek。

### 7.3 转码模式的远距离 Seek 流程

1. 保存目标位置、音量、静音、倍速、暂停状态。
2. 停止旧 HLS 加载。
3. 向 Jellyfin 上报旧会话 `Stopped`。
4. 销毁旧 HLS 实例和媒体源。
5. 创建新的 PlaySession ID。
6. 使用目标秒数乘以 `10,000,000` 生成 `StartTimeTicks`。
7. 创建新 HLS URL 并加载。
8. 首个可播放分片到达后恢复播放器状态。
9. 上报新的 `Started`，PlayMethod 必须为 `Transcode`。
10. 首帧出现后结束 seeking 状态并记录耗时。

需要防止一次 seek 同时残留旧、新两个 FFmpeg 任务。

## 8. P0：修复初次打开与续播

涉及：

- Jellyfin 续播位置
- Trickplay 点击起播
- 智能跳过前奏
- 切换集数
- 切换画质
- 切换音轨

正确流程：

1. 在创建播放 URL 前确定最终起播位置。
2. 把它放入 `StartTimeTicks`。
3. 让 Jellyfin 从目标位置开始转码。
4. 不要再在 `loadedmetadata`、`MANIFEST_PARSED` 等多个事件中重复写入 `currentTime`。
5. 仅允许一次必要的时间校准，且应防止再次触发重建。

## 9. P1：优化 HLS 参数

三个播放器统一使用同一 HLS 配置。建议初始值：

- `SegmentLength=3`
- `MinSegments=1`，降低首个清单等待时间
- `lowLatencyMode=false`，点播无需直播低延迟模式
- `backBufferLength=120`，改善短距离回退
- `maxBufferLength=30～60`

不要盲目缩短分片；2 秒分片会增加请求数量，应通过首帧和 seek 指标比较后决定。

错误恢复策略：

- 网络错误有限次数重试。
- 媒体错误优先使用 hls.js 自带恢复。
- 只有不可恢复错误才重建播放会话。
- 禁止无限执行“直放 → HLS → 直放”循环。
- 每个 generation 设置最大恢复次数。

## 10. P1：修正 Jellyfin 会话上报

扩展 `reportPlayback()` 选项和请求体，至少支持：

- `MediaSourceId`
- `PlayMethod`
- `CanSeek`
- `PlaybackRate`
- `AudioStreamIndex`
- `SubtitleStreamIndex`
- `IsMuted`
- `PlaySessionId`

调整时机：

- 实际开始播放或出现首帧后发送 `Started`。
- seek 成功后发送准确位置的 `Progress`。
- 切换画质、音轨、媒体前发送旧会话 `Stopped`。
- 关闭、卸载、播放失败时必须清理和上报 `Stopped`。
- 页面隐藏或关闭时使用尽可能可靠的结束上报方式。

## 11. P1：统一三个播放器

迁移顺序：

1. `src/components/VideoPlayerModal.jsx`
2. `src/components/FloatingVideoWindow.jsx`
3. `src/components/VrPlayerModal.jsx`

迁移完成后删除组件内部重复的：

- HLS 创建与销毁
- URL 拼接
- 直放失败回退
- 画质切换
- 音轨切换
- seek 重建
- 播放上报定时器

多浮窗必须保证：

- 每个窗口拥有独立 PlaySession ID 和 HLS 实例。
- 关闭一个窗口不影响其他窗口。
- 同一媒体多窗口播放也不能共用会话。
- 三窗口最多存在三个有效转码任务，不能因恢复或拖动翻倍。

## 12. P1：诊断与可观测性

扩展 `src/utils/playbackDiagnostics.js`，在开发诊断面板提供：

- 当前模式：原画、DirectStream 或 Transcode
- Item ID、MediaSource ID（可截短显示）
- 当前码率和转码原因
- 当前 StartTimeTicks
- 清单加载耗时
- 首帧耗时
- 最近一次 seek 耗时
- 当前 generationId
- HLS fatal error 类型
- 自动恢复次数
- 当前是否正在等待服务端分片

绝对不能显示：

- API Key
- Access Token
- 完整带凭据的 URL
- 用户密码

建议使用 `performance.mark()` / `performance.measure()` 记录：

- `play-request → manifest`
- `manifest → first-frame`
- `seek-commit → first-frame`

## 13. 测试计划

### 13.1 Jellyfin 客户端单元测试

扩充 `src/api/__tests__/jellyfinClient.test.js`：

- `StartTimeTicks` 换算正确。
- URL 使用真实 MediaSource ID。
- 1M、2M、4M、8M 参数正确。
- 音轨、字幕索引正确。
- API Key 被正确编码。
- PlaySession ID 在一次会话内稳定。
- `reportPlayback()` 包含真实 PlayMethod 和 MediaSourceId。
- `Stopped` 使用旧会话 ID，`Started` 使用新会话 ID。

### 13.2 播放控制器测试

使用假的 video element 和假的 Hls 实例测试：

- 缓冲区内 seek 不重建 HLS。
- 缓冲区外 seek 只重建一次。
- 连续十次滚轮只提交一次最终目标。
- 拖动过程不修改真实 `currentTime`。
- 陈旧 generation 事件被忽略。
- 切换画质、音轨保留位置和状态。
- 关闭播放器一定销毁 HLS 并停止会话。
- fatal error 恢复次数有上限。
- 多窗口之间的会话互不影响。

### 13.3 组件交互测试

分别覆盖影院、浮窗、VR：

- 进度条点击与拖动
- 鼠标滚轮
- 左右方向键
- 触摸滑动
- Trickplay 点击
- 续播
- 画质和音轨切换
- 播放结束和下一集

### 13.4 实机验证矩阵

- H.264 + AAC MP4 原画。
- HEVC 10-bit 转 H.264。
- 1 Mbps 冷启动。
- 从 70 分钟处续播。
- 前进、后退 15 秒。
- 前进、后退 10 分钟。
- 拖动到 10%、50%、90%。
- 1M、4M、8M、原画互相切换。
- 切换音轨。
- 外挂字幕、ASS、PGS 字幕。
- 单窗口、双窗口、三窗口。
- 桌面、手机和 VR。

验证时检查 FFmpeg 日志：

- 远距离 seek 后必须从目标附近启动。
- 不得为一次拖动生成大量重复日志。
- 旧任务必须及时退出。
- QSV 编解码必须继续生效。

## 14. 服务端辅助处理

服务端不是本次主要根因，但应做以下辅助检查：

- 在合适时间重启一次 Jellyfin 容器，使待重启配置生效。
- 保持 QSV 和 `/dev/dri/renderD128` 映射。
- 检查 `/config/data/transcodes` 是否落在慢速机械阵列。
- 如确实是慢盘，可迁移到 SSD cache。
- RAM 临时目录只能在设置容量限制和监控后使用，避免耗尽内存。
- 不要通过降低 QSV 质量来掩盖客户端 seek 问题；现有编码速度已经足够快。

## 15. 推荐实施顺序

### 提交 1：协议与测试

- 扩展 HLS URL 参数。
- 使用真实 MediaSource ID。
- 增加 StartTimeTicks。
- 扩展客户端测试。

### 提交 2：统一播放控制器骨架

- 管理 HLS、会话和 generation。
- 暂时仅接入影院播放器。

### 提交 3：影院播放器 Seek V2

- 预览与提交分离。
- 缓冲区判断。
- 远距离 seek 重建 HLS。
- 初次续播从服务端目标位置启动。

### 提交 4：会话上报和诊断

- 修复 PlayMethod。
- 增加首帧、seek 指标。
- 完善错误恢复和清理。

### 提交 5：浮窗迁移

- 替换重复播放代码。
- 验证双窗、三窗隔离。

### 提交 6：VR 迁移

- 统一画质、音轨、seek 和清理语义。

### 提交 7：实机回归与删除旧路径

- 完成验证矩阵。
- 清除不再使用的旧播放逻辑。

## 16. 灰度、回滚与兼容

开发期间增加本地功能开关，例如：

```text
faraday_playback_engine_v2
```

- 默认可先对开发环境启用。
- 出现兼容问题时允许退回旧引擎。
- 新引擎通过完整验证后再移除旧路径和开关。
- 回滚不能影响用户的默认画质、倍速、字幕和音量设置。

## 17. Agent 执行约束

- 开始修改前检查工作区现有未提交改动，不得覆盖用户修改。
- 优先做小提交和可验证的独立改动。
- 不要把 Jellyfin 地址、账号或 API Key 写进源码、测试、日志或文档。
- 不要为了验证自动删除媒体、刷新媒体库或修改 Jellyfin 配置。
- 未得到明确授权时，不要主动启动真实转码压力测试。
- 每个阶段必须运行相关单元测试和静态检查。
- 最终交付应报告修改文件、测试结果、剩余风险和实机验证结果。
