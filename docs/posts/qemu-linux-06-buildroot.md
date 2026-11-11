# 不用买开发板：用 QEMU 走通嵌入式 Linux 全流程（六）Buildroot 到底做了什么

> 最后一篇进入构建系统本身：一条命令背后发生了什么、为什么第一次要几十分钟、一次真实的补丁状态错误如何定位。

## 一、工具链和 Buildroot 不是一回事

```text
工具链     = 锤子、电钻、水平仪
Buildroot  = 总包公司：采购、施工、交付
```

### 工具链负责什么

把源代码编译成目标机器能运行的机器码：

| 组件 | 作用 |
|---|---|
| `gcc` / `g++` | C / C++ 编译器 |
| `binutils`（`as`、`ld`、`objcopy`） | 汇编、链接、二进制处理 |
| C 库（glibc / musl） | `printf`、`open` 等底层实现 |
| 内核头文件 | 系统调用接口定义 |

### Buildroot 负责什么

```text
下载源码
管理依赖顺序
构建目标工具链
构建内核（可选）
构建 U-Boot（可选）
构建 BusyBox 与各类软件包
组装根文件系统并打包镜像
```

它把这些整理成：

```bash
make qemu_aarch64_virt_defconfig
make
```

## 二、选版本

```bash
curl -s https://buildroot.org/downloads/ \
  | grep -oE "buildroot-[0-9]{4}\.[0-9]+(\.[0-9]+)?\.tar\.xz" \
  | sort -u | tail -15
```

命名规律：

```text
YYYY.02   长期支持（LTS）
YYYY.05 / .08 / .11   常规发布
```

学习场景选最新 LTS 补丁版本，例如 `buildroot-2026.02.3`：维护周期长、补丁稳定、网上资料更多。

## 三、默认配置

```bash
cd buildroot-2026.02.3
make qemu_aarch64_virt_defconfig
```

```text
#
# configuration written to .config
#
```

Buildroot 的 `configs/` 目录为常见板子提供了预设，例如：

```text
qemu_aarch64_virt_defconfig       ARM64 virt 参考板（本系列）
qemu_aarch64_ebbr_defconfig       ARM64 EBBR UEFI 规范板
qemu_riscv64_virt_defconfig       RISC-V 64 virt
```

### 看关键配置

```bash
grep -E 'BR2_(aarch64|cortex|LINUX_KERNEL=|TARGET_ROOTFS_EXT2|TOOLCHAIN_BUILDROOT)' .config
```

```text
BR2_aarch64=y                       ARM64
BR2_cortex_a53=y                    目标 CPU 微架构
BR2_TOOLCHAIN_BUILDROOT=y           Buildroot 自建工具链
BR2_TOOLCHAIN_BUILDROOT_GLIBC=y     C 库用 glibc
BR2_LINUX_KERNEL=y                  构建内核
BR2_TARGET_ROOTFS_EXT2_4=y          ext4 镜像
BR2_TARGET_ROOTFS_EXT2_SIZE="60M"   镜像大小
BR2_TARGET_ROOTFS_EXT2_NONE=y       不压缩
```

两个值得注意的点：

**1. A53 编译，A72 运行**

```text
cortex-a72 指令集 ⊇ cortex-a53 指令集
```

按 A53 生成的代码可以在 A72（QEMU 设定的 CPU）上运行，反过来不一定。默认选 A53 兼顾兼容性。

**2. 默认没有 C++**

```text
# BR2_TOOLCHAIN_BUILDROOT_CXX is not set
```

这个 rootfs 只能编译 C 程序。做 C++ 应用时需要打开 `BR2_TOOLCHAIN_BUILDROOT_CXX`，并重新构建工具链。

## 四、它会下载什么

按类别：

```text
工具链组件      binutils、gcc、linux-headers、glibc
内核            linux
用户空间        busybox
宿主机工具      host-tar、host-sed、host-bison、host-pkgconf、host-libtool...
镜像工具        genimage
```

下载位置：

```text
dl/             源码包缓存，只下载一次
output/build/   解压后的源码与编译目录
output/host/    宿主机工具
output/target/  目标根文件系统骨架
output/images/  最终镜像
```

完整性由每个包的 `.hash` 文件保证：

```text
下载 → 计算 SHA256 → 与 package/<名字>/<名字>.hash 比对
不匹配 → ERROR: ... has wrong sha256 hash
```

## 五、为什么第一次这么慢

### 阶段一：宿主机工具

容器里已有 gcc、make、tar，Buildroot 仍然自己编一套：

```text
host-tar   host-sed   host-gawk   host-m4
host-bison host-flex  host-pkgconf host-libtool
host-libzlib host-binutils host-python3 host-genimage
```

目的是**可复现**：不依赖宿主系统的工具版本，换机器、换人结果一致。

每个包都要走：

```text
下载 → 解压 → 打补丁 → configure → make → install
```

### 阶段二：目标工具链

```text
binutils
  ↓
gcc-initial       只支持 C 的精简 gcc
  ↓
glibc 头文件
  ↓
glibc 本体
  ↓
gcc-final         用 glibc 重新编译完整 gcc
  ↓
glibc 再用新 gcc 重编
```

### 为什么要编两次 gcc

自举问题：

```text
编译 gcc 需要 C 库
编译完整 C 库需要完整 gcc
```

所以先做最小可用 gcc，用它编译 C 库，再用带 C 库的 gcc 重编自己。GCC 体量巨大，4 核上一次完整构建通常 10～30 分钟。

### 阶段三：内核与用户空间

```text
linux     数千个编译单元
busybox   所有基础命令
```

### 阶段四：打包

