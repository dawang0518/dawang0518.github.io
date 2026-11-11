# 不用买开发板：用 QEMU 走通嵌入式 Linux 全流程（五）在 macOS 上搭 Linux 构建环境

> 前面四篇都在 QEMU 里操作。从这一篇开始要编译内核和 Buildroot，需要一个真正的 Linux 构建环境。本篇讲为什么不能直接在 macOS 上编、用什么方案、以及一个很常见的 root 构建报错。

## 一、为什么需要在 Linux 上构建

Buildroot、Linux 内核、U-Boot 的构建流程有几个硬性前提：

```text
1. 官方支持 Linux 宿主
2. 部分源码树要求大小写敏感的文件系统
3. 大量 GNU 工具链脚本依赖 Linux 行为
```

macOS 默认的 APFS 卷**大小写不敏感**。把源码树放在 `/Users/...` 下构建，可能出现：

```text
同名但大小写不同的文件互相覆盖
构建脚本找不到预期文件
报错信息指向的位置看起来完全正常
```

这类问题非常难排查，所以正确做法是：**把构建放到 Linux 文件系统里**。

## 二、三种方案

| 方案 | 优点 | 缺点 |
|---|---|---|
| Docker/Colima 容器 | 快、可复用、接近 CI | 需要一点容器知识 |
| 在 QEMU 虚拟机里编译 | 不需要额外工具 | 慢，磁盘空间紧张 |
| 远程 Linux 服务器 | 性能好 | 依赖网络和环境 |

本系列选 Docker 容器，原因很实际：

```text
Apple Silicon 的 Mac 跑的是 arm64 Linux 容器
目标板也是 arm64
→ 同架构原生编译，不需要交叉工具链
→ 后续所有构建都能复用同一套环境
```

## 三、Colima 是什么

macOS 本身不是 Linux，Docker 引擎不能直接运行在 macOS 内核上。常见方案有两种：

```text
Docker Desktop  图形界面，功能完整
Colima          轻量命令行工具，基于 Lima 虚拟机
```

它们的工作原理相同：

```text
macOS
  → 启动一台轻量 Linux 虚拟机
  → Docker 引擎跑在虚拟机里
  → 容器共享这台虚拟机的内核
```

安装并启动 Colima：

```bash
colima start --cpu 4 --memory 8 --disk 40
```

```text
--cpu 4       4 个 CPU 核
--memory 8    8 GiB 内存
--disk 40     40 GiB 虚拟磁盘
```

给 24 GiB 内存的 Mac 留出一半以上，避免编译和运行 QEMU 同时进行时互相挤占。

如果看到：

```text
WARN disk size cannot be reduced, ignoring...
```

说明虚拟机已经存在且原磁盘更大，Colima 不缩容，属于良性提示。

### 验证

```bash
docker info --format 'Server: {{.ServerVersion}}  Arch: {{.Architecture}}  OS: {{.OSType}}  CPUs: {{.NCPU}}'
```

```text
Server: 29.5.2  Arch: aarch64  OS: linux  CPUs: 4
```

再跑一个容器确认架构：

```bash
docker run --rm --platform linux/arm64 alpine:3.24 uname -m
```

```text
aarch64
```

## 四、构建镜像

```dockerfile
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential bison flex gettext texinfo \
    libncurses-dev libssl-dev \
    bc cpio rsync file unzip zip \
    wget curl git ca-certificates \
    python3 perl patch \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
```

### 为什么用 Debian 而不是 Alpine

Buildroot 官方文档按 Debian/Ubuntu 的包名列出依赖，Debian 的 `build-essential`、`bison`、`flex`、`texinfo` 组合与它最匹配，后续内核和 U-Boot 也更省事。

### 为什么 `DEBIAN_FRONTEND=noninteractive`

`apt` 安装某些包时会弹出交互式提问。容器里没有人在键盘前，必须提前关闭，否则构建会挂住。

### 包的用途

```text
build-essential   gcc、g++、make、libc 开发头文件
bison flex        Buildroot 与部分软件包需要
libncurses-dev    make menuconfig 的菜单界面
libssl-dev        很多软件包的加密依赖
bc cpio rsync     Buildroot 构建流程依赖
python3 perl      大量构建脚本使用
```

构建：

```bash
docker build -t qemu-lab-build:bookworm scripts/docker/
```

输出里的：

```text
DEPRECATED: The legacy builder is deprecated...
```

只是建议启用 BuildKit，不影响结果。

## 五、构建目录放哪里

这是本篇最重要的工程决策。

### 不要直接挂载项目目录

```text
Buildroot 源码树
  ↓ 需要大小写敏感
macOS APFS 默认大小写不敏感
  ↓
构建失败，且报错难以理解
```

### 用 Docker 命名卷

```bash
docker volume create qemu-lab-build
docker run --rm -it -v qemu-lab-build:/build -w /build qemu-lab-build:bookworm bash
```

| 参数 | 作用 |
|---|---|
| `--rm` | 容器退出后删除（卷不删） |
| `-it` | 交互式终端 |
| `-v qemu-lab-build:/build` | 命名卷挂载到 `/build` |
| `-w /build` | 工作目录 |
| `bash` | 启动 shell |

命名卷位于 Colima 虚拟机内部的 Linux 文件系统，大小写敏感，没有 APFS 的问题。

代价：产物不便于在 Finder 里浏览。后续用 `docker cp` 把镜像复制回项目目录即可。

进入容器后提示符类似：

```text
root@<容器ID>:/build#
```

## 六、常见报错：configure 拒绝以 root 运行

构建 Buildroot 时，可能在 `host-tar` 处失败：

```text
checking whether mknod can create fifo without root privileges... configure: error:
configure: error: you should not run configure as root
(set FORCE_UNSAFE_CONFIGURE=1 in environment to bypass this check)
```

### 根因

容器默认以 root 运行。GNU tar 的 `configure` 有一条安全检查：检测到 root 身份就拒绝继续，因为：

```text
root 下的某些探测结果与普通用户不同
root 权限下的测试或安装可能意外覆盖系统文件
```

这不是 Buildroot 的问题，而是容器以 root 运行触发的上游防御机制。很多 CI 环境都会撞上。

### 两种处理方式

**快速绕过**（上游提供的官方开关）：

```bash
export FORCE_UNSAFE_CONFIGURE=1
make -j"$(nproc)"
```

**长期做法**（更规范）：

```text
在镜像里创建非 root 构建用户
以该用户运行容器，并匹配宿主 UID
```

好处是彻底避免同类问题，产物属主也正确。代价是要重建镜像并调整卷内文件属主。

学习阶段先用官方开关，把流程跑通再优化。

## 七、小结

- macOS 不适合直接做内核/Buildroot 构建，大小写不敏感是主要风险；
- Docker + Colima 提供与目标同架构的 aarch64 Linux 环境；
- 构建目录放命名卷，不放 macOS 挂载目录；
- root 容器构建会遇到上游 configure 的防御检查，官方开关是 `FORCE_UNSAFE_CONFIGURE=1`。

下一篇正式进入 Buildroot：它下载什么、构建顺序是什么、为什么第一次这么慢，以及一个补丁状态不一致的真实调试过程。
