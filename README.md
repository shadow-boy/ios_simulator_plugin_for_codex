# iOS Simulator Plugin for Codex

一个面向 Codex 官方插件体系的 iOS Simulator 控制插件。它通过 MCP 工具让 Codex 能够在本机开发环境中预检 Xcode、列出和切换模拟器、截图、安装和启动 App，并发送点击、滑动、文本输入和硬件按钮事件。

本项目迁移自 Codex++ iOS Simulator 插件思路，但不依赖 Codex++ 对 Codex 桌面端右侧面板的 DOM 注入能力。当前版本没有实现内嵌实时镜像，原因是官方 Codex 插件模型更适合通过 `skills`、`mcpServers` 和脚本工具提供稳定能力；截图 + 输入控制已经能覆盖主要开发调试闭环。

## 功能

- 环境预检：检查 macOS、完整 Xcode、`simctl`、`SimulatorKit.framework`。
- 设备管理：列出可用设备、启动设备、关闭设备、切换当前设备。
- 截图验证：对当前 booted 模拟器截图，默认保存到桌面。
- 输入控制：发送点击、滑动、Home/Lock/Side/Siri/Apple Pay 等硬件按钮事件。
- 文本与 URL：向模拟器输入文本，打开 URL 或 App Scheme。
- App 生命周期：安装 `.app`，按 bundle identifier 启动 App。
- 私有 API helper：触摸和硬件按钮输入复用 Apple 私有 SimulatorKit/CoreSimulator 通道，仅用于本机开发阶段。

## 环境要求

- macOS。
- 完整 Xcode，不能只安装 Command Line Tools。
- 至少安装一个 iOS Simulator runtime 和设备。
- Node.js 18 或更高版本。
- Codex 桌面端或支持本地插件/MCP 的 Codex 环境。

如果当前 `xcode-select` 指向 Command Line Tools，请切换到完整 Xcode：

```bash
sudo xcode-select -s /Applications/Xcode.app
```

## 目录结构

```text
.
├── .codex-plugin/
│   └── plugin.json
├── .mcp.json
├── helpers/
│   ├── sim-capture.swift
│   └── sim-input.m
├── mcp-server/
│   └── server.js
├── package.json
├── README.md
└── skills/
    └── ios-simulator/
        └── SKILL.md
```

关键文件说明：

- `.codex-plugin/plugin.json`：Codex 官方插件元数据。
- `.mcp.json`：声明本插件提供的 MCP server。
- `mcp-server/server.js`：MCP stdio server，暴露 iOS Simulator 工具。
- `helpers/sim-input.m`：私有 API 输入 helper，按需自动编译。
- `helpers/sim-capture.swift`：原始抓帧 helper，当前不暴露实时镜像工具，保留供后续扩展。
- `skills/ios-simulator/SKILL.md`：告诉 Codex 如何使用这些工具完成模拟器调试流程。

## 安装方式

推荐把仓库克隆到 Codex 本地插件目录：

```bash
mkdir -p ~/plugins
git clone git@github.com:shadow-boy/ios_simulator_plugin_for_codex.git ~/plugins/ios-simulator
```

然后创建或更新本地 marketplace 文件：

```bash
mkdir -p ~/.agents/plugins
```

如果 `~/.agents/plugins/marketplace.json` 不存在，可以直接写入：

```json
{
  "name": "local",
  "interface": {
    "displayName": "Local Plugins"
  },
  "plugins": [
    {
      "name": "ios-simulator",
      "source": {
        "source": "local",
        "path": "./plugins/ios-simulator"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Developer Tools"
    }
  ]
}
```

如果该文件已经存在，只需要在 `plugins` 数组中追加上面的 `ios-simulator` 条目。保存后重启 Codex，并在插件列表中安装或启用 `iOS Simulator`。

## 本地验证

进入插件目录：

```bash
cd ~/plugins/ios-simulator
```

校验 JSON：

```bash
node -e "JSON.parse(require('fs').readFileSync('.codex-plugin/plugin.json','utf8')); JSON.parse(require('fs').readFileSync('.mcp.json','utf8')); console.log('json ok')"
```

校验 MCP server 语法：

```bash
node --check mcp-server/server.js
```

运行环境预检：

```bash
npm run preflight
```

预期输出类似：

```json
{
  "ok": true,
  "developerDir": "/Applications/Xcode.app/Contents/Developer",
  "simctl": "/Applications/Xcode.app/Contents/Developer/usr/bin/simctl",
  "availableDeviceCount": 13,
  "bootedDeviceCount": 0
}
```

可选：提前编译私有输入 helper。

```bash
printf '%s\n' \
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
'{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
'{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ios_simulator_compile_helpers","arguments":{"includeCapture":false}}}' \
| node mcp-server/server.js
```

正常情况下，首次使用 `tap`、`swipe` 或 `button_tap` 时也会自动编译 `helpers/sim-input.m`，不需要手动执行。

## MCP 工具清单

