# 不用买开发板：用 QEMU 走通嵌入式 Linux 全流程（四）给虚拟机装一块硬盘

> 上一篇证明了 Live 系统关机即失忆。这一篇创建 QCOW2 虚拟磁盘、把 Alpine 安装进去、从硬盘启动，并解决 ARM64 UEFI 下启动顺序不生效的问题。

## 一、QCOW2 是什么

QCOW2 是 QEMU 的写时复制磁盘格式。最重要的特性是**稀疏、按需分配**：

```text
虚拟容量：4 GiB
初始占用：几百 KiB
写入多少，宿主文件才长到多少
```

它不是"先创建一个 4 GiB 大文件"，而是随着客体系统写入数据逐步增长。

## 二、创建脚本

```bash
#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="${HOME}/qemu-linux-lab"
DISK_IMAGE="${PROJECT_DIR}/output/alpine-system.qcow2"
DISK_SIZE="4G"

QEMU_IMG="$(command -v qemu-img)"

if [[ -e "${DISK_IMAGE}" ]]; then
    echo "错误：虚拟磁盘已经存在：${DISK_IMAGE}" >&2
    echo "为防止数据丢失，脚本不会覆盖已有磁盘。" >&2
    exit 1
fi

mkdir -p "$(dirname "${DISK_IMAGE}")"

"${QEMU_IMG}" create \
    -f qcow2 \
    "${DISK_IMAGE}" \
    "${DISK_SIZE}"

"${QEMU_IMG}" info "${DISK_IMAGE}"
```

### 三个设计点

**1. 默认保护数据**

磁盘已存在就报错退出。以后里面可能有系统、配置和数据，脚本不能"顺手覆盖"。

这里用 `-e` 而不是 `-f`：任何同名路径都视为冲突。

**2. 显式指定 `-f qcow2`**

避免 QEMU 猜测格式，也避免格式探测带来的安全风险。

**3. 创建后立即验证**

`qemu-img info` 给出格式、虚拟容量、实际占用和健康状态：

```text
file format: qcow2
virtual size: 4 GiB (4294967296 bytes)
disk size: 196 KiB
cluster_size: 65536
corrupt: false
```

### 验证防覆盖逻辑

```bash
./create-disk.sh; exit_code=$?; echo "退出状态：${exit_code}"
```

```text
错误：虚拟磁盘已经存在...
退出状态：1
```

再用哈希确认文件确实没被改动：

```bash
shasum -a 256 output/alpine-system.qcow2   # 运行前后一致
```

> 小坑：在 zsh 中不能写 `status=$?`，`status` 是 zsh 的只读特殊参数。用普通变量名（如 `exit_code`）即可。

## 三、把磁盘接到虚拟机

在启动脚本中增加：

```bash
DISK_IMAGE="${PROJECT_DIR}/output/alpine-system.qcow2"
```

以及 QEMU 参数：

```bash
-drive file="${DISK_IMAGE}",format=qcow2,if=none,id=disk0 \
-device virtio-blk-pci,drive=disk0 \
```

### 存储分两层

```text
-drive     定义存储后端，指向宿主机文件
-device    创建客体可见的硬件设备，连接该后端
```

这不是重复配置，而是把"数据在哪里"和"以什么硬件形态出现"分开。

启动后在系统内确认：

```bash
cat /proc/partitions
```

```text
253        0    4194304 vda
 11        0     385396 sr0
```

```text
4194304 KiB = 4 GiB ✓
```

主设备号 `253` 由内核动态分配，不同内核可能不同，不应在脚本里写死。

此时没有 `vda1`、`vda2`，因为磁盘还是空的。

## 四、安装系统

运行 Alpine 的安装程序：

```bash
setup-alpine
```

会依次询问主机名、网卡、IP、时区、NTP、用户、SSH 等。

### 一个容易踩的默认值

```text
Which disk(s) would you like to use? (or '?' for help or 'none') [none]
```

方括号里是默认值 `none`。直接回车表示**不安装到任何磁盘**，安装程序会跳过分区和格式化，只在内存里装几个包就结束。

这不是失败，只是少走了一步。可以单独补：

```bash
setup-disk -m sys -s 0 /dev/vda
```

| 参数 | 含义 |
|---|---|
| `-m sys` | 标准模式，根文件系统位于磁盘 |
| `-s 0` | 不创建 swap 分区 |
| `/dev/vda` | 目标磁盘 |

### 破坏性操作需要主动确认

```text
WARNING: The following disk(s) will be erased:
  vda    (4.3 GB 0x1af4 )
WARNING: Erase the above disk(s) and continue? (y/n) [n]
```

默认是 `n`，必须主动输入 `y`。这个设计避免误操作。

### 安装做了什么

```text
Creating file systems...
mkfs.fat 4.2
Installing system on /dev/vda2:
Installing for arm64-efi platform.
* creating /boot/initramfs-lts
* Generating grub configuration file ...
Installation is complete. Please reboot.
```

- `vda1`：FAT 格式的 EFI 系统分区
- `vda2`：根文件系统
- GRUB 以 **arm64-efi** 方式安装
- 生成了内核与 initramfs

