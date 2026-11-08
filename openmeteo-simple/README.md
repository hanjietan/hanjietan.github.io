# Open-Meteo 大字天气版

已发布的独立程序目录；不修改两份 Meteoblue 界面及其冻结包。主天气显示揭西河婆当前气温、今天及明后天最低—最高温、WMO天气和日降水，实际主数据 `source:'open-meteo'`，无其它气象源回退。新增和风分钟降水缓存的本地候选尚待根任务验证真实缓存后发布，两者分别署名。

当前温度直接来自 API `current.temperature_2m`，标出 `current.time` 的北京时间；它是当前模型条件，不是气象站实测。日预报按 UTC+8 的完整年月日选择，日天气码使用 WMO 4677，不能套用 Meteoblue 日码。降水是当地日累计，包括雨、阵雨和雪的水当量。缺测显示横线，零降水才显示 0。

Open-Meteo 主天气首次/手动即读，自动取数仍为每六小时的北京时间 00:35/06:35/12:35/18:35，不作一分钟或五分钟重试。读取失败保留上次成功数据、有效时刻与取得时间。午夜只在本地换明后天日期，不发请求。单独 localStorage 键不读取旧数据源缓存；存储不可用仍可使用。

页面为 ES5，自包含 `bundle.html` 依次内联 NoSleep、rain_cache、provider、client 和完整 MIT 许可。原始分钟数据分析器 rain_hint 只在后端使用，不进入公开HTML。主来源 marker 为 `kindle-weather-source:open-meteo:v1`，额外来源为 `kindle-weather-additional-source:qweather-minute-cache:v1`；不带 Meteoblue 来源标记。旧书所需兼容封套由另一目录负责，保持实际客户端字节和实际来源不变。NoSleep 与冻结版逐字节相同，需要点“保持显示”；页面退出时取消媒体、所有网络和本地显示定时器。

`rain_cache.js` 每5分钟读固定 GitHub `cache/hepo-rain.json`，每60秒本地重算，失效边界立即隐藏；重绘时也核对有效期。收到数据后最多保留10分钟，且源更新时间最多允许30分钟；两者任一到期、超出2分钟时钟容差的未来时间、404、错误/未知数据都不会显示提示，不表示无雨。该策略针对实际观察到约12分钟源延迟校准；GitHub Actions 仍可能延迟，缓存过期时隐藏。重读同一文件不会改动原始时间或原validUntil；错误保留内部原时间但隐藏提示。浏览器不调用和风API、不持有JWT/私钥。

公开缓存 schemaVersion=2，只含地点/时间与派生 alert:null 或 {kind:rain|snow,forecastTime,timing:approximate|nearby}，不含API原始分钟数组、summary、降水量或refer。客户端拒绝旧schema1/raw缓存；有效期取validUntil、updatedAt+1800、fetchedAt+600的最小值：源已旧12分钟但刚取得，可用最多10分钟；源已旧29分钟，仅余最多1分钟。approximate时用时刻重算5分钟粒度，标签已过去即改“近期可能有雨/雪”；nearby始终使用这句，不把未知覆盖变成起雨倒计时。

正降水之前若有缺测、未知类型、时间缺口或早先已出现降水，只显示“近期可能有雨/雪”；连续已知0覆盖才显示近似分钟数。有效提示用底部32px一行替换主天气取得时间；隐藏后恢复，不改顶部和日卡。和风署名在提示可见/隐藏时均保留。

后台构建与离线测试：

```powershell
python openmeteo-simple/build_bundle.py
node openmeteo-simple/provider.test.js
node openmeteo-simple/test_client.js
node openmeteo-simple/rain_hint.test.js
node openmeteo-simple/rain_cache.test.js
node openmeteo-simple/headless_test.js
```

需要 Python 3、Node 22+、已安装 Chrome。`test_support.js` 将fixtures/ 中保存的公开真实 API 快照送入真正 provider 的纯函数；和风模拟公共缓存经真正后端 `normalizeRaw` 生成。模拟文件只用于离线测试，不进入bundle或真实天气缓存。headless 在独立隐藏 profile/about:blank 中模拟 XHR 并冻结测试时间；截图标明仅本地验证。覆盖两尺寸、全部WMO码、大雨量、负温、缺测、读取失败，以及雨情可见/0/未知/404/过期恢复时间行；字体缩放后的关键文字间距至少12px。

2026-11-08已发布至既有入口（提交 682b546015467078c290e07c5d80d4dc3169dd54）。原035354启动器→GitHub程序→Open-Meteo的完整真实链路通过，恰好两次GET；当前温度、明后天天气码/温度/雨量均已核对，无旧天气缓存请求。真实图与报告保存在本地 runtime/openmeteo-chain-live-final-20261108/；Kindle新界面待用户重新打开确认。程序未内嵌任何快照或模拟数据；`bundle-manifest.json` 记录最终程序及源文件SHA。发布、实际Kindle验收和回滚由根任务负责。
