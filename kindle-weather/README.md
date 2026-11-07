# Kindle 多地区天气屏

程序文件为 `weather.html`，支持广州越秀、增城新塘、揭西河婆、茂名茂南、开封龙亭，全部使用北京时间。

Kindle 的固定启动书通过 GitHub Contents API 读取本分支的这个文件。程序更新时只需替换同一路径，Kindle 重新打开启动入口即可取得新版；首次启动器安装后不用再通过 USB 传书。重新进入页面后点“保持显示”。天气数据的定时更新独立进行，不会反复请求 GitHub。

程序文件应保留 `<!-- kindle-weather-package:v1 -->` 格式标记和完整自包含 HTML。读取失败时启动器使用书内版本。不向 Kindle 写入 GitHub 令牌，不上传用户书籍。

数据来源：Open-Meteo（CC BY 4.0）、RainViewer；静音保活组件的 MIT 许可包含在 HTML 中。
