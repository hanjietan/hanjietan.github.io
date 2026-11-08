# Open-Meteo 大字天气版

独立程序目录；不修改两份 Meteoblue 界面及其冻结包。主天气显示揭西河婆当前气温、今天及明后天最低—最高温、WMO天气和日降水，实际主数据 `source:'open-meteo'`，无其它气象源回退。当前本地schema3短时预报增强版待根任务发布，两者分别署名。

当前温度直接来自 API `current.temperature_2m`，标出 `current.time` 的北京时间；它是当前模型条件，不是气象站实测。日预报按 UTC+8 的完整年月日选择，日天气码使用 WMO 4677，不能套用 Meteoblue 日码。降水是当地日累计，包括雨、阵雨和雪的水当量。缺测显示横线，零降水才显示 0。

Open-Meteo 主天气首次/手动即读，自动取数仍为每六小时的北京时间 00:35/06:35/12:35/18:35，不作一分钟或五分钟重试。读取失败保留上次成功数据、有效时刻与取得时间。午夜只在本地换明后天日期，不发请求。单独 localStorage 键不读取旧数据源缓存；存储不可用仍可使用。

页面为 ES5，自包含 `bundle.html` 依次内联 NoSleep、rain_cache、provider、client 和完整 MIT 许可。原始分钟数据分析器 rain_hint 只在后端使用，不进入公开HTML。主来源 marker 为 `kindle-weather-source:open-meteo:v1`，额外来源为 `kindle-weather-additional-source:qweather-minute-cache:v1`；不带 Meteoblue 来源标记。旧书所需兼容封套由另一目录负责，保持实际客户端字节和实际来源不变。NoSleep 与冻结版逐字节相同，需要点“保持显示”；页面退出时取消媒体、所有网络和本地显示定时器。

`rain_cache.js` 每5分钟读固定 GitHub `cache/hepo-rain.json`，每60秒本地重算，并在有效期与时段边界重算。收到数据后最多保留10分钟，且源更新时间最多允许30分钟；任一到期、超出2分钟时钟容差的未来时间、404、错误或未知覆盖时，明确显示“雨情更新中”，不当作无雨。该策略针对约12分钟源延迟校准；GitHub Actions 可能延迟。重读同一文件不会改动原始时间或原validUntil。浏览器不调用和风API、不持有JWT/私钥。

公开缓存 schemaVersion=3，只含地点/时间、knownHorizonEnd及压缩派生outlook.periods，不含API原始分钟数组、summary、降水量或refer。periods最多256项、连续有序、左闭右开，首from=fetchedAt、末to=knownHorizonEnd；kind为dry/rain/snow/unknown，rain强度为light/moderate/heavy/violent，其余strength=null。前端不从毫米数推导等级，雪只显示“降雪”。兼容旧schema2时仅保留正雨雪提示，alert:null显示“雨情更新中”，不推成无雨；拒绝schema1/raw。

有效期取validUntil、updatedAt+1800、fetchedAt+600的最小值：源已旧12分钟但刚取得，可用最多10分钟；源已旧29分钟，仅余最多1分钟。只有沿途全已知dry，才说“约20分钟后有小雨”；当前连续wet span后明确接dry，才说“当前小雨·约30分钟后停”。有未知覆盖则不造倒计时，可显示“近期有小雨”。全已知dry才报告实际剩余覆盖，例如“未来1小时40分钟无雨”，时长向下取5分钟，不补足两小时。

页脚主行默认32px，长文最低28px；小行始终显示“短时预报·和风天气”及主天气原取得时间，明确当前雨情也是预报而非实测。DOM署名链接仍可点击，屏幕底部保留4px余量。主Open-Meteo六小时、NoSleep与顶部日卡不变。

后台构建与离线测试：

```powershell
python openmeteo-simple/build_bundle.py
node openmeteo-simple/provider.test.js
node openmeteo-simple/test_client.js
node openmeteo-simple/rain_hint.test.js
node openmeteo-simple/rain_cache.test.js
node openmeteo-simple/rain_outlook.test.js
node openmeteo-simple/headless_test.js
```

需要 Python 3、Node 22+、已安装 Chrome。`test_support.js` 将fixtures/ 中保存的公开真实 API 快照送入真正 provider 的纯函数；和风模拟公共缓存经真正后端 `normalizeRaw` 生成。模拟文件只用于离线测试，不进入bundle或真实天气缓存。headless 在独立隐藏 profile/about:blank 中模拟 XHR 并冻结测试时间，截图标明仅本地验证。覆盖两尺寸、全部WMO码、负温、缺测、错误/失效、起停雨、真实覆盖无雨时长及最长页脚文案；关键文字实际glyph间距至少12px。`rain_outlook.test.js` 还覆盖连续时间、午夜跨年、强度单位、雪无等级、schema2迁移及非法覆盖拒绝。

2026-11-08已发布至既有入口（提交 682b546015467078c290e07c5d80d4dc3169dd54）。原035354启动器→GitHub程序→Open-Meteo的完整真实链路通过，恰好两次GET；当前温度、明后天天气码/温度/雨量均已核对，无旧天气缓存请求。真实图与报告保存在本地 runtime/openmeteo-chain-live-final-20261108/；Kindle新界面待用户重新打开确认。程序未内嵌任何快照或模拟数据；`bundle-manifest.json` 记录最终程序及源文件SHA。发布、实际Kindle验收和回滚由根任务负责。
