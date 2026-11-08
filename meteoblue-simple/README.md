# 大字天气版

独立目录；冻结的 `meteoblue-client/` 和已安装书籍均未改动。本界面已发布至既有 `kindle-weather/weather.html`（提交 `d6e0da7e6265d3109a881659023642bd4d5c265a`）；最终程序已冻结，39,492字节，SHA256 `f329131b5d09937d0ef65ce7373a5d3441de6a4ef18eecee4fec58c991571248`。ES5、离线契约、52项布局及长天气文字间距检查通过；真实温度、日期、日降水及其画布文字已核对；真实天气码与Kindle新界面仍待验证。

后台可选天气码保留逻辑已发布（提交 `19e702`）。计划由2026-11-08既定04:17 UTC（北京时间12:17）任务自然取得真实代码；Actions可能延迟，不为本界面额外发起天气请求。无需等待此数据更新即可查看大字版；取得天气码后按原缓存计划自动显示晴阴。

界面只显示揭西河婆、带时刻的气温预报、明天/后天最低—最高温、官方天气文字和日降水。风与湿度不显示。气温直接选择距离当前时间最近的原始 6h 预报点，不插值；相同距离取较晚点，超过 6h 显示未知。大字整数温度并非当前实测。

`daily.time` 可能标在北京时间 06:00，按 UTC+8 的完整年月日寻找真正明天和后天，不靠数组下标或午夜时间戳。日温度范围只用日数据；日降水以毫米显示，缺测保留 `--`。天气只接受 `weatherCodeSystem: meteoblue-pictocode-1-25` 的官方日/6h码（1–17、20–25）；旧缓存无代码时显示“天气暂无”，不从云量或雨量制造晴阴图示。相关可选字段由 `meteoblue-service` 在后续自然响应中保留，前端不调用气象 API。

同一固定 GitHub Contents JSON 缓存，首次/手动即读，自动读取对齐北京时间 00:35、06:35、12:35、18:35。失败保留上次成功数据与时间，等下一计划槽。GitHub Actions 可能延迟，界面只显示缓存实际发布/取得时间。独立显示定时器在最近点切换中点、6h有效界限和北京时间午夜重绘；这不发网络请求或改变数据时间。独立 localStorage 键仅保存通过 Meteoblue 契约校验的数据；禁用存储仍可运行。

## 发布与现有启动书

最终 `bundle.html` 已发布到既有 `kindle-weather/weather.html`，沿用目前已安装的《天气屏》。发布后退出天气页面，再重新打开书中入口，启动器会读取新程序；“更新”按钮只读取天气缓存。**本次切换不需要USB、不增加书籍入口，也不需要电脑常开。**

书内回退仍是冻结的完整图版，在线程序网络失败或未通过校验时会打开该版。最终包已在隔离无头浏览器中实际执行已装启动书内的原启动器：在线路径加载简版，网络失败路径打开完整图版，两者均接受冻结时的真实旧缓存，并在退出时清理计时器；此检查没有真实网络或天气API请求。启动器不检测新页面所有运行时错误，因此本地执行与版式检查不能冒充Kindle实机验收。

## 完整图版保存

远端分支 `codex/frozen-weather-full-20261108-032139z` 固定在提交 `b34b67ea5de95b1b82961fec897334baacf0dc48`；main调度workflow对应提交 `6881767fa7633e0d758b822951e1cc06796c1e8e`。

本地 `runtime/frozen/weather-full-20261108-032139z/` 保存：

- `weather-full.zip`：726,137字节，SHA256 `6fd4ae84328364de9d3912a14648ee9d72b2148b1e0582e03142d10c240d2e1e`。
- `build-support.zip`：2,926,659字节，SHA256 `3df2b89fff87993cfa707e6e48a1a9d685e45ffbed48769dc8f14be9ffbd2b13`。

回滚仅恢复界面程序，保留最新缓存和配额账本；冻结包里的旧账本作为审计快照，不恢复到生产。API key仍留在GitHub Secret，不随冻结包或客户端分发。

## 保持显示与本地验证

`keep-awake.js` 与冻结完整版逐字节相同，保留 NoSleep MIT 许可。需要点击“保持显示”；媒体进度未确认时不虚称已取得系统唤醒锁。离开页面会取消两个定时器并释放媒体。

构建与离线测试（Python 3、Node 22+、已安装的 Chrome；无 provider 请求）：

```powershell
python meteoblue-simple/build_bundle.py
node meteoblue-simple/test_client.js
node meteoblue-simple/headless_test.js
```

`test_support.py` 将明确的模拟气象输入送入真实 `meteoblue-service.normalize/public_cache`，不接触 key、网络、账本或生产缓存。浏览器测试在独立隐藏 profile/about:blank 中用模拟 XHR，截图标明模拟数据；覆盖 600×800、390×520、全部天气码、长雷雨文字、大雨量、负温、缺码、缺测和等待状态。VM 测试还覆盖上海跨年/闰年/午夜、最近温度点中点切换、旧日数据不误标明天、取数计划、乱序回包、错误保留和保持显示生命周期。

`bundle.html` 仅内联 HTML、两份 ES5 脚本和完整 MIT 许可，不包含测试天气、key、外部脚本或电脑服务地址。保留现有 launcher 要求的两个固定 marker 和 `canvas#screen`。`bundle-manifest.json` 记录当前程序的源码和包指纹。真实GitHub读取检查见 `live-results.json` 与 `real-simple-preview.png`；天气码与Kindle验收状态仍待更新。
