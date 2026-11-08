# Open-Meteo 大字天气版

已发布的独立程序目录；不修改两份 Meteoblue 界面及其冻结包。当前界面仅显示揭西河婆的当前气温、明天/后天最低—最高温、WMO天气和日降水。来源署名为 Open-Meteo，实际数据 `source:'open-meteo'`，无其它气象源回退。

当前温度直接来自 API `current.temperature_2m`，标出 `current.time` 的北京时间；它是当前模型条件，不是气象站实测。日预报按 UTC+8 的完整年月日选择，日天气码使用 WMO 4677，不能套用 Meteoblue 日码。降水是当地日累计，包括雨、阵雨和雪的水当量。缺测显示横线，零降水才显示 0。

新增独立北京时间时钟，每分钟按 Kindle 本机时钟更新（无需额外 API 请求）；保持显示仅尝试阻止屏幕休眠，不能保证系统不暂停定时器。首次/手动即读，自动取数改为每30分钟的北京时间每小时 :05/:35，不作一分钟或五分钟重试。读取失败保留上次成功数据、有效时刻与取得时间。午夜只在本地换明后天日期，不发请求。单独 localStorage 键不读取旧数据源缓存；存储不可用仍可使用。

页面为 ES5，自包含 `bundle.html` 依次内联 NoSleep、provider、client 和完整 MIT 许可。真实来源 marker 为 `kindle-weather-source:open-meteo:v1`；不带 Meteoblue 来源标记。旧书所需兼容封套由另一目录负责，保持实际客户端字节和实际来源不变。NoSleep 与冻结版逐字节相同，需要点“保持显示”；页面退出时取消媒体、网络和本地显示定时器。

后台构建与离线测试：

```powershell
python openmeteo-simple/build_bundle.py
node openmeteo-simple/provider.test.js
node openmeteo-simple/test_client.js
node openmeteo-simple/headless_test.js
```

需要 Python 3、Node 22+、已安装 Chrome。`test_support.js` 将fixtures/ 中保存的公开真实 API 快照送入真正 provider 的纯函数，再构造明确的离线测试变体；不发 HTTP、不包含 key。headless 在独立隐藏 profile/about:blank 中模拟 XHR 并冻结测试时间；截图标明仅本地验证，不冒充最新天气。覆盖两屏幕尺寸、全部支持WMO码、1234.56毫米降水、负温、缺测和读取失败，天气/雨量间距按实际字体和缩放后像素至少12px。

2026-11-08已发布至既有入口（提交 682b546015467078c290e07c5d80d4dc3169dd54）。原035354启动器→GitHub程序→Open-Meteo的完整真实链路通过，恰好两次GET；当前温度、明后天天气码/温度/雨量均已核对，无旧天气缓存请求。真实图与报告保存在本地 runtime/openmeteo-chain-live-final-20261108/；Kindle新界面待用户重新打开确认。程序未内嵌任何快照或模拟数据；`bundle-manifest.json` 记录最终程序及源文件SHA。发布、实际Kindle验收和回滚由根任务负责。
