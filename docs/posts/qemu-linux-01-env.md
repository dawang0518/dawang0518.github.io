# 不用买开发板：用 QEMU 走通嵌入式 Linux 全流程（一）环境与第一次启动

> 本系列记录如何在**不使用实体开发板**的前提下，用 QEMU 模拟一块 ARM64 开发板，从固件、内核、根文件系统一路做到自己构建系统镜像。适合有 C/C++ 或嵌入式基础、想补齐 Linux 系统层的读者。

## 一、先厘清一件事：模拟器能替代什么

很多人第一次接触虚拟开发板时会有一个误解：

```text
在 KiCad 里画好 PCB → 放进 QEMU → 就能跑 Linux
```

这两件事其实属于两条完全不同的线。

| 线路 | 回答的问题 | 工具 |
|---|---|---|
| 硬件设计线 | 板子该怎么设计 | KiCad、SPICE |
| 系统启动线 | 板子做出来以后，软件怎么跑起来 | QEMU |

KiCad 产出的是一份生产图纸（Gerber、BOM），不是一台可以启动的计算机。QEMU 则反过来，它直接提供一台"已经焊好"的虚拟机器：

| 真实开发板 | QEMU 中的等价物 |
|---|---|
| ARM64 CPU | 软件模拟的指令执行器 |
| DDR 内存 | QEMU 进程分配的一块内存 |
| UART 串口 + USB 转串口线 | 直接就是你的终端窗口 |
| eMMC / SD 卡 | 一个磁盘镜像文件 |
| 网口 PHY | 虚拟网卡 |

本系列只走系统启动线。硬件设计部分可以之后单独补，两者不必混为一谈。

## 二、安装 QEMU

以 macOS + Homebrew 为例：

```bash
brew install qemu
qemu-system-aarch64 --version
```

输出类似：

```text
QEMU emulator version 11.1.3
```

`brew install qemu` 会安装所有架构的模拟器，体积偏大，但一次到位。它装在 Homebrew 自己的目录下，不需要 `sudo`。

常用子命令有三个：

| 命令 | 用途 |
|---|---|
| `qemu-system-aarch64` | 模拟整台 ARM64 机器，本系列主力 |
| `qemu-img` | 创建、检查、转换虚拟磁盘 |
| `qemu-aarch64` | 用户态模拟，只跑单个程序，不涉及内核 |

## 三、启动一台虚拟 ARM64 机器需要什么

三样东西：

```text
QEMU 本身
+ ARM64 UEFI 固件（edk2）
+ 一个可启动的 Linux 镜像（这里用 Alpine）
```

Homebrew 安装的 QEMU 自带 edk2 固件：

```bash
ls /opt/homebrew/share/qemu/ | grep edk2
```

其中 `edk2-aarch64-code.fd` 就是 ARM64 的 UEFI 固件，作用相当于 PC 上的 BIOS：它在上电后最先运行，负责找到并启动操作系统。

### 下载 Alpine Linux 镜像

不要手写版本号，直接查询官方目录，避免地址过期：

```bash
ALPINE_DIR="https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/aarch64"

ALPINE_ISO="$(
  curl -s "$ALPINE_DIR/" \
    | grep -oE 'alpine-standard-[0-9.]+-aarch64\.iso' \
    | sort -Vu \
    | tail -1
)"

curl -fLO "$ALPINE_DIR/$ALPINE_ISO"
curl -fLO "$ALPINE_DIR/$ALPINE_ISO.sha256"
shasum -a 256 -c "$ALPINE_ISO.sha256"
```

`shasum -c` 输出 `OK` 才继续，说明下载的文件与官方校验值一致。

## 四、启动脚本

把参数写进脚本，方便反复使用：

