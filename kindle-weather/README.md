# Kindle 天气屏（Open-Meteo 当前版）

此目录只保留当前正在运行的天气屏：揭西河婆（23.4394, 115.8305；北京时间）。

- `weather.html`：**已安装 Kindle 咪咕《天气屏》所使用的固定远程入口**。旧启动书依赖此路径和外层兼容标记；不可随意改名、移除或改写。
- `simple.html`：真实的自包含 Open-Meteo 大字客户端；`openmeteo-simple/` 保存源码、构建文件、许可及离线测试。
- `program-manifest.json`：当前已发布客户端与封套的来源、字节数和 SHA-256。
- `remote-update/make_openmeteo_transport.py`：旧启动书兼容封套的构建工具；`remote-update/OPENMETEO-TRANSPORT.md` 说明兼容机制。

天气数据由 Kindle 直接向公开的 Open-Meteo Forecast API 读取，不需要密钥、付费 API 或 GitHub Actions 后台更新。正常按北京时间 00:35、06:35、12:35、18:35 更新，进入页面及点击「更新」也会触发读取；失败保留此前的成功数据与原时间。来源署名与许可按客户端显示。

## 冻结的 Meteoblue 备用版

只保留 **Meteoblue 数据详细版（完整图表版）** 作为未来可恢复的历史版本：

- 分支：`codex/frozen-weather-full-20261108-032139z`
- 冻结原始提交：`b34b67ea5de95b1b82961fec897334baacf0dc48`
- 详细天气图表客户端、配套服务、历史 API 缓存及额度账本保留在此冻结提交。
- **Meteoblue 大字简洁版** `codex/frozen-simple-meteoblue-20261108-0412z` 属于不再需要的中间版本，目标是删除该备份分支，而非保留它。
- **Meteoblue 后台取数仍须停用。** 以后需要恢复详细版时，先确认 API 免费额度/许可和密钥，恢复时不得重置持久配额账本。

2026-11-08 整理：已经从当前活跃分支移除 Meteoblue 图表/简洁程序副本、取数服务、旧缓存及过时验证脚本；它们不属于当前 Open-Meteo 运行链路。Git 历史和冻结提交仍可供查阅。

注意：原 Kindle 启动书内置的离线回退程序无法靠 GitHub 远程修改；若远端程序加载失败，设备可能尝试旧 Meteoblue 回退页面。由于当前分支已移除旧天气缓存，该回退不会得到新的 Meteoblue 数据。若希望彻底替换此离线回退，必须通过 USB 更新启动书。
