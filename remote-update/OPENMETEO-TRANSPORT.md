# 已装启动书的来源迁移封套

`make_openmeteo_transport.py` 只创建本地发布候选，不改启动书、冻结包、配置或线上文件。真实客户端来自独立 `openmeteo-simple/`，保留自己的来源标记、署名和 `source: open-meteo` 数据；不带旧数据源回退。

035354启动书的旧loader既要求历史来源标记，又拒绝出现新来源字面的HTML。因此发布文件使用明确的旧传输兼容封套：只有外层保留历史接受标志，并注明它不代表天气来源；真实客户端按UTF-8 base64承载，解码后逐字节恢复原页面。实际来源没有伪装成旧来源。运行时 `KindleRemoteUpdateState.source` 和 `KindleWeatherPackage.actualSource` 也会标明 `open-meteo`，发布清单记录真实来源与内外层SHA。

如内层带有 `<!-- kindle-weather-additional-source:qweather-minute-cache:v1 -->`，清单的 `actual_sources` 和运行时 `sources` 会同时列出 `open-meteo`、`qweather`，`additional_sources` 列出后者。为兼容旧消费者，单数 `actual_source` / `source` 继续表示主天气来源；清单明确记录这一字段语义，并不表示只有一个供应商。附加降雨数据仅从公开GitHub缓存读取，封套不携带认证信息。

外层隐藏的1像素canvas只供既有传输检查。解码后通过一个零延时任务等外层解析完成，再执行内层 `document.open/write/close` 替换整个页面，避免活动 `document.write` 解析器把两层页面插在一起。最终界面不保留第二块canvas或兼容提示。

待客户端完成本地检查并冻结后运行：

```powershell
python -X utf8 remote-update/make_openmeteo_transport.py --expected-bundle-sha256 冻结的SHA256
```

新时间戳目录中，`weather.html` 是送往既有程序地址的封套；`actual-client.html` 是未经改动的真实客户端；`transport-manifest.json` 记录来源、指纹和物理回退限制。构建器不发布、不取天气、不写USB。旧启动器、MOBI和所有冻结归档均保持原样。

发布后，现书重新打开即可在线运行新来源，无需USB。但程序请求完全失败时，已装书内的完整图回退仍不可在线删除；停用旧云端付费调度不会改写这段书内程序。若要求离线/程序请求失败时也完全移除旧回退，需要另行通过USB更换一次书。新客户端自己取天气失败时应保留自己最近一次成功数据，并明确标记失败或过时，不切回旧天气源。
