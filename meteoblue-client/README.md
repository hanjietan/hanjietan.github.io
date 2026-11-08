# Meteoblue 缓存天气屏

单地点揭西河婆的 ES5/Chrome 49 前端。只读取固定公开 GitHub JSON，不请求气象提供方，也不包含 key。网络或格式错误会保留已有缓存与原始时间；没有数据时显示“等待天气数据”。

固定缓存地址：`https://api.github.com/repos/hanjietan/hanjietan.github.io/contents/kindle-weather/cache/hepo.json?ref=codex%2Fkindle-weather`，请求头仅 `Accept: application/vnd.github.raw+json`。

界面显示当前未结束的6小时预报区间与随后72小时的气温、湿度、平均总云量、6小时累计降水、平均风速和风向。温湿度对应区间末时；云与风为6小时平均，降水是该区间总量。时间统一北京时间，不插值生成分钟级降水。

Basic 与 Clouds 各自的发布时间、取得时间分别可见。`modelrunUpdateTimeUtc` 与 `modelrunUtc` 支持数值、数组或 null，显示数组最大有效时刻，不修改原始列表。未知值显示 `--` 或斜线，不当成零。风向为来向，0/360为北风。

首次打开或手动“更新”立即读取 GitHub 缓存；自动读取对齐北京时间00:35、06:35、12:35、18:35，每日四次，给后台计划的:17任务留出18分钟。Actions仍可能延迟，因此显示真实数据时间；读取失败等待下一个计划点，不短轮询，也不触发新的付费取数。另一个本地计时器在预报时段结束时换到下一段并重画，不请求网络、不刷新提供方时间。退出页面清理计时器和保活。NoSleep 与既有已实机通过的 MIT 版本逐字节一致。

## 构建与检查

```powershell
python meteoblue-client/build_bundle.py
node --check meteoblue-client/client.js
node meteoblue-client/test_client.js
node meteoblue-client/headless_test.js
```

- `bundle.html` 为自包含的实际客户端，不嵌入任何合成或真实天气数值；运行后才读缓存。
- `bundle-manifest.json` 记录规范化 UTF-8/LF 源码及 bundle SHA-256。
- 只有 `index.html`、`client.js`、`keep-awake.js`、`LICENSE.nosleep.txt` 和构建脚本参与程序构建；测试文件不内联。
- 两个固定标记供专用启动器检查：`kindle-weather-package:v1`、`kindle-weather-source:meteoblue-cache:v1`。没有旧提供方回退。
- ES5 语法使用 Acorn `--ecma5` 另行核对；后台布局检查使用本机 Chrome、Python 和 Node 的内置模块，无可见浏览器窗口。

测试不是双方分别手写假合同：`test_support.py` 直接调用当前 `meteoblue-service/service.py` 的真实 `normalize()` 与 `public_cache()`，将官方格式的合成数据经过后台变换后喂给前端。覆盖独立包时间、数组时间、缺失 Clouds、空缓存、72小时选段、上海日期/闰日/夏令时无关、缺测与单位/风向、失败保留、晚到响应、6小时读取/本地换段、退出清理及固定无凭据URL。

`headless_test.js` 在600×800视口检查完整、仅Basic、等待数据三种状态。所有测试天气均为模拟，截图显著标“模拟数据”，且网络被替换为测试传输；这些 JSON 与截图不能发布成真实天气。`headless-results.json` 记录测试 bundle 指纹及实际网络请求数为零。

数据契约版本为 `schemaVersion=1`、`source=meteoblue`；`packages.*.resolutionHours=6`。首次真实API数据、GitHub缓存发布、专用启动书交付及新前端实机验证由主任务完成，本目录不会自动发布或写入设备。
