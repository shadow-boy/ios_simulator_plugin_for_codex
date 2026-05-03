---
name: ios-simulator
description: Use when controlling or inspecting iOS Simulator from Codex through the local ios-simulator MCP plugin: preflight Xcode, list/boot/shutdown/select devices, take screenshots, tap, swipe, press hardware buttons, type text, install apps, launch apps, and open URLs. This plugin is for local development and may use Apple private simulator APIs for input forwarding.
---

# iOS Simulator

## 适用场景

当用户要求 Codex 操作、验证或调试 iOS Simulator 时使用本技能，例如：

- 列出、启动、关闭或切换模拟器设备。
- 安装并启动本地 `.app`。
- 截图并根据画面继续点击、滑动或输入。
- 发送 Home、Lock、Side、Siri、Apple Pay 等硬件按钮事件。
- 打开 URL 或 App Scheme。

本插件只用于开发阶段，不修改 App 代码、不参与 IPA 打包，也不改变生产产物。

## 工作流

1. 先调用 `ios_simulator_preflight`，确认 macOS、Xcode、`simctl`、`SimulatorKit` 可用。
2. 调用 `ios_simulator_list_devices` 找到目标设备；如果用户未指定设备，优先选择最新 iOS runtime 下的 iPhone。
3. 使用 `ios_simulator_boot_device` 或 `ios_simulator_select_device` 启动设备。
4. 如需验证 UI，先调用 `ios_simulator_screenshot` 获取当前画面，再基于截图决定下一步操作。
5. 使用 `ios_simulator_tap`、`ios_simulator_swipe`、`ios_simulator_button_tap` 或 `ios_simulator_type_text` 执行交互。
6. 交互后再次截图验证结果，避免只凭工具调用成功判断 UI 状态。

## 坐标约定

触摸和滑动工具使用归一化坐标：

```text
(0, 0) 左上角
(1, 1) 右下角
```

常用位置：

```text
屏幕中心: x=0.5, y=0.5
底部 Home 指示条附近: x=0.5, y=0.94
左上返回区域: x=0.08, y=0.08
```

## 工程原则

- KISS：默认使用 `simctl` 完成公开能力；只有触摸和硬件按钮输入使用私有 helper。
- YAGNI：本官方插件版本不实现内嵌实时镜像，因为 Codex 官方插件没有稳定的右侧面板注入 API，截图验证已覆盖主要调试闭环。
- SOLID：MCP 工具按设备管理、截图、输入、App 生命周期分离，避免单个入口暴露任意 shell。
- DRY：私有输入 helper 复用原始实现，Node MCP server 只负责参数校验、编译和进程管理。

## 安全边界

- 不提供任意 `simctl` 或 shell 执行工具。
- 截图默认保存到 `~/Desktop`，自定义目录必须已存在。
- 输入坐标必须在 `0..1` 范围内。
- App 安装只接受本地 `.app` 目录。
- 私有 API helper 仅面向本机开发调试，若 Xcode 私有符号变化，先重新运行预检和 `ios_simulator_compile_helpers`。

## 常见问题

- 如果提示 Command Line Tools 而不是完整 Xcode，运行：

```bash
sudo xcode-select -s /Applications/Xcode.app
```

- 如果输入事件无效，先确认有且只有一个 Booted 设备，再调用 `ios_simulator_button_tap` 的 `home` 做最小验证。
- 如果截图失败，通常是没有 Booted 设备，先调用 `ios_simulator_list_devices` 查看状态。
