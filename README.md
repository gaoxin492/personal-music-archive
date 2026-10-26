# Music Archive · 私人音乐档案馆

一个本地优先、无需订阅的私人音乐收藏与播放器。音频文件保存在你自己的磁盘上，由本地 FastAPI 服务建立索引并提供播放，界面是 React 网页应用（电脑与手机浏览器均可访问）。

当前版本：**Phase 1 MVP**（附带部分 Phase 2 / P1 能力，见文末“实现状态”）。

## 快速开始（Windows / macOS / Linux）

需要 Python 3.11+ 与 Node.js 20+。

```bash
# 1. 后端依赖
cd backend
pip install -r requirements.txt

# 2. 构建前端（只需在前端代码变动后重做）
cd ../frontend
npm install
npm run build

# 3. 启动（同时提供 API 与网页）
cd ../backend
python -m app
```

打开 <http://localhost:8000>。

### 开机自动启动 + 桌面应用（Windows）

```bash
powershell -ExecutionPolicy Bypass -File scripts/install-autostart.ps1
```

- 登录 Windows 时，服务会用 `pythonw` 在后台启动，不弹窗口。日志写在 `MusicArchive/logs/server.log`。
- 桌面和开始菜单里会出现 **Music Archive** 图标。点开后，它会用 Edge（没有 Edge 时用 Chrome）的应用模式打开一个独立窗口，没有标签页和地址栏。如果服务没在运行，它会先把服务启动起来。
- 也可以在浏览器地址栏点“安装应用”（网页已带 manifest 和图标），效果相同。
- 移除：`powershell -ExecutionPolicy Bypass -File scripts/uninstall-autostart.ps1`。这会删除所有快捷方式并停止服务，但不会碰曲库。
- 移动项目文件夹后，需要重新运行安装脚本，因为快捷方式里记的是绝对路径。

### 用手机访问（同一 Wi-Fi）

```bash
python -m app --host 0.0.0.0
```

然后在 iPhone 上打开 `http://<电脑的局域网 IP>:8000`。**注意：当前没有登录机制，只在可信的家庭网络中这样做。**

### 开发模式

```bash
cd backend && python -m app --reload      # 终端 1，端口 8000
cd frontend && npm run dev                # 终端 2，http://localhost:5173（/api 自动代理到 8000）
```

### 生成测试音频

```bash
pip install -r backend/requirements-dev.txt
python scripts/make_test_audio.py         # 写入 MusicArchive/import/，然后在“导入与备份”里点“开始扫描”
```

生成 20 首合成的、无版权问题的测试曲目（FLAC 16/24bit、MP3 320k、WAV、OGG，含中日文标题与内嵌封面）。

## 档案目录

默认在项目内的 `MusicArchive/`，可通过环境变量 `MUSIC_ARCHIVE_ROOT` 指向外置硬盘或 NAS：

```
MusicArchive/
  audio/Artist/Album/NN - Title.ext   原始文件（归档母版，导入后不再改动）
  artwork/                            提取的封面与收藏馆封面
  database/archive.db                 SQLite：曲目、收藏馆、备注、来源、导入日志
  import/                             导入收件箱；导入成功的文件移到 import/_imported/
  trash/                              “从曲库移除”的音频会移到这里，从不永久删除
  backups/  metadata/                 预留
```

收藏馆（Solitude / Theatre / Memories）和歌单只是数据库里的逻辑分组，一首歌可以同时属于多个分组，音频只存一份。

**备份**：整个 `MusicArchive/` 文件夹就是完整的档案。按 3-2-1 原则把它复制到外置 SSD 和一个异地位置即可。复制前先停止服务器，确保 SQLite 写入完成。“导入与备份”页还可导出 JSON（全部数据）和 CSV（曲目清单，Excel 可直接打开中文），并可用 SHA-256 校验所有文件。

## 导入规则

- 支持：MP3、FLAC、M4A（AAC / ALAC）、AAC、WAV、AIFF、OGG Vorbis、Opus。其他格式会被**明确记录为“不支持”**，不会静默跳过。
- 去重按文件内容的 SHA-256：只有字节完全相同的文件才视为重复。同名但录音不同的文件不会被合并。
- 复制进曲库后会重新计算校验值，与原文件不一致则放弃导入。
- 没有标签的文件（例如从视频网站提取的音频），会从文件名识别歌名和歌手：`歌手《歌名》…`、`《歌名》- 歌手`、`Artist - Title`、`03. Title`。“百万豪装录音棚”“Hi-Res 无损音质”“Official Video”这类后缀会被去掉。
- 文件扩展名和实际格式不一致时（例如 AAC 文件被命名为 `.mp3`），会按真实格式保存，并在导入日志里注明。
- 在曲目详情里修改歌名、歌手、专辑或曲序后，硬盘上的文件会自动移到 `歌手/专辑/NN - 歌名.ext`。音频内容和文件里的标签都不会被改动。如果文件正在播放、暂时无法移动，会在下次保存或重启服务时自动完成，也可以调用 `POST /api/library/reorganize` 立即整理。
- 同一作品的不同录音：给它们填写相同的“作品”字段，再用“录音版本”区分（例如 `1986 Original London Cast`）。列表会显示版本数，详情页会列出其他版本。

