# 不用买开发板：用 QEMU 走通嵌入式 Linux 全流程（八）用 U-Boot 引导自己构建的内核

> 前面一直用 QEMU 的 `-kernel` 直接加载内核，这在开发时很方便，但和真实产品不一样。真实设备上电后先运行的是引导程序。这一篇把整条启动链换成 U-Boot。

## 一、两种启动方式的区别

```text
开发方式（之前）：
  QEMU -kernel Image
      ↓
  内核直接启动

产品方式（本篇）：
  QEMU -bios u-boot.bin
      ↓
  U-Boot 初始化硬件、获取内核
      ↓
  booti 跳转到内核
```

U-Boot 的职责：

```text
1. 初始化内存、串口、网卡、存储
2. 从磁盘或网络加载内核与设备树
3. 传递启动参数
4. 提供命令行，用于调试与救援
```

真实开发板上，一半的启动问题都发生在 U-Boot 阶段。

## 二、编译 U-Boot

从 GitHub 拉源码（DENX 的 FTP 镜像在某些网络下不可达）：

```bash
git clone --depth 1 --branch v2026.10 https://github.com/u-boot/u-boot.git
cd u-boot
export CROSS_COMPILE=/build/output/host/bin/aarch64-buildroot-linux-gnu-
make qemu_arm64_defconfig
make -j4
```

产物：

```text
u-boot.bin    约 1.4 MB
```

`qemu_arm64_defconfig` 是 U-Boot 自带的、专门面向 QEMU `virt` 机型的配置。

### 一个构建错误

```text
tools/mkeficapsule.c:20: fatal error: gnutls/gnutls.h: No such file
```

`mkeficapsule` 用于生成 EFI 固件更新包，依赖 GnuTLS：

```bash
apt-get install -y libgnutls28-dev
```

同时把该依赖写进构建镜像的 Dockerfile，保证以后可复现。

## 三、启动脚本

```bash
QEMU_ARGS=(
    -machine virt
    -cpu cortex-a72
    -smp 2
    -m 512
    -bios output/uboot/u-boot.bin
    -drive file=output/buildroot/rootfs.ext4,format=raw,if=none,id=hd0
    -device virtio-blk-pci,drive=hd0
    -netdev user,id=net0,tftp=output/tftp,bootfile=Image
    -device virtio-net-pci,netdev=net0
    -nographic
)
```

关键点：

```text
-bios        QEMU 上电后执行 U-Boot，而不是直接加载内核
tftp=目录     QEMU 内置一个 TFTP 服务，把目录里的文件提供给虚拟机
bootfile     DHCP 时自动加载的文件名
```

内核与设备树放在 `output/tftp/`，由虚拟机自己下载。

## 四、在 U-Boot 里手动启动

U-Boot 启动后有 3 秒倒计时，按任意键停在 `=>` 提示符。

```text
setenv bootargs console=ttyAMA0 root=/dev/vda rw rootwait
dhcp
tftp 0x40400000 Image
booti 0x40400000 - ${fdtcontroladdr}
```

逐条解释：

```text
setenv bootargs    传给内核的命令行
dhcp               获取 IP，同时设置服务器地址 serverip
tftp <地址> 文件    把文件下载到内存指定地址
booti 内核地址 - 设备树地址
```

## 五、三次真实的失败

### 失败一：内核 panic，找不到根文件系统

```text
Kernel command line:                    ← 空
VFS: Cannot open root device ""
Kernel panic - not syncing: VFS: Unable to mount root fs
```

日志里 `vda` 已被正确识别，说明磁盘和驱动都正常，问题只是**没有传 `root=` 参数**。

原因：U-Boot 倒计时结束自动启动，`setenv bootargs` 根本没执行。

### 失败二：设备树导致的启动异常

```text
Internal error: synchronous external abort
pc : amba_read_periphid+0xac/0x1f0
Kernel panic - not syncing: Attempted to kill init!
```

内核在探测串口控制器的外设 ID 时触发了总线异常。

对照实验：

```text
booti ... - 0x40000000          → 异常
booti ... - ${fdtcontroladdr}   → 正常启动
```

其中 `0x40000000` 是我们用 QEMU `dumpdtb` 导出的设备树，`fdtcontroladdr` 是 U-Boot 自己持有的那份。

