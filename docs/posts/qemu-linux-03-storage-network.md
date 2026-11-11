# 不用买开发板：用 QEMU 走通嵌入式 Linux 全流程（三）存储与网络实地验证

> 上一篇确认了 CPU、内存和内核。这一篇看存储和网络：精简系统为什么连 `lsblk` 都没有、虚拟光盘和压缩镜像分别挂在哪里、以及虚拟机如何拿到 IP 并访问外网。

## 一、先说结论：工具缺失不等于设备缺失

在 Alpine Live 系统里执行：

```bash
lsblk
```

```text
-sh: lsblk: not found
```

第一反应常是"磁盘没接上"。先别下结论，分三步查原因：

```bash
command -v lsblk || echo "lsblk 不在 PATH 中"
apk info -e util-linux && echo "util-linux 已安装" || echo "util-linux 未安装"
busybox --list | grep -x lsblk || echo "BusyBox 也没有提供 lsblk"
```

```text
lsblk 不在 PATH 中
util-linux 未安装
BusyBox 也没有提供 lsblk
```

三条证据指向同一个结论：

> 不是设备有问题，而是**查看工具没装**。

### 为什么会这样

Alpine Live 镜像为了缩小体积，大量基础命令由 BusyBox 提供。一个 `busybox` 程序能按调用名表现为 `ls`、`cat`、`mount`、`df`、`blkid`、`ip` 等几十个命令，但它不包含完整版 util-linux 的所有功能和参数。

| 名称 | 性质 | 说明 |
|---|---|---|
| `blkid` | BusyBox | 设备与文件系统 UUID 查询 |
| `df` | BusyBox | 文件系统容量 |
| `fdisk` | BusyBox | 分区 |
| `lsblk` | util-linux | 以树形展示块设备，默认未安装 |

## 二、绕过工具，直接问内核

`/proc` 是内核提供的虚拟文件系统，不需要任何额外工具：

```bash
cat /proc/partitions
```

```text
major minor  #blocks  name
   1        0       4096 ram0
   ...
   1       15       4096 ram15
   7        0     262192 loop0
  11        0     385396 sr0
```

### 表头

| 字段 | 含义 |
|---|---|
| `major` | 主设备号，标识驱动类型 |
| `minor` | 次设备号，区分同一驱动下的不同设备 |
| `#blocks` | 容量，此处每 block 为 1 KiB |
| `name` | 设备名，对应 `/dev/<name>` |

### 三类设备

```text
ram0 ~ ram15   内核提供的 RAM block device，每个标示 4 MiB
loop0          回环块设备，把普通文件映射成块设备
sr0            SCSI CD-ROM
```

重点关注 `sr0`：

```text
11  0  385396  sr0
```

```text
385396 KiB ÷ 1024 ≈ 376.4 MiB
```

这和下载的 Alpine ISO 大小一致，说明这条链完全打通：

```text
Mac 上的 ISO 文件
  → QEMU 的 -drive 后端
  → QEMU 虚拟 SCSI 光驱
  → Linux SCSI/光驱驱动
  → /dev/sr0
```

## 三、挂载点与文件系统

```bash
mount | grep -E 'sr0|loop0|modloop'
```

```text
/dev/sr0 on /media/cdrom type iso9660 (ro,...)
/dev/loop0 on /.modloop type squashfs (ro,...)
```

### ISO9660

- 标准光盘文件系统；
- 只读（`ro`）；
- 逻辑块 `2048` 字节。

### SquashFS 与 loop 设备

```text
ISO 光盘中的压缩文件
  ↓ 由 loop 驱动映射
/dev/loop0
  ↓ 挂载
/.modloop
```

SquashFS 是**压缩、只读**的文件系统，Alpine 用它存放与当前内核配套的模块，从而显著减小 ISO 体积。

两个镜像都显示 `100%` 使用是正常的：只读镜像大小固定，本来就没有可写空间。

## 四、根文件系统在内存里

```bash
df -h / /media/cdrom /.modloop
```

```text
Filesystem      Size    Used  Available  Use%  Mounted on
tmpfs          480.3M   14.8M   465.6M    3%  /
/dev/sr0       376.4M  376.4M        0  100%  /media/cdrom
/dev/loop0     256.1M  256.1M        0  100%  /.modloop
```

