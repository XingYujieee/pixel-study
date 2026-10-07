#!/bin/bash
# 像素书房 · 一键构建（macOS）
# 双击运行：检查并安装所需工具，构建应用，把「像素书房.app」放到本文件夹。
# 日志写入同目录 build.log。
cd "$(dirname "$0")"
DIR="$(pwd)"
LOG="$DIR/build.log"
exec > >(tee "$LOG") 2>&1
echo "== 像素书房构建开始 $(date) =="
echo "目录：$DIR"
set -e

# 1. Xcode 命令行工具（编译器与链接器）
if ! xcode-select -p >/dev/null 2>&1; then
  echo "!! 缺少 Xcode 命令行工具，正在弹出安装窗口。安装完成后请再次双击本脚本。"
  xcode-select --install || true
  echo "STATUS: NEED_XCODE_CLT"
  read -n 1 -s -r -p "按任意键关闭"; exit 1
fi
echo "OK Xcode 命令行工具：$(xcode-select -p)"

# 2. Rust
export PATH="$HOME/.cargo/bin:$PATH"
if ! command -v cargo >/dev/null 2>&1; then
  echo "-- 安装 Rust（官方 rustup，装到 ~/.cargo）"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --no-modify-path
  export PATH="$HOME/.cargo/bin:$PATH"
fi
echo "OK $(cargo --version)"

# 3. Node.js（没有或版本过低时下载官方二进制到本项目 .tools 目录，不影响系统）
NODE_OK=0
if command -v node >/dev/null 2>&1; then
  MAJOR=$(node -p 'process.versions.node.split(".")[0]')
  [ "$MAJOR" -ge 20 ] && NODE_OK=1
fi
if [ $NODE_OK -eq 0 ]; then
  NV=v22.22.0
  ARCH=$(uname -m); [ "$ARCH" = "x86_64" ] && ARCH=x64
  echo "-- 下载 Node.js $NV ($ARCH) 到 .tools"
  mkdir -p .tools
  curl -fsSL "https://nodejs.org/dist/$NV/node-$NV-darwin-$ARCH.tar.gz" -o .tools/node.tgz
  tar -xzf .tools/node.tgz -C .tools
  export PATH="$DIR/.tools/node-$NV-darwin-$ARCH/bin:$PATH"
fi
echo "OK node $(node --version)"

# 4. pnpm（通过 npx 使用固定版本，不全局安装）
PNPM="npx --yes pnpm@10"
echo "OK pnpm $($PNPM --version)"

# 5. 依赖与构建
echo "-- 安装前端依赖"
$PNPM install --frozen-lockfile
echo "-- 构建应用（首次编译 Rust 约 3–8 分钟）"
$PNPM tauri build --bundles app

APP="src-tauri/target/release/bundle/macos/像素书房.app"
if [ -d "$APP" ]; then
  rm -rf "$DIR/像素书房.app"
  cp -R "$APP" "$DIR/像素书房.app"
  echo "STATUS: DONE"
  echo "完成：$DIR/像素书房.app"
  open "$DIR/像素书房.app"
else
  echo "STATUS: FAILED（没有找到构建产物）"
fi
read -n 1 -s -r -p "按任意键关闭"
