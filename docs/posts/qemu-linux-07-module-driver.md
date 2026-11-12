# 不用买开发板：用 QEMU 走通嵌入式 Linux 全流程（七）从 .c 到 .ko：内核模块与字符设备驱动

> 前面几篇都是"把现成的系统跑起来"。这一篇开始写代码：从最小的内核模块起步，做到一个能在 `/dev` 下被用户程序读写的字符设备。

## 一、内核模块解决什么问题

Linux 内核要支持成千上万种硬件。如果全部编进内核：

```text
内核体积大
启动慢
加一个驱动要重编内核并重启
```

模块把功能变成"按需装卸"的部件：

```text
内核本体：只放必需功能
其余功能：编译成 .ko，用到才加载
```

| | 编进内核 | 编译成模块 |
|---|---|---|
| 配置 | `obj-y` / `CONFIG_X=y` | `obj-m` / `CONFIG_X=m` |
| 加载时机 | 开机自动 | `insmod` / `modprobe` |
| 修改后 | 重编内核并重启 | 重编模块即可 |
| 适用 | 启动必需（根文件系统、磁盘驱动） | 大多数外设 |

## 二、.c 到 .ko 发生了什么

普通程序是：

```text
hello.c --gcc--> hello.o --链接 libc--> 可执行文件
```

内核模块是：

```text
hello.c        --gcc -c-->  hello.o
hello.mod.c    --gcc -c-->  hello.mod.o     ← kbuild 自动生成
hello.o + hello.mod.o --ld -r--> hello.ko
```

`hello.mod.c` 是构建系统生成的登记表，里面定义 `__this_module`，记录模块名和 init/exit 函数指针。

### 用工具验证

```text
$ file hello_user
ELF 64-bit LSB pie executable, ARM aarch64, dynamically linked,
interpreter /lib/ld-linux-aarch64.so.1

$ file hello.ko
ELF 64-bit LSB relocatable, ARM aarch64

$ readelf -h hello.ko | grep -E 'Type|Entry'
Type: REL (Relocatable file)
Entry point address: 0x0
```

关键差异：

```text
可执行文件：DYN，入口 0x680，依赖动态链接器
内核模块：  REL，入口 0x0，不链接任何库
```

模块是"可重定位目标文件"，由内核在加载时解析符号并填充地址，这也是它不能直接执行的原因。

用 `nm` 能看到合并结果：

```text
$ nm hello.ko | grep -E "hello_init|hello_exit|this_module"
t hello_exit
t hello_init
D __this_module
```

前两个来自你的代码，第三个来自自动生成的 wrapper。

## 三、最小的内核模块

```c
#include <linux/module.h>
#include <linux/kernel.h>
#include <linux/init.h>

MODULE_LICENSE("GPL");
MODULE_DESCRIPTION("A minimal kernel module");

static int __init hello_init(void)
{
    pr_info("hello: module loaded\n");
    return 0;
}

static void __exit hello_exit(void)
{
    pr_info("hello: module unloaded\n");
}

module_init(hello_init);
module_exit(hello_exit);
```

Makefile：

```makefile
obj-m := hello.o

KDIR ?= /build/linux-6.18.7
ARCH ?= arm64
CROSS_COMPILE ?= /build/output/host/bin/aarch64-buildroot-linux-gnu-

all:
	$(MAKE) -C $(KDIR) M=$(CURDIR) ARCH=$(ARCH) CROSS_COMPILE=$(CROSS_COMPILE) modules

clean:
	$(MAKE) -C $(KDIR) M=$(CURDIR) clean
```

两行命令必须是 **Tab** 缩进，写成空格会报：

```text
*** missing separator.  Stop.
```

交叉编译：

```bash
docker run --rm -v build-vol:/build -v $PWD:/exercises -w /exercises/hello \
  build-image make
```

加载与卸载：

```sh
insmod /tmp/hello.ko
# hello: loading out-of-tree module taints kernel.
# hello: module loaded

lsmod
# Module   Size    Used by    Tainted: G
# hello    12288   0

rmmod hello
# hello: module unloaded
```

