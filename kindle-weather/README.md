# Kindle 大字天气屏

单地点揭西河婆（23.4394,115.8305，北京时间）。当前使用 Open-Meteo：大字气温、明天/后天温度范围、WMO晴雨文字、日累计降水。不显示风、湿度和复杂曲线。沿用已安装《天气屏》入口，退出后重新打开取得新程序；不需USB换书或电脑常开。

GitHub只保存程序，Kindle直接向公开Forecast API取天气，无需API key。首次/手动即读；自动取数北京时间00:35、06:35、12:35、18:35。失败保留最近成功数据与原时间，午夜只在本地换日期。current.temperature_2m是标明current.time的模型当前条件，日雨量按当地日累计，天气码使用WMO体系。免费非商业规则见[Open-Meteo](https://open-meteo.com/en/pricing)，数据[CC BY 4.0](https://open-meteo.com/en/licence)。

main的Meteoblue工作流已移除cron、密钥引用和天气请求，手动执行也仅显示停用信息，停止消耗试用credits。旧缓存/账本保留但新程序不读取。原Secret未公开，当前不使用。

程序源码与自包含测试：openmeteo-simple/。weather.html是兼容已装旧启动书的传输封套；simple.html是字节一致的真实Open-Meteo程序。内层真实来源标记/署名/数据source/运行时状态均为open-meteo；兼容原因详见remote-update/OPENMETEO-TRANSPORT.md，指纹见program-manifest.json。

已装原启动器的候选加载与失败保留已隔离执行验证，通过provider10项测试、界面契约检查及61种布局；2026-11-08原启动书→GitHub程序→Open-Meteo的真实链路验证通过，恰好2次GET，当前温度、明后天天气码/温度/雨量全部非未知并与画字相符。Kindle新界面待用户重开原入口确认。模拟测试数据不进入程序。

完整Meteoblue图表版保存在codex/frozen-weather-full-20261108-032139z（b34b67ea5de95b1b82961fec897334baacf0dc48），旧Meteoblue大字版在codex/frozen-simple-meteoblue-20261108-0412z（a6a3c2a32a1dcd51b631c58fc40dc9488d087736）。回滚仅更新程序，不重置持久配额账本；Meteoblue后台保持停用，除非以后明确选择恢复。现书在程序GET完全失败时仍会使用书内旧完整图回退（只读旧公开缓存，不调用付费API）。