```text
安装 BusyBox、glibc、/etc
  ↓
生成 60 MiB ext4 镜像
  ↓
生成启动脚本
```

### 时间分布

| 阶段 | 大致耗时 |
|---|---|
| 下载源码 | 5～20 分钟 |
| 宿主机工具 | 15～30 分钟 |
| 目标工具链 | 20～40 分钟 |
| 内核 | 10～20 分钟 |
| BusyBox 与打包 | 5～10 分钟 |

首次总计约 **40～90 分钟**，属正常范围。

### 与 apt 的对比

```text
apt install foo   下载别人编译好的二进制，几秒
Buildroot         下载源码，本机编译，几分钟
```

| 维度 | 发行版软件包 | Buildroot |
|---|---|---|
| 来源 | 他人预编译 | 本机源码编译 |
| 目标架构 | 构建机架构 | 任意目标架构 |
| 可裁剪 | 难 | 精确到包与选项 |
| 可复现 | 依赖仓库状态 | 配置固定则结果固定 |
| 场景 | 桌面、服务器 | 嵌入式 |

嵌入式设备存储常只有几十 MB，装不下发行版，必须精确裁剪——这就是 Buildroot 的价值。

## 六、一次真实排错：duplicate filename

构建推进到 `host-binutils` 时报错：

```text
Error: duplicate filename '0001-sh-conf.patch'
Conflicting files are:
  already applied: .../package/binutils/2.44/0001-sh-conf.patch
  to be applied  : .../package/binutils/2.44/0001-sh-conf.patch
```

注意：两条路径**完全相同**。这不是"两个目录有同名文件"，而是同一个文件出现在补丁列表里两次。

### 第一步：排除可能性

```bash
find package/binutils -name '*.patch' | sort
```

```text
package/binutils/2.43.1/...
package/binutils/2.44/0001-sh-conf.patch
package/binutils/2.44/0002-poison-system-directories.patch
package/binutils/2.44/0003-objdump-memleak.patch
package/binutils/2.45.1/...
```

每个版本目录各自独立，没有问题。

```bash
grep -E '^BR2_GLOBAL_PATCH_DIR' .config
```

```text
BR2_GLOBAL_PATCH_DIR="board/qemu/patches"
```

```bash
find board/qemu/patches -type f | sort
```

```text
board/qemu/patches/binutils/binutils.hash
...
```

全局补丁目录里只有 `.hash` 文件，没有 `.patch`。

### 第二步：读源码

错误来自 `support/scripts/apply-patches.sh`：

```bash
existing="$(grep -E "/${patch}\$" ${builddir}/.applied_patches_list || true)"
if [ -n "${existing}" ]; then
    echo "Error: duplicate filename '${patch}'"
    echo "  already applied: ${existing}"
    echo "  to be applied  : ${path}/${patch}"
    exit 1
fi
echo "${path}/${patch}" >> ${builddir}/.applied_patches_list
```

Buildroot 用 `.applied_patches_list` 记录已应用的补丁。

### 第三步：看构建目录时间戳

```text
.stamp_patched           Nov 10 08:52   ← 昨天已经成功
.stamp_built             Nov 10 08:53
.stamp_host_installed    Nov 10 08:53
.stamp_extracted         Nov 11 00:13   ← 今天被重新解压
.applied_patches_list    Nov 11 00:13
```

### 根因

```text
1. 前一天 host-binutils 已完整构建，留下 .applied_patches_list
2. 当天因源码包重新下载，Buildroot 重新执行了解压
3. 但旧的补丁记录文件没有被清理
4. 打补丁时发现记录里已有 0001，判定为重复并退出
```

状态记录与新源码不一致，导致了误判。

### 修复

清理该包的构建状态，保留下载缓存：

```bash
rm -rf output/build/host-binutils-2.44
make host-binutils
make -j"$(nproc)"
```

### 经验

遇到补丁相关错误，先对比：

```text
output/build/<包>/.applied_patches_list
output/build/<包>/.stamp_*
```

判断是否处于"源码重新解压、补丁记录未清理"的不一致状态。这比盲目重试或改配置更快定位。

## 七、增量构建

第一次最慢，之后会快很多：

| 修改内容 | 重建范围 | 大致耗时 |
|---|---|---|
| 某个应用包 | 仅该包 | 几十秒 |
| 内核配置 | 仅内核 | 十几分钟 |
| 增加软件包 | 新增包及依赖 | 视包而定 |
| 改 CPU 架构 | 工具链重建 | 接近完整构建 |

## 八、小结

- 工具链是原料，Buildroot 是施工方；
- 默认配置产出：自建工具链 + 内核 + BusyBox + ext4 根文件系统；
- 慢的根源是"一切都从源码编译"，这是可复现性的代价；
- 排错时先读源码里的判断条件，再查构建状态文件，最后才考虑清理重来。

## 系列回顾

```text
01 环境与第一次启动        QEMU + UEFI + Live ISO
02 读懂启动日志            UEFI → GRUB → 内核 → OpenRC
03 存储与网络              /proc、tmpfs、VirtIO、DHCP
04 安装持久化系统          QCOW2、分区、ext4、GRUB EFI
05 Docker 构建环境         Colima、构建镜像、命名卷
06 Buildroot 原理与排错    从源码到 60 MiB 根文件系统
```

到这里，一条完整的链路已经跑通：**虚拟硬件 → 固件 → 引导器 → 内核 → 根文件系统 → 构建系统**。

下一步可以继续深入的方向：

- 自己配置并编译内核，理解设备树
- 编写第一个内核模块与字符设备驱动
- 用 U-Boot 替换 UEFI + GRUB
- 在目标系统上运行自己的 C/C++ 应用，访问自己的驱动