| 工具 | 说明 |
| --- | --- |
| `ios_simulator_preflight` | 检查 macOS、Xcode、`simctl`、`SimulatorKit` 和可用设备数量。 |
| `ios_simulator_list_devices` | 列出 iOS Simulator 设备，默认只返回可用设备。 |
| `ios_simulator_boot_device` | 启动指定 UDID 的模拟器。 |
| `ios_simulator_shutdown_device` | 关闭指定 UDID 的模拟器。 |
| `ios_simulator_select_device` | 关闭其他 booted 设备并启动目标 UDID。 |
| `ios_simulator_screenshot` | 对 booted 模拟器截图，默认保存到 `~/Desktop`。 |
| `ios_simulator_tap` | 在归一化坐标处点击屏幕。 |
| `ios_simulator_swipe` | 在归一化坐标之间滑动。 |
| `ios_simulator_button_tap` | 发送硬件按钮点击事件。 |
| `ios_simulator_type_text` | 通过 `simctl io booted keyboard type` 输入文本。 |
| `ios_simulator_open_url` | 在 booted 模拟器中打开 URL 或 App Scheme。 |
| `ios_simulator_install_app` | 安装本地 `.app` 到 booted 模拟器。 |
| `ios_simulator_launch_app` | 启动指定 bundle identifier 的 App。 |
| `ios_simulator_compile_helpers` | 编译私有 API helper。 |

## 典型使用流程

让 Codex 调试模拟器时，建议按这个顺序执行：

1. 调用 `ios_simulator_preflight`。
2. 调用 `ios_simulator_list_devices`，选择目标 iPhone 或 iPad。
3. 调用 `ios_simulator_select_device` 启动目标设备。
4. 如需安装 App，调用 `ios_simulator_install_app`。
5. 调用 `ios_simulator_launch_app` 启动 App。
6. 调用 `ios_simulator_screenshot` 查看当前画面。
7. 根据截图调用 `ios_simulator_tap`、`ios_simulator_swipe`、`ios_simulator_type_text` 或 `ios_simulator_button_tap`。
8. 再次截图验证结果。

示例提示词：

```text
请使用 iOS Simulator 插件预检环境，列出可用 iPhone 模拟器，启动最新系统的 iPhone，并截图确认桌面状态。
```

```text
请安装 /path/to/MyApp.app 到当前 booted 模拟器，启动 com.example.MyApp，然后截图验证首页。
```

```text
请在当前模拟器屏幕中心点击一次，然后截图确认变化。
```

## 坐标规则

触摸和滑动工具使用归一化坐标：

```text
(0, 0) 表示屏幕左上角
(1, 1) 表示屏幕右下角
```

常用坐标：

```text
屏幕中心: x=0.5, y=0.5
左上返回区域: x=0.08, y=0.08
底部 Home 指示条附近: x=0.5, y=0.94
底部 Tab Bar 第一个入口: x=0.1, y=0.94
底部 Tab Bar 最后一个入口: x=0.9, y=0.94
```

滑动示例：

```json
{
  "fromX": 0.5,
  "fromY": 0.82,
  "toX": 0.5,
  "toY": 0.25,
  "durationMs": 450,
  "steps": 14
}
```

## 安全边界

本插件默认遵循最小必要原则：

- 不暴露任意 shell 执行能力。
- 不暴露任意 `simctl` 子命令执行能力。
- 截图文件名会做字符过滤，并要求后缀为 `.png`、`.jpg` 或 `.jpeg`。
- 自定义截图目录必须已经存在。
- 点击和滑动坐标必须在 `0..1` 范围内。
- App 安装只接受本地 `.app` 目录。
- 触摸和硬件按钮输入使用 Apple 私有模拟器 API，仅用于本机开发调试。

## 私有 API 说明

`helpers/sim-input.m` 会在首次输入操作时自动编译为 `helpers/sim-input`。它通过 `SimulatorKit` 的 HID 通道向 booted 模拟器发送触摸和硬件按钮事件。

这类私有 API 不会进入业务 App，也不会影响 IPA 打包；它只运行在开发机上的 Codex 插件进程中。风险主要来自 Xcode 私有符号变化。如果升级 Xcode 后输入失效，先运行：

```bash
npm run preflight
```

再让 Codex 调用：

```text
ios_simulator_compile_helpers
```

## 故障排查

### `preflight` 提示 Command Line Tools

说明当前 `xcode-select` 没有指向完整 Xcode：

```bash
sudo xcode-select -s /Applications/Xcode.app
```

### 截图失败

通常是没有 booted 设备。先让 Codex 调用：

```text
ios_simulator_list_devices
ios_simulator_select_device
ios_simulator_screenshot
```

### 点击或滑动无效

先确认只有一个目标设备处于 `Booted` 状态。然后测试 Home 键：

```text
ios_simulator_button_tap name=home
```

如果 Home 键也无效，重新编译 helper：

```text
ios_simulator_compile_helpers includeCapture=false
```

### `SimulatorKit framework was not found`

通常是 Xcode 尚未完成组件安装。打开一次 Xcode，等待组件安装完成后重试。

### 安装 App 失败

确认传入的是 `.app` 目录，而不是 `.ipa`：

```text
/path/to/Build/Products/Debug-iphonesimulator/MyApp.app
```

## 工程原则

- KISS：公开能力优先使用 `xcrun simctl`，私有 helper 只处理 `simctl` 不擅长的触摸和硬件输入。
- YAGNI：不实现官方 Codex 暂无稳定接口承载的内嵌实时镜像，避免维护脆弱的 UI 注入逻辑。
- SOLID：设备管理、截图、输入、App 生命周期分别封装为独立 MCP 工具。
- DRY：复用原 helper 的底层输入能力，Node MCP server 只负责参数校验、进程管理和安全边界。

## License

MIT