逐字段比对两份设备树的 `pl011` 节点，结果完全一致：

```text
reg = <0x0 0x9000000 0x0 0x1000>
interrupts = <0x0 0x1 0x4>
compatible = "arm,pl011", "arm,primecell"
```

**结论**：问题不在串口节点。U-Boot 会在启动前修改自己的控制设备树（写入 bootargs、补充内存保留信息），而单独导出的那份没有经过这些修正。

工程做法：U-Boot 引导内核时，传递 `fdtcontroladdr`，即 U-Boot 自己维护的设备树。

> 需要说明：具体是哪个字段导致异常，没有继续定位到根因。已知的是现象可复现、规避方案有效。这类问题在真实项目中也很常见——先让系统可靠启动，再在需要时深挖。

### 失败三：镜像被占用

```text
Failed to get "write" lock
Is another process using the image?
```

上一次的 QEMU 在内核 panic 后并没有退出，仍持有磁盘锁。结束进程即可。

另外，内核接管串口后终端不再响应 U-Boot 命令，退出虚拟机的方法：

```text
Control + A，松开，再按 X
```

## 六、把启动流程固化进 U-Boot

每次手敲命令不现实。U-Boot 支持在板级配置里写入默认环境，修改 `include/configs/qemu-arm.h`：

```c
#define CFG_EXTRA_ENV_SETTINGS \
    "bootargs=console=ttyAMA0 root=/dev/vda rw rootwait\0" \
    "kernel_addr=0x40400000\0" \
    "bootcmd=dhcp; tftp ${kernel_addr} Image; booti ${kernel_addr} - ${fdtcontroladdr}\0"
```

重新编译后，上电即自动执行：

```text
U-Boot 2026.10
Hit any key to stop autoboot: 0
BOOTP broadcast 1
DHCP client bound to address 10.0.2.15
Filename 'Image'
Bytes transferred = 13236736
Loading Device Tree to 0x5d229000 ... OK
Starting kernel ...
Kernel command line: console=ttyAMA0 root=/dev/vda rw rootwait
EXT4-fs (vda): mounted filesystem ... r/w
Welcome to Buildroot
buildroot login:
```

整个过程零人工输入，这就是真实嵌入式产品的启动形态。

### 一个可以优化的小细节

日志里 `Image` 会被下载两次：

```text
Load address: 0x40200000   ← dhcp 命令自动加载 bootfile
Load address: 0x40400000   ← bootcmd 里的 tftp
```

因为 QEMU 设了 `bootfile=Image`，`dhcp` 会自动下载它。在 `bootcmd` 开头加 `setenv autoload no;` 即可避免。

## 七、两种方式的对比

| 项目 | QEMU `-kernel` | U-Boot |
|---|---|---|
| 启动镜像 | `Image` | `u-boot.bin` |
| 内核来源 | QEMU 直接装入内存 | U-Boot 通过 TFTP 下载 |
| 启动参数 | QEMU `-append` | U-Boot 环境变量 |
| 设备树 | QEMU 生成 | U-Boot 传递自己的控制设备树 |
| 调试灵活性 | 固定 | 可在命令行切换内核、修改参数 |
| 接近真实产品 | 否 | 是 |

## 八、小结

```text
U-Boot = 内核之前的那一段程序
它的工作：初始化硬件、加载内核、传递参数
它的价值：可调试、可恢复、接近真实设备
```

至此，从虚拟硬件、固件、引导器、内核、根文件系统到驱动的整条链路都已亲手走通。

## 系列回顾

```text
一、环境与第一次启动        QEMU + UEFI + Live ISO
二、读懂启动日志            UEFI → GRUB → 内核 → OpenRC
三、存储与网络              /proc、tmpfs、VirtIO、DHCP
四、给虚拟机装一块硬盘      QCOW2、分区、ext4、GRUB EFI
五、搭建 Linux 构建环境     Colima、Docker、命名卷
六、Buildroot 到底做了什么  从源码到 60 MiB 根文件系统
七、从 .c 到 .ko            内核模块与字符设备驱动
八、用 U-Boot 引导内核      TFTP、booti、默认环境
附：从主板到设备树          计算机组成原理与硬件拓扑
```
