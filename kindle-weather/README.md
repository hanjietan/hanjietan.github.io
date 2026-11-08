# Kindle 大字天气屏

当前入口 weather.html 使用 meteoblue-simple/：大字气温预报、明天及后天最低—最高温、晴阴天气文字和日降水。风向、风速、湿度与曲线不显示。沿用现有《天气屏》入口，重新打开即更新，无需 USB；已装启动书的离线回退仍为完整图表版。

气温取距离当前最近的原始6小时预报点，并明确标注有效时刻。明后天按北京时间日期匹配日数据；天气文字使用 Meteoblue 日/6h pictocode。新增可选天气码字段在下一轮正常 Basic 取数后自动进入缓存，旧缓存缺码时显示“天气暂无”，不推测晴阴。

现有取数安排保持不变：Basic每日最多四次，Clouds每日最多一次。main 的 .github/workflows/kindle-meteoblue.yml 计划北京时间00:17、06:17、12:17、18:17运行。客户端读缓存对齐00:35、06:35、12:35、18:35，首次及手动“更新”立即读缓存。改版不额外调用 Meteoblue。密钥仅保存在 Actions Secret，客户端与公开缓存不含密钥。

完整图表版已冻结在 codex/frozen-weather-full-20261108-032139z（commit b34b67ea5de95b1b82961fec897334baacf0dc48），meteoblue.html 亦保留完整图程序。回滚仅恢复 weather.html；不重置活动分支或覆盖持久配额账本/生产缓存。

新程序SHA256：f329131b5d09937d0ef65ce7373a5d3441de6a4ef18eecee4fec58c991571248，39,492字节。52种模拟布局、ES5/日期/缺测/调度/保持显示检查，以及已装原启动器的在线加载与回退执行检查通过。真实数据与Kindle新界面验收单独记录；测试天气不发布。Meteoblue署名与NoSleep MIT许可保留。
