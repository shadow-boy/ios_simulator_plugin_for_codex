#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const ROOT_DIR = path.resolve(__dirname, "..");
const HELPER_DIR = path.join(ROOT_DIR, "helpers");
const INPUT_SRC = path.join(HELPER_DIR, "sim-input.m");
const INPUT_BIN = path.join(HELPER_DIR, "sim-input");
const CAPTURE_SRC = path.join(HELPER_DIR, "sim-capture.swift");
const CAPTURE_BIN = path.join(HELPER_DIR, "sim-capture");

const UDID_RE = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;
const BUTTON_NAMES = new Set(["home", "lock", "side", "siri", "applepay"]);
let inputProc = null;

const tools = [
  {
    name: "ios_simulator_preflight",
    description: "检查当前 macOS/Xcode 环境是否满足 iOS Simulator 插件运行条件。",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    name: "ios_simulator_list_devices",
    description: "列出已安装的 iOS Simulator 设备，并返回可直接使用的扁平设备列表。",
    inputSchema: {
      type: "object",
      properties: {
        onlyAvailable: {
          type: "boolean",
          description: "是否只返回可用设备。默认 true。"
        },
        includeRaw: {
          type: "boolean",
          description: "是否返回 simctl 原始 JSON。默认 false。"
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "ios_simulator_boot_device",
    description: "启动指定 UDID 的模拟器设备。启动前会关闭 Simulator.app，避免自动弹出窗口。",
    inputSchema: {
      type: "object",
      required: ["udid"],
      properties: {
        udid: {
          type: "string",
          description: "目标模拟器 UDID。"
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "ios_simulator_shutdown_device",
    description: "关闭指定 UDID 的模拟器设备。",
    inputSchema: {
      type: "object",
      required: ["udid"],
      properties: {
        udid: {
          type: "string",
          description: "目标模拟器 UDID。"
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "ios_simulator_select_device",
    description: "切换到指定设备：关闭当前 booted 设备，启动目标 UDID。",
    inputSchema: {
      type: "object",
      required: ["udid"],
      properties: {
        udid: {
          type: "string",
          description: "目标模拟器 UDID。"
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "ios_simulator_screenshot",
    description: "对 booted 模拟器截图。默认保存到桌面。",
    inputSchema: {
      type: "object",
      properties: {
        filename: {
          type: "string",
          description: "截图文件名，仅允许 .png/.jpg/.jpeg。默认自动生成。"
        },
        directory: {
          type: "string",
          description: "保存目录。默认 ~/Desktop。"
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "ios_simulator_tap",
    description: "在 booted 模拟器屏幕上点击归一化坐标。x/y 范围为 0..1。",
    inputSchema: {
      type: "object",
      required: ["x", "y"],
      properties: {
        x: { type: "number", minimum: 0, maximum: 1 },
        y: { type: "number", minimum: 0, maximum: 1 },
        holdMs: {
          type: "number",
          minimum: 1,
          maximum: 5000,
          description: "按住时长，默认 80ms。"
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "ios_simulator_swipe",
    description: "在 booted 模拟器屏幕上滑动，坐标均为 0..1 的归一化值。",
    inputSchema: {
      type: "object",
      required: ["fromX", "fromY", "toX", "toY"],
      properties: {
        fromX: { type: "number", minimum: 0, maximum: 1 },
        fromY: { type: "number", minimum: 0, maximum: 1 },
        toX: { type: "number", minimum: 0, maximum: 1 },
        toY: { type: "number", minimum: 0, maximum: 1 },
        durationMs: {
          type: "number",
          minimum: 50,
          maximum: 5000,
          description: "滑动持续时间，默认 350ms。"
        },
        steps: {
          type: "integer",
          minimum: 2,
          maximum: 60,
          description: "中间移动步数，默认 12。"
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "ios_simulator_button_tap",
    description: "发送模拟器硬件按钮点击事件。支持 home、lock、side、siri、applepay。",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          enum: Array.from(BUTTON_NAMES),
          description: "按钮名，默认 home。"
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "ios_simulator_type_text",
    description: "通过 simctl keyboard 向 booted 模拟器输入文本。",
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        text: {
          type: "string",
          minLength: 1,
          maxLength: 2048
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "ios_simulator_open_url",
    description: "在 booted 模拟器中打开 URL。",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: {
          type: "string",
          description: "http(s) URL 或 app scheme。"
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "ios_simulator_install_app",
    description: "安装 .app 到 booted 模拟器。",
    inputSchema: {
      type: "object",
      required: ["appPath"],
      properties: {
        appPath: {
          type: "string",
          description: ".app 路径。"
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "ios_simulator_launch_app",
    description: "在 booted 模拟器中启动指定 bundle identifier。",
    inputSchema: {
      type: "object",
      required: ["bundleId"],
      properties: {
        bundleId: {
          type: "string",
          description: "例如 com.example.MyApp。"
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "可选启动参数。"
        }
      },
      additionalProperties: false
    }
  },
  {
    name: "ios_simulator_compile_helpers",
    description: "编译本插件附带的私有 API 输入/抓帧 helper。实时镜像已不暴露，但保留抓帧 helper 供后续扩展。",
    inputSchema: {
      type: "object",
      properties: {
        includeCapture: {
          type: "boolean",
          description: "是否同时编译 sim-capture.swift。默认 false。"
        }
      },
      additionalProperties: false
    }
  }
];

function run(cmd, args, options = {}) {
  return new Promise((resolve) => {
    const proc = childProcess.spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options
    });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (b) => {
      stdout += b.toString("utf8");
    });
    proc.stderr?.on("data", (b) => {
      stderr += b.toString("utf8");
    });
    proc.on("error", (error) => {
      resolve({ ok: false, code: null, stdout, stderr, error: String(error) });
    });
    proc.on("exit", (code, signal) => {
      resolve({ ok: code === 0, code, signal, stdout, stderr });
    });
  });
}

function runSync(cmd, args, options = {}) {
  const result = childProcess.spawnSync(cmd, args, { encoding: "utf8", ...options });
  return {
    ok: result.status === 0,
    code: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error ? String(result.error) : undefined
  };
}

function firstLine(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
}

function assertDarwin() {
  if (process.platform !== "darwin") {
    throw new Error("iOS Simulator requires macOS. 当前平台: " + process.platform);
  }
}

function validateUdid(udid) {
  const value = String(udid || "");
  if (!UDID_RE.test(value)) {
    throw new Error("无效 UDID: " + value);
  }
  return value;
}

function numberInRange(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new Error(name + " 必须是 0..1 范围内的数字");
  }
  return n;
}

function safeFilename(filename) {
  const fallback = "ios-simulator-" + new Date().toISOString().replace(/[:.]/g, "-") + ".png";
  const name = String(filename || fallback)
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(0, 128);
  if (!/\.(png|jpg|jpeg)$/i.test(name)) {
    throw new Error("filename 必须以 .png/.jpg/.jpeg 结尾");
  }
  return name;
}

function resolveOutputDirectory(directory) {
  if (!directory) return path.join(os.homedir(), "Desktop");
  const resolved = path.resolve(String(directory).replace(/^~(?=$|\/)/, os.homedir()));
  const stat = fs.existsSync(resolved) ? fs.statSync(resolved) : null;
  if (!stat?.isDirectory()) {
    throw new Error("截图目录不存在或不是目录: " + resolved);
  }
  return resolved;
}

function developerDir() {
  const result = runSync("/usr/bin/xcode-select", ["-p"]);
  return (result.stdout || "").trim();
}

async function preflight() {
  if (process.platform !== "darwin") {
    return {
      ok: false,
      reason: "platform",
      message: "iOS Simulator requires macOS.",
      hint: null,
      detail: "platform=" + process.platform
    };
  }

  const xcrunFind = runSync("/usr/bin/xcrun", ["-find", "simctl"]);
  if (!xcrunFind.ok) {
    return {
      ok: false,
      reason: "xcrun",
      message: "Xcode developer tools are not configured on this Mac.",
      hint: "Install Xcode, then run: sudo xcode-select -s /Applications/Xcode.app",
      detail: firstLine(xcrunFind.stderr || xcrunFind.error)
    };
  }

  const devDir = developerDir();
  if (!devDir) {
    return {
      ok: false,
      reason: "xcode-select",
      message: "Cannot determine the Xcode developer directory.",
      hint: "Run: sudo xcode-select -s /Applications/Xcode.app",
      detail: ""
    };
  }

  if (!/Xcode.*\.app/i.test(devDir)) {
    return {
      ok: false,
      reason: "clt-only",
      message: "Command-Line Tools are active, but the iOS Simulator needs the full Xcode.",
      hint: "Install Xcode, then run: sudo xcode-select -s /Applications/Xcode.app",
      detail: "DEVELOPER_DIR=" + devDir
    };
  }

  const simKit = path.join(devDir, "Library/PrivateFrameworks/SimulatorKit.framework");
  if (!fs.existsSync(simKit)) {
    return {
      ok: false,
      reason: "simkit",
      message: "SimulatorKit framework was not found in this Xcode install.",
      hint: "Open Xcode once so it finishes installing components, then try again.",
      detail: simKit
    };
  }

  const devices = await listDevices({ onlyAvailable: true });
  return {
    ok: true,
    developerDir: devDir,
    simctl: firstLine(xcrunFind.stdout),
    availableDeviceCount: devices.devices.length,
    bootedDeviceCount: devices.devices.filter((device) => device.state === "Booted").length
  };
}

async function listDevices(args = {}) {
  assertDarwin();
  const result = await run("/usr/bin/xcrun", ["simctl", "list", "devices", "--json"]);
  if (!result.ok) {
    throw new Error("simctl list devices failed: " + firstLine(result.stderr || result.error));
  }
  const data = JSON.parse(result.stdout);
  const onlyAvailable = args.onlyAvailable !== false;
  const devices = [];
  for (const [runtime, runtimeDevices] of Object.entries(data.devices || {})) {
    for (const device of runtimeDevices || []) {
      if (onlyAvailable && device.isAvailable === false) continue;
      devices.push({
        name: device.name,
        udid: device.udid,
        state: device.state,
        isAvailable: device.isAvailable !== false,
        runtime
      });
    }
  }
  devices.sort((a, b) => {
    if (a.state === "Booted" && b.state !== "Booted") return -1;
    if (a.state !== "Booted" && b.state === "Booted") return 1;
    return (a.runtime + a.name).localeCompare(b.runtime + b.name);
  });
  const payload = { devices };
  if (args.includeRaw === true) payload.raw = data;
  return payload;
}

async function killSimulatorApp() {
  await run("/usr/bin/killall", ["-q", "Simulator"]);
}

async function simctl(args) {
  assertDarwin();
  const result = await run("/usr/bin/xcrun", ["simctl", ...args]);
  if (!result.ok) {
    throw new Error("simctl " + args.join(" ") + " failed: " + firstLine(result.stderr || result.error));
  }
  return result;
}

async function bootDevice(args) {
  const udid = validateUdid(args.udid);
  await killSimulatorApp();
  const result = await simctl(["boot", udid]);
  return { ok: true, udid, stdout: result.stdout, stderr: result.stderr };
}

async function shutdownDevice(args) {
  const udid = validateUdid(args.udid);
  const result = await simctl(["shutdown", udid]);
  stopInput();
  return { ok: true, udid, stdout: result.stdout, stderr: result.stderr };
}

async function selectDevice(args) {
  const udid = validateUdid(args.udid);
  const devices = await listDevices({ onlyAvailable: true });
  const shutdownResults = [];
  for (const device of devices.devices) {
    if (device.state !== "Booted" || device.udid === udid) continue;
    const result = await run("/usr/bin/xcrun", ["simctl", "shutdown", device.udid]);
    shutdownResults.push({
      udid: device.udid,
      name: device.name,
      ok: result.ok,
      stderr: result.stderr
    });
  }
  const boot = await bootDevice({ udid });
  return { ok: true, udid, shutdownResults, boot };
}

async function screenshot(args = {}) {
  assertDarwin();
  const dir = resolveOutputDirectory(args.directory);
  const filename = safeFilename(args.filename);
  const dest = path.join(dir, filename);
  const result = await simctl(["io", "booted", "screenshot", dest]);
  return { ok: true, path: dest, stdout: result.stdout, stderr: result.stderr };
}

function ensureInputBinary() {
  assertDarwin();
  if (!fs.existsSync(INPUT_SRC)) {
    throw new Error("missing helper source: " + INPUT_SRC);
  }
  let needsBuild = !fs.existsSync(INPUT_BIN);
  if (!needsBuild) {
    const binStat = fs.statSync(INPUT_BIN);
    const srcStat = fs.statSync(INPUT_SRC);
    needsBuild = srcStat.mtimeMs > binStat.mtimeMs;
  }
  if (!needsBuild) return { ok: true, path: INPUT_BIN, built: false };

  const result = runSync("/usr/bin/clang", [
    "-fobjc-arc",
    "-O2",
    "-framework",
    "Foundation",
    "-framework",
    "CoreGraphics",
    INPUT_SRC,
    "-o",
    INPUT_BIN
  ]);
  if (!result.ok) {
    throw new Error("clang failed: " + firstLine(result.stderr || result.error));
  }
  return { ok: true, path: INPUT_BIN, built: true };
}

function ensureCaptureBinary() {
  assertDarwin();
  if (!fs.existsSync(CAPTURE_SRC)) {
    throw new Error("missing helper source: " + CAPTURE_SRC);
  }
  let needsBuild = !fs.existsSync(CAPTURE_BIN);
  if (!needsBuild) {
    const binStat = fs.statSync(CAPTURE_BIN);
    const srcStat = fs.statSync(CAPTURE_SRC);
    needsBuild = srcStat.mtimeMs > binStat.mtimeMs;
  }
  if (!needsBuild) return { ok: true, path: CAPTURE_BIN, built: false };

  const result = runSync("/usr/bin/swiftc", [
    "-O",
    "-framework",
    "CoreImage",
    "-framework",
    "Foundation",
    "-framework",
    "IOSurface",
    CAPTURE_SRC,
    "-o",
    CAPTURE_BIN
  ]);
  if (!result.ok) {
    throw new Error("swiftc failed: " + firstLine(result.stderr || result.error));
  }
  return { ok: true, path: CAPTURE_BIN, built: true };
}

function ensureInputProc() {
  const binary = ensureInputBinary();
  if (inputProc && !inputProc.killed) return { ok: true, path: binary.path, reused: true };

  inputProc = childProcess.spawn(binary.path, [], {
    stdio: ["pipe", "ignore", "pipe"]
  });
  inputProc.stderr.on("data", (buffer) => {
    const text = buffer.toString("utf8").trim();
    if (text) process.stderr.write("[sim-input] " + text + "\n");
  });
  inputProc.on("exit", () => {
    inputProc = null;
  });
  inputProc.on("error", (error) => {
    process.stderr.write("[sim-input] " + String(error) + "\n");
    inputProc = null;
  });
  return { ok: true, path: binary.path, reused: false };
}

function stopInput() {
  if (!inputProc) return;
  try {
    inputProc.kill("SIGTERM");
  } catch {}
  inputProc = null;
}

function writeInputEvent(event) {
  const procState = ensureInputProc();
  if (!inputProc?.stdin?.writable) {
    throw new Error("sim-input helper is not writable");
  }
  inputProc.stdin.write(JSON.stringify(event) + "\n");
  return procState;
}

async function tap(args) {
  const x = numberInRange(args.x, "x");
  const y = numberInRange(args.y, "y");
  const hold = Math.max(1, Math.min(5000, Number(args.holdMs || 80)));
  const proc = writeInputEvent({ type: "tap", x, y, hold });
  return { ok: true, event: { type: "tap", x, y, hold }, input: proc };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function swipe(args) {
  const fromX = numberInRange(args.fromX, "fromX");
  const fromY = numberInRange(args.fromY, "fromY");
  const toX = numberInRange(args.toX, "toX");
  const toY = numberInRange(args.toY, "toY");
  const durationMs = Math.max(50, Math.min(5000, Number(args.durationMs || 350)));
  const steps = Math.max(2, Math.min(60, Number.parseInt(args.steps || 12, 10)));
  const delay = durationMs / steps;

  const proc = writeInputEvent({ type: "touch", phase: "down", x: fromX, y: fromY });
  for (let i = 1; i < steps; i++) {
    await sleep(delay);
    const t = i / steps;
    writeInputEvent({
      type: "touch",
      phase: "move",
      x: fromX + (toX - fromX) * t,
      y: fromY + (toY - fromY) * t
    });
  }
  await sleep(delay);
  writeInputEvent({ type: "touch", phase: "up", x: toX, y: toY });

  return {
    ok: true,
    event: { type: "swipe", fromX, fromY, toX, toY, durationMs, steps },
    input: proc
  };
}

async function buttonTap(args = {}) {
  const name = String(args.name || "home").toLowerCase();
  if (!BUTTON_NAMES.has(name)) {
    throw new Error("不支持的按钮: " + name);
  }
  const proc = writeInputEvent({ type: "button-tap", name });
  return { ok: true, event: { type: "button-tap", name }, input: proc };
}

async function typeText(args) {
  const text = String(args.text || "");
  if (!text) throw new Error("text 不能为空");
  if (text.length > 2048) throw new Error("text 不能超过 2048 字符");
  const result = await simctl(["io", "booted", "keyboard", "type", text]);
  return { ok: true, stdout: result.stdout, stderr: result.stderr };
}

async function openUrl(args) {
  const url = String(args.url || "");
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(url)) {
    throw new Error("url 必须包含 scheme，例如 https:// 或 myapp://");
  }
  const result = await simctl(["openurl", "booted", url]);
  return { ok: true, stdout: result.stdout, stderr: result.stderr };
}

async function installApp(args) {
  const appPath = path.resolve(String(args.appPath || ""));
  if (!appPath.endsWith(".app")) throw new Error("appPath 必须指向 .app 目录");
  if (!fs.existsSync(appPath) || !fs.statSync(appPath).isDirectory()) {
    throw new Error(".app 不存在或不是目录: " + appPath);
  }
  const result = await simctl(["install", "booted", appPath]);
  return { ok: true, appPath, stdout: result.stdout, stderr: result.stderr };
}

async function launchApp(args) {
  const bundleId = String(args.bundleId || "");
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]+$/.test(bundleId)) {
    throw new Error("bundleId 格式不合法: " + bundleId);
  }
  const launchArgs = Array.isArray(args.args) ? args.args.map(String).slice(0, 64) : [];
  const result = await simctl(["launch", "booted", bundleId, ...launchArgs]);
  return { ok: true, bundleId, stdout: result.stdout, stderr: result.stderr };
}

async function compileHelpers(args = {}) {
  const input = ensureInputBinary();
  const capture = args.includeCapture ? ensureCaptureBinary() : null;
  return { ok: true, input, capture };
}

async function callTool(name, args = {}) {
  switch (name) {
    case "ios_simulator_preflight":
      return preflight();
    case "ios_simulator_list_devices":
      return listDevices(args);
    case "ios_simulator_boot_device":
      return bootDevice(args);
    case "ios_simulator_shutdown_device":
      return shutdownDevice(args);
    case "ios_simulator_select_device":
      return selectDevice(args);
    case "ios_simulator_screenshot":
      return screenshot(args);
    case "ios_simulator_tap":
      return tap(args);
    case "ios_simulator_swipe":
      return swipe(args);
    case "ios_simulator_button_tap":
      return buttonTap(args);
    case "ios_simulator_type_text":
      return typeText(args);
    case "ios_simulator_open_url":
      return openUrl(args);
    case "ios_simulator_install_app":
      return installApp(args);
    case "ios_simulator_launch_app":
      return launchApp(args);
    case "ios_simulator_compile_helpers":
      return compileHelpers(args);
    default:
      throw new Error("Unknown tool: " + name);
  }
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function textResult(value, isError = false) {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2)
      }
    ],
    isError
  };
}

async function handleRequest(request) {
  const { id, method, params } = request;
  try {
    if (method === "initialize") {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion || "2024-11-05",
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: "ios-simulator",
            version: "0.1.0"
          }
        }
      });
      return;
    }

    if (method === "notifications/initialized") {
      return;
    }

    if (method === "tools/list") {
      send({ jsonrpc: "2.0", id, result: { tools } });
      return;
    }

    if (method === "tools/call") {
      const result = await callTool(params?.name, params?.arguments || {});
      send({ jsonrpc: "2.0", id, result: textResult(result) });
      return;
    }

    send({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: "Method not found: " + method
      }
    });
  } catch (error) {
    send({
      jsonrpc: "2.0",
      id,
      result: textResult({ ok: false, error: String(error.message || error) }, true)
    });
  }
}

async function main() {
  if (process.argv.includes("--preflight")) {
    const result = await preflight();
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity
  });

  rl.on("line", (line) => {
    if (!line.trim()) return;
    let request;
    try {
      request = JSON.parse(line);
    } catch (error) {
      send({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: "Parse error: " + String(error.message || error)
        }
      });
      return;
    }
    handleRequest(request);
  });

  process.on("SIGINT", () => {
    stopInput();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    stopInput();
    process.exit(0);
  });
}

main().catch((error) => {
  stopInput();
  process.stderr.write(String(error.stack || error) + "\n");
  process.exit(1);
});