根目录 `/` 是 `tmpfs`：以内存为后端的临时文件系统。

```text
QEMU 提供的虚拟 RAM
  → Linux tmpfs
  → 当前根文件系统
```

480.3 MiB 的容量上限，正好约为总内存 960.7 MiB 的一半，与 tmpfs 默认策略一致。

### 直接验证"临时"

```bash
printf 'temporary file inside Alpine RAM\n' > /root/persistence-test.txt
cat /root/persistence-test.txt
```

内容正常。然后正常关机：

```bash
poweroff
```

再次启动、再次登录后：

```bash
if [ -e /root/persistence-test.txt ]; then
    echo "文件仍然存在"
else
    echo "文件已随虚拟机内存消失"
fi
```

```text
文件已随虚拟机内存消失
```

结论：Live 系统可以修改，但**不跨重启保留**。想要持久化，必须给它一块可写磁盘——这是下一篇的内容。

## 五、虚拟网卡与网络

启动脚本里添加了：

```bash
-netdev user,id=net0
-device virtio-net-pci,netdev=net0
```

### 先看接口

```bash
ip addr show
```

```text
1: lo: <LOOPBACK> ... state DOWN
2: eth0: <BROADCAST,MULTICAST> ... state DOWN
    link/ether 52:54:00:12:34:56
```

能出现 `eth0`，说明驱动这一层是通的：

```text
QEMU virtio-net-pci
  → Linux virtio-net 驱动
  → eth0
```

`state DOWN` 且没有 `inet` 行，说明接口尚未启用、也没拿到地址。

`52:54:00:12:34:56` 是 QEMU 虚拟网卡的常见默认 MAC 前缀。

### 启用并获取 DHCP

```bash
ip link set lo up
ip link set eth0 up
udhcpc -i eth0
```

```text
udhcpc: broadcasting discover
udhcpc: broadcasting select for 10.0.2.15, server 10.0.2.2
udhcpc: lease of 10.0.2.15 obtained from 10.0.2.2, lease time 86400
```

QEMU 的 user 网络后端内置了 DHCP 服务：

```text
虚拟机地址：10.0.2.15
虚拟网关：  10.0.2.2
虚拟 DNS：  10.0.2.3
```

### 路由

```bash
ip route show
```

```text
default via 10.0.2.2 dev eth0
10.0.2.0/24 dev eth0 scope link src 10.0.2.15
```

所有非本地子网流量交给 `10.0.2.2`，QEMU 再做 NAT，借用 Mac 的网络出网。

这带来两个特点：

```text
虚拟机 → 外网：可以
外网 → 虚拟机：默认不行
```

### DNS 与 HTTPS

```bash
cat /etc/resolv.conf
nslookup dl-cdn.alpinelinux.org
wget -O /dev/null https://dl-cdn.alpinelinux.org/alpine/
```

```text
nameserver 10.0.2.3
Name: dl-cdn.alpinelinux.org
'/dev/null' saved
```

`wget` 成功说明整条链路都通了：

```text
VirtIO 网卡 → DHCP → 路由 → QEMU NAT → DNS → TCP → TLS → HTTP
```

### 关于 `198.18.x.x`

如果 `nslookup` 返回类似 `198.18.0.131` 的地址，不必惊讶。`198.18.0.0/15` 是保留的测试网段，也常被本机代理软件用作 fake-IP。QEMU 把 DNS 请求转发给宿主机解析环境，所以拿到的可能是代理合成的地址。

判断标准仍然是：**HTTPS 请求是否成功**。

## 六、小结

- 精简系统中"命令不存在"和"设备不存在"是两回事，先分清；
- `/proc` 是绕过工具直接观察内核的入口；
- 只读镜像显示 100% 属正常；
- tmpfs 可以读写，但重启即失，需要可写磁盘才能持久化；
- QEMU user 网络默认 NAT，虚拟机可出网，外部不能主动连入。

下一篇给虚拟机接一块真正的可写硬盘：创建 QCOW2、安装系统、验证持久化，并处理 ARM64 UEFI 下"改启动顺序不生效"的坑。