### 两条陌生输出

**`loading out-of-tree module taints kernel`**：模块在内核源码树外编译，内核打上污染标记。这不是错误，而是提示"这个内核里有非官方构建的代码"。

**`Tainted: G`**：内核污染标志表里，

```c
TAINT_FLAG(PROPRIETARY_MODULE, 'P', 'G', true),
TAINT_FLAG(OOT_MODULE,         'O', ' ', true),
```

GPL 模块标记为 `G`，专有模块标记为 `P`。

## 四、变成字符设备驱动

模块要真正有用，要让用户程序能访问它。核心是两样东西：

```c
static const struct file_operations hello_fops = {
    .owner = THIS_MODULE,
    .read  = hello_read,
    .write = hello_write,
};

static struct miscdevice hello_misc = {
    .minor = MISC_DYNAMIC_MINOR,
    .name  = DEVICE_NAME,
    .fops  = &hello_fops,
    .mode  = 0666,
};
```

- `file_operations`：函数表，用户态 `read/write` 时内核据此分发
- `miscdevice`：简化注册，自动分配次设备号，由 devtmpfs 创建设备节点

数据读写必须用：

```c
copy_to_user(buf, kernel_buf + *ppos, count);
copy_from_user(kernel_buf, buf, count);
```

内核不能直接解引用用户空间指针——地址不可信，必须经过检查性的复制函数。

### 加载后的效果

```sh
insmod chardev.ko
# hello: registered as /dev/hello

ls -l /dev/hello
# crw-rw-rw- 1 root root 10, 259 /dev/hello
```

- `c`：字符设备
- `10`：misc 设备统一的主设备号
- `259`：动态分配的次设备号
- 节点由内核自动创建，不需要 `mknod`

```sh
cat /dev/hello
# hello from kernel

echo "hello from user space" > /dev/hello
# hello: received 22 bytes: hello from user space
```

## 五、写一个用户态程序

```c
fd = open("/dev/hello", O_RDWR);
n = read(fd, buf, sizeof(buf) - 1);
printf("read %zd bytes: %s", n, buf);

write(fd, "written by hello_app\n", 21);
close(fd);

fd = open("/dev/hello", O_RDONLY);
n = read(fd, buf, sizeof(buf) - 1);
printf("read again %zd bytes: %s", n, buf);
```

运行结果：

```text
read 22 bytes: hello from user space
wrote 21 bytes
read again 21 bytes: written by hello_app
```

第一次读到的是之前 `echo` 写入的内容，说明内核缓冲区在模块加载期间一直存在；重新打开后读到程序自己写入的内容，说明 `hello_write` 更新了内核缓冲区。

## 六、完整调用链

```text
用户程序
  ↓ open/read/write 系统调用
VFS 虚拟文件系统
  ↓ 按设备号找到驱动
hello_fops
  ↓
copy_to_user / copy_from_user
  ↓
kernel_buf（内核内存）
```

到这里，"应用 → 系统调用 → 驱动 → 内核数据"这条链路就完整了。

## 七、踩过的坑

| 问题 | 原因 | 解决 |
|---|---|---|
| `missing separator` | Makefile 用空格缩进 | 改成 Tab |
| 编译找不到编译器 | `CROSS_COMPILE` 路径写错 | 指向 Buildroot 的 `output/host/bin/` |
| 终端输出交错 | `pr_info` 与 `printf` 同时写串口 | 降低日志级别或忽略 |
| 该用 `lseek` 却失败 | 驱动未实现 `.llseek` | 重新 `open` 重置偏移 |

## 八、小结

```text
内核模块 = 可加载的内核代码，本质是可重定位目标文件
字符设备 = file_operations + 设备号 + /dev 节点
copy_to_user / copy_from_user = 用户态与内核态之间的安全通道
```

下一篇把启动方式换掉：不再让 QEMU 直接加载内核，而是用 U-Boot 引导它。