新的启动链：

```text
edk2 UEFI
  → EFI 分区中的 GRUB
  → /boot/vmlinuz + initramfs
  → /dev/vda2 根文件系统
```

安装过程中还从软件源拉取了更新版本的内核（Live 是 6.18.58，装好的系统是 6.18.62），说明安装时的软件包来自网络仓库。

## 五、一个 ARM64 UEFI 特有的坑

第一次尝试"从硬盘启动"时，只把：

```bash
-boot order=d
```

改成：

```bash
-boot order=c
```

结果仍然从光驱启动：

```text
BdsDxe: starting Boot0001 "UEFI QEMU QEMU CD-ROM"
OpenRC ... Linux 6.18.58-0-lts      ← 还是 Live 的内核
* Mounting modloop ...
```

判断依据很直接：

```text
内核版本不对（6.18.58 而不是 6.18.62）
看到了 Live 特有的 modloop
登录 root 不需要密码
```

### 根因

使用 `-bios edk2-aarch64-code.fd` 时，没有提供可持久化的 EFI 变量存储。UEFI 每次开机重新枚举设备，按自己的默认策略选择启动项，光驱中的 EFI 程序被识别为 `Boot0001` 并优先执行。

`-boot order=` 对这套 ARM64 UEFI 固件的影响力有限。x86 上"改 BIOS 启动顺序"的经验，在这里不成立。

### 可靠做法：安装完成后移除安装介质

把脚本改成两种模式：

```bash
BOOT_MODE="${1:-disk}"
```

- 无参数：只挂硬盘，日常使用
- `install`：额外挂光盘，用于安装或救援

用数组组织参数：

```bash
QEMU_ARGS=(
    -name "alpine-arm64-lab"
    -machine virt
    -cpu cortex-a72
    -smp 2
    -m 1024
    -bios "${UEFI_FIRMWARE}"
    -drive file="${DISK_IMAGE}",format=qcow2,if=none,id=disk0
    -device virtio-blk-pci,drive=disk0
    -netdev user,id=net0
    -device virtio-net-pci,netdev=net0
    -nographic
)

if [[ "${BOOT_MODE}" == "install" ]]; then
    QEMU_ARGS+=(
        -device virtio-scsi-pci,id=scsi0
        -drive file="${ALPINE_ISO}",format=raw,if=none,media=cdrom,readonly=on,id=cdrom
        -device scsi-cd,drive=cdrom,bus=scsi0.0
        -boot order=d
    )
fi

exec "${QEMU_BIN}" "${QEMU_ARGS[@]}"
```

### 为什么用数组

```text
QEMU_ARGS=(...)     定义基础参数
QEMU_ARGS+=(...)    按条件追加
"${QEMU_ARGS[@]}"   展开，每个参数保持独立，不被空格拆开
```

比维护两套完整命令更容易维护，也不会漏参数。

## 六、从硬盘启动成功

```text
BdsDxe: loading Boot0001 "UEFI Misc Device"
```

`UEFI Misc Device` 就是 VirtIO 硬盘。GRUB 菜单变成：

```text
*Alpine Linux v3.24, with Linux lts
 UEFI Firmware Settings
```

系统启动日志里出现：

```text
/dev/vda2: clean, 7328/245280 files
fsck.fat 4.2
/dev/vda1: 5 files, 84/67447 clusters
```

系统在挂载前对两个分区都做了文件系统检查。

登录：

```text
localhost login: root
Password:
```

这次要求密码——已安装系统的标志。

进入系统确认分区：

```bash
cat /proc/partitions
mount | grep vda
df -h /
```

```text
253        1     270336 vda1
253        2    3921920 vda2

/dev/vda2 on /         type ext4 (rw,relatime)
/dev/vda1 on /boot/efi type vfat (rw,relatime,...)

Filesystem  Size  Used Available Use% Mounted on
/dev/vda2   3.6G 268.2M      3.1G   8% /
```

## 七、持久化验证

```bash
printf 'this file lives on vda2\n' > /root/persistent-test.txt
df -h /root/persistent-test.txt
```

```text
/dev/vda2  3.6G  268.2M  3.1G  8%  /
```

注意：**仅仅 `cat` 出来不能证明持久化**，必须同时确认文件位于 `/dev/vda2` 而不是 tmpfs。

关机、重启、再检查：

```text
文件仍然存在
this file lives on vda2
```

### 两次实验的对比

| 项目 | Live ISO | 硬盘系统 |
|---|---|---|
| 根文件系统 | tmpfs | `/dev/vda2` ext4 |
| 关机后数据 | 消失 | 保留 |
| 重启后文件 | 不存在 | 内容完整 |

## 八、小结

- QCOW2 稀疏分配：虚拟容量与宿主占用是两回事；
- `-drive` 定义数据位置，`-device` 定义硬件形态；
- ARM64 UEFI 下不要指望 `-boot order` 解决启动介质选择，安装完成后移除光盘更可靠；
- 持久化的判据是"文件所在文件系统"，不是"文件能读出来"。

下一篇离开 macOS，用 Docker 搭一套可复用的 Linux 构建环境，为编译内核和 Buildroot 做准备。
