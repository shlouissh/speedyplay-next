# 倍速播放 Next

> 本脚本的功能思路参考了黄盐开发的《倍速播放（SpeedyPlay）》，感谢原作者提供了优秀的功能设计。
>
> 原脚本链接：
> [倍速播放（SpeedyPlay）](https://greasyfork.org/zh-CN/scripts/383265-%E5%80%8D%E9%80%9F%E6%92%AD%E6%94%BE)

## 功能

1. 支持 HTML5 `<video>` 播放器。
2. 支持 0.1～20 倍播放速度，步进 0.1 倍。
3. 支持常用速度按钮，并可自行编辑，最多 6 个。
4. 双击当前速度，可以在当前速度与上一次速度之间快速切换。
5. 自动记忆当前网站的播放速度。
6. 自动记忆当前网站的控制器位置。
7. 页面动态创建或替换视频播放器时，会自动重新应用保存的播放速度。
8. 支持单页应用（SPA）中视频播放器的动态切换。
9. 使用 Shadow DOM 隔离控制器样式，尽量减少与网站自身 CSS 的冲突。
10. 不依赖旧版 TimerHooker，视频倍速直接通过 HTML5 `playbackRate` 实现。

## 关于原作者

原《倍速播放（SpeedyPlay）》由[**黄岩**](https://greasyfork.org/zh-CN/users/104201-%E9%BB%84%E7%9B%90)大佬开发。但由于黄盐大佬已失联多年，所以v1.0版本倍速失效问题一直没有修复，虽然我一直在用v0.3版本，但突发奇想是不是可以通过GPT来解决倍速失效的问题，于是便有了本项目的诞生。（本人从19年黄盐大佬创建脚本时便开始使用此倍速播放，直至22年脚本失效发了issue杳无音讯后，便继续用回v0.3版本至今）

本项目不声称是黄盐本人维护的版本，也不代表原作者的立场。

特别感谢 `计时器掌控者` 的作者 [**苍石**](https://palerock.cn/) 以及相关开源工作所带来的启发。

## 许可证

本项目为独立重写代码，使用 **MIT License**。

```text
MIT License

Copyright (c) 2026 <shlouissh>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 更新历史
### V 1.2.0  [2026.10.10]

- 更新交互方式，未悬停时显示图标与当前倍速，悬停时展开功能菜单

### V 1.1.0 [2026.10.09]

- 重写 HTML5 视频倍速控制逻辑。
- UI重做
- 不再依赖旧版 TimerHooker。
- 增加动态视频检测和自动恢复播放速度。
- 增加当前速度记忆。
- 增加控制器位置记忆。
- 增加常用速度编辑功能。
- 增加双击切换上一次速度。
- 使用 Shadow DOM 隔离控制器样式。

### 原版更新历史

以下内容仅用于说明本项目参考来源，原始作者为黄盐。

原版《倍速播放（SpeedyPlay）》由黄盐开发，最初版本及其历史请参阅原项目页面：

[倍速播放（SpeedyPlay）](https://greasyfork.org/zh-CN/scripts/383265-%E5%80%8D%E9%80%9F%E6%92%AD%E6%94%BE)
