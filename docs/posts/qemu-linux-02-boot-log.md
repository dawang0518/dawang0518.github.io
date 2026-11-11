# 不用买开发板：用 QEMU 走通嵌入式 Linux 全流程（二）读懂启动日志

> 上一篇把系统启动起来了。这一篇把启动日志按层次拆开，并从系统内部确认 CPU、内存和内核，建立"日志与硬件状态"的对应关系。

## 一、启动链的四层

一次 ARM64 Linux 启动，依次经过四个角色：

```text
UEFI 固件（edk2）
  │  发现可启动介质，加载引导程序
  ↓
GRUB
  │  选择并装载内核和 initramfs
  ↓
Linux 内核
  │  接管 CPU、内存、中断与设备驱动
  ↓
init（OpenRC）
     启动用户空间服务
```

真实嵌入式板子上，UEFI 这一段常常换成 U-Boot。本系列先用 QEMU 自带的 edk2，后面会替换成自己编译的引导器。

## 二、UEFI 阶段

```text
UEFI firmware (version edk2-stable202408-prebuilt)
BdsDxe: loading Boot0001 "UEFI QEMU QEMU CD-ROM"
BdsDxe: starting Boot0001 "UEFI QEMU QEMU CD-ROM"
```

- `BdsDxe` 是 UEFI 的启动管理器（Boot Device Selection）。
- `Boot0001` 是它给这次发现的启动项分配的编号。
- 从 CD-ROM 启动，是因为我们传了 `-boot order=d`。

### 那些 `Error` 的真实含义

```text
ArmTrngLib could not be correctly initialized.
```

没有可用的硬件随机数源。QEMU 没有显式添加 RNG 设备。

```text
Tpm2SubmitCommand - Tcg2 - Not Found
Tpm2GetCapabilityPcrs fail!
```

探测 TPM 2.0 安全芯片失败。TPM 不是启动 Linux 的必要条件。

```text
Image type X64 can't be loaded on AARCH64 UEFI system.
```

UEFI 扫描介质时遇到一个 x86-64 的 EFI 程序，架构不匹配，跳过继续扫描。

这些都属于**探测过程中的非致命信息**。判断标准始终是最终状态。

## 三、GRUB 阶段

```text
                  GNU GRUB  version 2.14
*Linux lts
  Booting `Linux lts'
Loading Linux lts ...
Loading initial ramdisk ...
```

GRUB 做三件事：

1. 读取自己的配置，列出可启动项；
2. 把内核镜像（`vmlinuz`）装入内存；
3. 把 initramfs 一起装入，然后跳转到内核入口。

### initramfs 是什么

```text
initramfs = 内核启动时最先加载的临时内存文件系统
```

它的职责是：在真正挂载根文件系统之前，准备好必要的驱动和工具，然后再把控制权交给磁盘上的根文件系统。

很多"系统卡在 initramfs"的问题，本质上都是根文件系统或存储驱动没就绪。

## 四、内核阶段

```text
OpenRC 0.63.2 is starting up Linux 6.18.58-0-lts (aarch64)
```

看到这一行，说明内核已经完成初始化，并把第一个用户空间进程（这里由 OpenRC 提供）跑起来了。

紧接着是一串服务启动：

```text
 * /proc is already mounted
 * Mounting /run ... [ ok ]
 * Remounting devtmpfs on /dev ... [ ok ]
 * Mounting modloop ... [ ok ]
 * Starting busybox mdev ... [ ok ]
 * Starting busybox syslog ... [ ok ]
```

每一项都对应一个真实动作：

| 日志 | 实际动作 |
|---|---|
| `/proc is already mounted` | 内核已经把 procfs 挂好 |
| `Mounting /run` | 建立运行时状态目录 |
| `devtmpfs on /dev` | 设备节点由内核自动生成 |
| `modloop` | 挂载压缩的内核模块镜像（Live 系统特有） |
| `mdev` | BusyBox 的设备管理器 |

## 五、进入系统后确认身份

登录后第一件事是确认自己到底运行在什么环境里。

### 内核与架构

```bash
uname -a
```

```text
Linux localhost 6.18.58-0-lts #1-Alpine SMP PREEMPT_DYNAMIC 2026-10-21 aarch64 Linux
```

| 字段 | 含义 |
|---|---|
| `Linux` | 内核名称，不是发行版名称 |
| `localhost` | 主机名 |
| `6.18.58-0-lts` | 内核版本 |
| `#1-Alpine` | 该内核的第 1 次 Alpine 构建 |
| `SMP` | 支持对称多处理，可用多核 |
| `PREEMPT_DYNAMIC` | 抢占模式可在启动时选择 |
| `aarch64` | 64 位 ARM 架构 |

`aarch64` 就是 ARM64。三个名字经常混用：

```text
ARM64 ≈ AArch64 ≈ arm64
```

### CPU 数量

启动参数写了 `-smp 2`，从系统内部验证：

```bash
nproc
```

```text
2
```

这条链路成立：

```text
QEMU -smp 2
  → 创建两个虚拟 CPU
  → Linux SMP 子系统启用两个核
  → nproc 返回 2
```

### 内存

启动参数写了 `-m 1024`，从系统内部看：

```bash
free -h
```

```text
              total        used        free      shared  buff/cache   available
Mem:         960.7M       45.7M      626.7M       14.8M      288.3M      835.7M
Swap:             0           0           0
```

### 为什么配置 1024 MiB，只看到 960.7 MiB

中间差掉的部分，用于：

- UEFI 固件运行区域
- 内核代码和早期启动数据
- 设备树
- 虚拟硬件映射与保留区

和真实板子一样：焊了 1 GiB DDR，`free` 也不一定正好显示 1024 MiB。

### 各列怎么读

| 列 | 含义 |
|---|---|
| `total` | 内核可管理的物理内存 |
| `used` | 进程与内核实际占用、不可立即回收 |
| `free` | 完全未使用的内存 |
| `shared` | tmpfs 等共享内存 |
| `buff/cache` | 用空闲内存缓存文件数据，可回收 |
| `available` | 估算的新程序可用内存，**最该看这一列** |

一个常见误解：`free` 少不代表内存紧张。Linux 会主动拿空闲内存做缓存，需要时自动回收，所以判断可用量看 `available`。

`Swap: 0` 表示当前没有交换分区，Live 系统没有配置。

## 六、数据流：一个命令在虚拟机里如何执行

你输入 `uname -a` 时，真实过程是：

```text
键盘
  ↓
QEMU 模拟的 PL011 UART
  ↓
虚拟机中的 /dev/ttyAMA0
  ↓
OpenRC 启动的 Shell
  ↓
uname 系统调用
  ↓
ARM64 Linux 内核返回信息
  ↓
沿虚拟串口显示在终端
```

这不是 macOS 在模拟输出结果，而是 QEMU 中真的运行着一个独立的 Linux 内核。

## 七、小结

- 启动日志是分层的：固件 → 引导器 → 内核 → init，每一层只说自己那部分的话；
- 中间的 `Error` 多半是设备探测失败，关键看最终状态；
- 启动参数（`-smp`、`-m`）都能在系统内部找到对应证据；
- `free` 的 `available` 比 `free` 更能反映真实可用内存。

下一篇进入存储与网络：为什么精简系统里连 `lsblk` 都没有、ISO 和压缩镜像分别挂在哪里、虚拟机怎么拿到 IP 地址。
