# Kindle 天气屏

单地点揭西河婆（23.4394,115.8305，北京时间）的 Meteoblue 天气屏，显示未来72小时温度、湿度、总云量、6小时累计降水、平均风速和风向。

`weather.html` 是固定启动程序；`cache/hepo.json` 是云端天气缓存。Kindle自行联网，不需要电脑常开。程序重新打开入口时更新；缓存自动读取对齐北京时间00:35、06:35、12:35、18:35，首次及手动更新立即读取缓存。

main分支的 `.github/workflows/kindle-meteoblue.yml` 计划北京时间00:17、06:17、12:17、18:17运行，checkout本分支执行 `meteoblue-service/`：Basic每日最多四次，Clouds每日最多一次。两包保留各自的实际取得/模型时间；Actions可能延迟，页面不伪造新时间。

API key只在 Actions Secret `METEOBLUE_API_KEY`，不会进入客户端、天气JSON或启动书。重复运行受持久时段账本限制；错误保留旧成功包，缺测显示未知，实际单包计费异常时暂停。按标准计费正常全年预算730万credits，免费试用额度有效一年。

`meteoblue-client/` 为自包含ES5客户端；`meteoblue-service/` 为标准库Python服务与测试。当前客户端与新《天气屏》启动器都只使用Meteoblue缓存，无其他天气源回退。NoSleep MIT许可内嵌程序，Meteoblue来源链接保留。

首轮云端取数及真实缓存渲染成功；原厂Kindle已拔掉USB验证新书正常。后续普通程序更新替换同一路径即可，日常天气数据自动更新。