## 歌词

- 在曲目详情（⋯）的“歌词”区可以粘贴 LRC 歌词，也可以导入 `.lrc` 文件。文件编码支持 UTF-8 和 GBK/GB18030。
- 带时间点的歌词会在播放页右侧跟着音乐滚动高亮，点某一行就跳到那里播放。手动滚动后，4 秒内不会自动拉回。手机上点播放页右上角的歌词按钮，可以在唱片和歌词之间切换。
- 没有时间点的普通歌词会静态显示。导入音频时，如果文件里内嵌了歌词，会自动读取。
- 歌词保存在数据库的 `lyrics` 表里，JSON 导出时会一并带上。不会自动联网获取歌词。

## 播放兼容性

浏览器能解码什么，取决于浏览器本身：

| 格式 | Chrome / Edge（桌面） | Safari（Mac / iPhone） |
|---|---|---|
| MP3、AAC/M4A、WAV | ✅ | ✅ |
| FLAC | ✅ | ✅（iOS 11+） |
| ALAC | ❌ | ✅ |
| OGG Vorbis / Opus | ✅ | 部分支持（新版 iOS） |

在桌面 Chrome 中实测过 FLAC、MP3、OGG、WAV。**iPhone 尚未实测。** 当前浏览器无法播放的曲目会在列表中显示警告图标；播放时会显示明确的错误并停下，不会自动跳过。为这类文件生成可播放的缓存版本（需要 FFmpeg）是计划中的功能。

iPhone 浏览器的后台播放、锁屏控制和离线播放都受平台限制。应用已接入 Media Session API（支持该 API 的平台上可用锁屏与耳机按键控制），但不承诺完整的原生 App 体验，这些属于 Phase 4。

## API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/tracks?q=&collection_id=&favorite=&sort=&desc=` | 列表 / 搜索 / 排序 |
| GET / PATCH / DELETE | `/api/tracks/{id}` | 详情 / 编辑元数据 / 移除（文件移到 trash） |
| PATCH | `/api/tracks/{id}/note` | 评分、收藏、情绪标签、备注、初听时间与场景 |
| GET | `/api/tracks/{id}/stream` · `/artwork` | 音频流（支持 Range 拖动）· 封面 |
| POST | `/api/tracks/{id}/acquisitions` | 登记购买来源 |
| GET / POST / PATCH / DELETE | `/api/collections[/{id}]` | 收藏馆与歌单 |
| POST / DELETE / PUT | `/api/collections/{id}/tracks` · `/order` | 加入 / 移出 / 排序 |
| POST | `/api/collections/{id}/cover` | 上传收藏馆封面 |
| POST | `/api/import/upload` · `/api/import/scan` | 上传导入 · 扫描收件箱 |
| GET | `/api/import/log` | 导入日志 |
| GET | `/api/library/check?verify_hashes=` | 丢失文件 / 校验值检查 |
| GET | `/api/export/library.json` · `/api/export/tracks.csv` | 导出 |

## 实现状态

**已实现**
- Phase 1：FastAPI + SQLite 后端、Mutagen 元数据读取（标题、艺术家、专辑、作曲、年份、曲序、时长、格式、采样率、位深、码率、封面）、上传导入与收件箱扫描、导入日志、三大收藏馆、自定义歌单、单曲收藏、搜索（支持 Unicode 大小写）、排序、播放 / 暂停 / 上下首 / 进度 / 音量、顺序 / 列表循环 / 单曲循环 / 随机、整个收藏馆连续播放、数据持久化。
- 提前实现的 Phase 2 / P1 能力：深色胡桃木主题 UI、黑胶唱片播放页、收藏馆情绪主题与自定义封面、元数据编辑、喜欢程度、情绪标签、私人备注、初听时间与场景、录音版本分组、手机布局、SHA-256 去重与完整性校验、JSON/CSV 导出。

**尚未实现**
- 购买来源只有 API 和数据表，界面里还没有填写表单。
- Wanted List、导入预览确认、MusicBrainz 元数据补全、从导出文件恢复（Phase 3）。
- 为浏览器不支持的格式生成 FFmpeg 播放缓存。
- 收藏馆内拖拽排序（已有 API，界面没有）。
- 登录 / 访问控制。
- iPhone 实机测试、原生客户端、离线同步（Phase 4）。
- 没有采用 shadcn/ui：界面使用 Tailwind 与少量自写组件，减少依赖。

## 版权边界

本项目只用于整理和播放你合法拥有的文件，不包含任何下载、抓取、DRM 移除或分享功能，也不会连接任何商店或流媒体服务。