```bash
#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="${HOME}/qemu-linux-lab"
QEMU_BIN="$(command -v qemu-system-aarch64)"
UEFI_FIRMWARE="/opt/homebrew/share/qemu/edk2-aarch64-code.fd"
ALPINE_ISO="${PROJECT_DIR}/downloads/alpine-standard-3.24.3-aarch64.iso"

exec "${QEMU_BIN}" \
    -name "alpine-arm64-lab" \
    -machine virt \
    -cpu cortex-a72 \
    -smp 2 \
    -m 1024 \
    -bios "${UEFI_FIRMWARE}" \
    -device virtio-scsi-pci,id=scsi0 \
    -drive file="${ALPINE_ISO}",format=raw,if=none,media=cdrom,readonly=on,id=cdrom \
    -device scsi-cd,drive=cdrom,bus=scsi0.0 \
    -boot order=d \
    -netdev user,id=net0 \
    -device virtio-net-pci,netdev=net0 \
    -nographic
```

### 关键参数逐项说明

| 参数 | 作用 |
|---|---|
| `-machine virt` | 选择 QEMU 的 ARM 参考开发板 |
| `-cpu cortex-a72` | 模拟的具体 CPU 型号 |
| `-smp 2` | 两个虚拟 CPU 核 |
| `-m 1024` | 1024 MiB 内存 |
| `-bios ...` | 加载 ARM64 UEFI 固件 |
| `virtio-scsi-pci` + `scsi-cd` | 把 ISO 接成虚拟光驱 |
| `-boot order=d` | 优先从光驱启动（`c` 是硬盘，`n` 是网络） |
| `virtio-net-pci` | VirtIO 虚拟网卡 |
| `-nographic` | 不弹图形窗口，串口直接接到当前终端 |

### 为什么选 `virt` 机型

`virt` 是 QEMU 专门为虚拟化设计的参考板。它没有对应实物，但具备真实板子该有的一切：CPU、内存、GIC 中断控制器、UART、VirtIO 磁盘与网卡，并且会向 Linux 提供**设备树**。

设备树是后面理解内核如何"认识"一块板子的关键入口。

## 五、第一次开机

运行脚本：

```bash
chmod +x run-alpine.sh
./run-alpine.sh
```

会看到大致这样的过程：

```text
UEFI firmware (version edk2-stable...)
BdsDxe: loading Boot0001 "UEFI QEMU QEMU CD-ROM"
BdsDxe: starting Boot0001 "UEFI QEMU QEMU CD-ROM"

                  GNU GRUB  version 2.14
*Linux lts

OpenRC 0.63.2 is starting up Linux 6.18.58-0-lts (aarch64)
...
Welcome to Alpine Linux 3.24
Kernel 6.18.58-0-lts on aarch64 (/dev/ttyAMA0)

localhost login:
```

输入 `root` 即可登录（Live 镜像默认允许无密码 root 登录）：

```text
localhost:~#
```

### 退出 QEMU

```text
先按 Control + A，松开后再按 X
```

注意是 **Control**，不是 Command。

## 六、启动过程中那些 `Error` 要不要管

第一次开机会看到一串吓人的输出：

```text
ArmTrngLib could not be correctly initialized.
Tpm2SubmitCommand - Tcg2 - Not Found
Image type X64 can't be loaded on AARCH64 UEFI system.
```

它们都不影响启动：

- **TPM 相关**：虚拟机没有配置 TPM 安全芯片，UEFI 探测失败后继续；
- **`ArmTrngLib`**：没找到硬件随机数源；
- **`X64 ... on AARCH64`**：UEFI 扫描启动介质时碰到一个 x86-64 的 EFI 镜像，ARM64 固件不能执行它，随后继续扫描并成功从光驱启动。

判断启动是否成功，不能看中间有没有 `Error`，要看**最终是否到达预期状态**：

```text
localhost login:
```

## 七、小结

到这里，你已经得到：

- 一套可复现的 ARM64 虚拟开发板
- 能完整走通 `UEFI → GRUB → Linux → OpenRC` 的启动链
- 一个可以随时重来的实验环境

下一篇会拆解 Linux 启动日志：每一段输出分别是哪一层在说话，以及如何从系统内部确认 CPU、内存与内核信息。
