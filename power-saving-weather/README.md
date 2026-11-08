# 无雨情大字天气：省电候选

**本目录为无雨情常显优化测试版；发布记录见 runtime/power-saving-weather/，旧 Kindle 保活与续航仍须实测。不保证月续航，也未证明CPU进入深睡。** 旧的含雨情目录、程序和冻结版均未修改。

保留揭西河婆当前气温/晴雨、今天和明后天温度范围、日降水及原来的“更新／保持显示”按钮。只有 Open-Meteo，首次与手动立即取数，正常仍为北京时间00:35/06:35/12:35/18:35；午夜仅本地换日卡。没有和风缓存、5分钟请求、每分钟雨情计算或和风署名。数据失败保留最近成功数据与时间，单独本地缓存键，不回退旧数据源。

## 候选保活的实际变化

| 项目 | 原保活 | 本候选 |
| --- | --- | --- |
| 本地视频 | 176×144，约29.97fps，约1秒 | 16×16，1fps，60秒 |
| 编码 | H.264，无音轨 | H.264 Constrained Baseline level1.0，yuv420p，无音轨 |
| 循环 | 原生loop，另在timeupdate中频繁seek | 仅原生loop，无手动seek |
| 逐帧JS事件 | 注册timeupdate处理 | 不注册timeupdate |
| 保活状态检查 | 每15秒 | 每61秒，避开60秒loop的同相采样 |

pause/ended/error事件立即释放媒体并反馈失败；漏事件的停止属性由低频watchdog发现。旧WebView的play()返回undefined也可用；播放进度读不到只显示待确认，不擅自暂停。页面隐藏、离开或停止保持时，视频和定时器均释放。

视频是本地data URL，不联网。独立全解码确认60帧均为黑色，1个I帧+59个P帧，无B帧，moov在mdat前。文件 `assets/keep-awake-1fps-60s.mp4` 为2265字节，SHA256 `475cebba315f07f626a485887f3729ce55259ad5e4062b32d9bc7532f93de75d`。

帧率下降约30倍不代表耗电下降30倍。播放器、浏览器、Wi-Fi和系统仍可能保持运行；2px样式也不能证明墨水屏控制器的实际刷新范围。旧电池容量、后台活动和系统休眠行为尚未实测。

## 本地构建与验证

```powershell
# 只有需要重生成视频时才运行；优先使用已安装的ffmpeg，不下载或系统安装。
python power-saving-weather/make_video.py
# 也可指定既有工具：make_video.py --ffmpeg C:/path/to/ffmpeg.exe
python power-saving-weather/build_bundle.py
node power-saving-weather/test_keep_awake.js
node power-saving-weather/test_client.js
node power-saving-weather/headless_test.js
```

视频生成脚本会使用PATH中的ffmpeg，或现成的imageio_ffmpeg随附二进制。完整参数保存在video-build.json。HTML只内联media、keep-awake、provider、client与NoSleep技术的完整MIT许可；没有测试天气、外部脚本、key或电脑服务依赖。

10项保活生命周期测试覆盖旧play返回、Promise拒绝/晚到、停止与解码失败、缺失进度、模拟12分钟循环、退出清理，检查无seek/无timeupdate listener。天气测试覆盖当前/今日/明后天、日期边界、缺测、错误保留、独立六小时调度及无分钟网络。

headless使用隔离隐藏浏览器和带标记的离线天气，实际点击按钮后由原生Chromium解码播放：16×16/60秒、currentTime增长、0手动seek、0timeupdate listener；退出后无视频且定时器清理。它只证明当前Chromium播放，不代替旧Kindle验证。60种布局检查覆盖600×800、390×520、28种WMO码、极大日降水和缺测。所有天气XHR为模拟，0真实HTTP。

`assets/weather-fixture.json` 是2026-11-08 04:10:12 UTC取得的公开Open-Meteo历史响应（CC BY 4.0），仅测试使用，不是当前天气，也不进入程序。

## 实机验收仍待用户完成

1. 先确认新画面、数据时间和“保持显示”按钮，点击后保持至少12分钟不操作，检查是否被系统屏保替换。此项验证不能用模拟时间代替。
2. 再断开供电观察1–2小时：相同位置、Wi-Fi环境与电量区间记录起止电量。此项能发现明显问题，不能用整数电量短测证明一个月续航。
3. 后续在一个原自动取数时点核对数据时间确实更新。月续航需要更长的实际记录；不能把视频播放确认当成系统深睡或唤醒成功。

有疑问时由根任务选择恢复冻结版；本候选没有改变后台账本、服务或认证设置。
