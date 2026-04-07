# STL 深度剖析

> STL 不只是"一堆容器"，它是一套**泛型编程思想的工程实践**。理解 STL 的底层实现，才能在面试中回答"为什么"，在工程中做对选型。

---

## 0. 全景地图

### STL 六大组件

```
┌─────────────────────────────────────────────────────────────┐
│                        STL 六大组件                           │
│                                                             │
│   ┌──────────┐    迭代器     ┌──────────┐                    │
│   │  容器     │◄────────────►│  算法     │                    │
│   │ Container │  Iterator    │ Algorithm │                    │
│   └────┬─────┘              └──────────┘                    │
│        │                         ▲                          │
│        │ 使用                     │ 使用                     │
│        ▼                         │                          │
│   ┌──────────┐             ┌──────────┐                     │
│   │ 分配器    │             │  仿函数   │                     │
│   │ Allocator │             │ Functor  │                     │
│   └──────────┘             └──────────┘                     │
│                                  ▲                          │
│                                  │ 转换                     │
│                            ┌──────────┐                     │
│                            │  适配器   │                     │
│                            │ Adapter  │                     │
│                            └──────────┘                     │
└─────────────────────────────────────────────────────────────┘

数据流：容器 ──存储──► 数据 ◄──操作── 算法
桥梁：迭代器（让算法不必关心容器的底层结构）
定制点：仿函数（让算法行为可配置）、适配器（改变接口）、分配器（改变内存策略）
```

**核心设计思想**：将"数据结构"和"算法"解耦，用"迭代器"做桥梁。这意味着 N 个容器 + M 个算法只需要 N+M 份代码，而非 N*M。

### 容器分类

| 类别 | 容器 | 底层数据结构 | 特点 |
|------|------|------------|------|
| **序列容器** | `vector` | 动态数组 | 尾部 O(1)，随机访问 O(1) |
| | `deque` | 分块数组 | 首尾 O(1)，随机访问 O(1) |
| | `list` | 双向链表 | 任意位置插删 O(1)，不支持随机访问 |
| | `forward_list` | 单向链表 | 同上，更省内存 |
| | `array` | 固定数组 | 编译期确定大小，零开销 |
| **关联容器** | `set / multiset` | 红黑树 | 有序，O(log n) |
| | `map / multimap` | 红黑树 | 有序键值对，O(log n) |
| **无序容器** | `unordered_set / unordered_multiset` | 哈希表 | 无序，平均 O(1) |
| | `unordered_map / unordered_multimap` | 哈希表 | 无序键值对，平均 O(1) |
| **容器适配器** | `stack` | 默认 deque | LIFO |
| | `queue` | 默认 deque | FIFO |
| | `priority_queue` | vector + 堆 | 最大/最小堆 |

---

## 1. vector 深度剖析

**一句话本质**：vector 就是一个会自动扩容的数组，底层是一段连续内存。

### 1.1 底层实现：三个指针

```
                    start          finish        end_of_storage
                      │               │                │
                      ▼               ▼                ▼
内存布局:   ┌───┬───┬───┬───┬───┬─────┬─────┬─────┐
            │ 1 │ 2 │ 3 │ 4 │ 5 │     │     │     │
            └───┴───┴───┴───┴───┴─────┴─────┴─────┘
            ◄──── size() = 5 ────►
            ◄──────── capacity() = 8 ─────────────►
```

GCC libstdc++ 中 vector 的核心就是三个指针：

```cpp
// 简化的 vector 内部结构
template <typename T>
class vector {
    T* _M_start;           // 指向第一个元素
    T* _M_finish;          // 指向最后一个元素的下一个位置
    T* _M_end_of_storage;  // 指向分配内存的末尾

    size_t size()     const { return _M_finish - _M_start; }
    size_t capacity() const { return _M_end_of_storage - _M_start; }
    bool   empty()    const { return _M_start == _M_finish; }
    T&     operator[](size_t n) { return *(_M_start + n); }
};
```

### 1.2 扩容策略

**关键问题：容量满了怎么办？**

vector 不能原地扩容（后面的内存可能被别人占了），必须：
1. 申请一块**更大的**新内存
2. 把旧元素**移动/拷贝**到新内存
3. **释放**旧内存

```
扩容前:
  start     finish/end_of_storage
    │              │
    ▼              ▼
  ┌───┬───┬───┬───┐
  │ 1 │ 2 │ 3 │ 4 │   ← capacity = 4, size = 4, 满了!
  └───┴───┴───┴───┘

push_back(5) 触发扩容:

  1) 申请 2 倍大小的新内存
  ┌───┬───┬───┬───┬───┬───┬───┬───┐
  │   │   │   │   │   │   │   │   │   ← 新内存, capacity = 8
  └───┴───┴───┴───┴───┴───┴───┴───┘

  2) 移动旧元素 + 插入新元素
  ┌───┬───┬───┬───┬───┬───┬───┬───┐
  │ 1 │ 2 │ 3 │ 4 │ 5 │   │   │   │   ← size = 5
  └───┴───┴───┴───┴───┴───┴───┴───┘

  3) 释放旧内存
  ┌───┬───┬───┬───┐
  │ X │ X │ X │ X │   ← 旧内存已释放，所有旧指针/迭代器失效!
  └───┴───┴───┴───┘
```

**GCC vs MSVC 扩容倍数**：

| 实现 | 扩容倍数 | 原因 |
|------|---------|------|
| GCC (libstdc++) | **2 倍** | 实现简单，均摊 O(1) |
| MSVC (STL) | **1.5 倍** | 内存利用率更好，旧内存可被复用 |

**为什么是 2 倍（或 1.5 倍）而不是每次加固定值？**

均摊分析：如果每次扩容增加 k 倍，n 次 push_back 的总拷贝次数为 `n / (k-1)`，均摊到每次是 O(1)。如果每次加固定值 C，总拷贝次数是 O(n^2/C)，均摊是 O(n)。

**1.5 倍的优势**：2 倍扩容时，新大小总是大于之前所有旧块之和（1+2+4 &lt; 8），所以旧内存永远无法被复用。而 1.5 倍扩容时，经过几次扩容后旧内存块的总和可以容纳新块（1+1.5+2.25 > 3.375），内存分配器有机会复用旧内存。

### 1.3 push_back 的完整流程

```cpp
// 伪代码，展示核心逻辑
void push_back(const T& value) {
    if (_M_finish != _M_end_of_storage) {
        // 有空间：直接在 finish 位置构造对象
        construct(_M_finish, value);  // placement new
        ++_M_finish;
    } else {
        // 没空间：触发扩容
        size_t old_size = size();
        size_t new_cap = old_size ? 2 * old_size : 1;

        T* new_start = allocate(new_cap);           // 1. 申请新内存
        T* new_finish = uninitialized_move(          // 2. 移动旧元素
            _M_start, _M_finish, new_start);
        construct(new_finish, value);                // 3. 构造新元素
        ++new_finish;

        destroy(_M_start, _M_finish);               // 4. 析构旧元素
        deallocate(_M_start, capacity());            // 5. 释放旧内存

        _M_start = new_start;                        // 6. 更新指针
        _M_finish = new_finish;
        _M_end_of_storage = new_start + new_cap;
    }
}
```

### 1.4 emplace_back vs push_back

```cpp
struct Widget {
    Widget(int a, double b) { /* ... */ }
};

std::vector<Widget> v;

// push_back：先构造临时对象，再移动/拷贝到容器内
v.push_back(Widget(1, 3.14));  // 构造临时 + 移动构造

// emplace_back：直接在容器内部原地构造，免去临时对象
v.emplace_back(1, 3.14);      // 直接转发参数到构造函数
```

| 对比 | `push_back` | `emplace_back` |
|------|-------------|----------------|
| 参数 | 接受对象（左值或右值） | 接受构造函数参数（完美转发） |
| 临时对象 | 可能产生 | 不产生 |
| 适用场景 | 已有对象时 | 需要原地构造时 |
| C++ 版本 | C++98 | C++11 |

**陷阱**：emplace_back 不一定更快。如果传入的本来就是右值，push_back 也会调用移动构造，差距很小。emplace_back 的真正优势是在**需要隐式构造**的场景。

#### 1. 优缺点与权衡

**优点**：
- 随机访问 O(1)：底层连续内存，`operator[]` 直接指针算术，是所有容器中随机访问最快的
- 缓存极度友好：元素在内存中紧密排列，CPU 预取和 L1/L2 cache 命中率高，遍历性能远超链表（即使理论复杂度相同）
- 尾部操作均摊 O(1)：push_back/pop_back 高效，配合 `reserve()` 预分配可完全避免扩容

**缺点/代价**：
- 扩容拷贝开销：容量满时必须分配新内存 + 移动/拷贝全部元素 + 释放旧内存，单次扩容 O(n)，且所有迭代器/指针/引用全部失效
- 中间插入/删除 O(n)：需要移动插入/删除点之后的所有元素，对于频繁中间操作的场景性能差
- 头部插入 O(n)：需要移动全部元素，不适合 FIFO 场景（这就是 queue 默认用 deque 而非 vector 的原因）
- 内存浪费：capacity 通常大于 size（预留空间），且不会自动缩容，`shrink_to_fit` 也只是建议

**权衡**：vector 是 90% 场景的默认首选容器——即使理论上链表的中间插删是 O(1)，实测中 vector 凭借缓存友好性在大多数数据量下仍然更快；只有当元素很大（移动代价高）且频繁中间插删时，才考虑换用 list 或 deque

### 1.5 迭代器失效的所有场景

**插入元素时**：
- 触发扩容 --> **所有**迭代器、指针、引用全部失效（旧内存释放）
- 未触发扩容 --> 插入点及之后的迭代器失效，之前的仍有效
- 无论是否扩容，`end()` 始终失效

**删除元素时**：
- 被删除元素的迭代器失效
- 删除点之后的所有迭代器失效（元素前移）
- `end()` 失效

**安全的遍历中插删**：

```cpp
// ✅ 正确的删除写法：用 erase 返回值更新迭代器
for (auto it = v.begin(); it != v.end(); /* 不在这里 ++ */) {
    if (should_remove(*it)) {
        it = v.erase(it);   // erase 返回下一个有效迭代器
    } else {
        ++it;
    }
}

// ✅ 正确的插入写法：用 insert 返回值更新迭代器
for (auto it = v.begin(); it != v.end(); ) {
    if (should_insert_before(*it)) {
        it = v.insert(it, new_value);  // 返回指向新元素的迭代器
        it += 2;  // 跳过新元素和当前元素
    } else {
        ++it;
    }
}

// ❌ 错误：删除后继续使用旧迭代器
for (auto it = v.begin(); it != v.end(); ++it) {
    if (should_remove(*it)) {
        v.erase(it);  // it 已失效，下一次 ++it 是未定义行为!
    }
}
```

### 1.6 size / capacity / resize / reserve

| 函数 | 改变 size? | 改变 capacity? | 构造/析构元素? | 用途 |
|------|-----------|---------------|-------------|------|
| `size()` | - | - | - | 查询元素数量 |
| `capacity()` | - | - | - | 查询已分配空间 |
| `resize(n)` | 是 | 可能增大 | n > size 时构造，n &lt; size 时析构 | 改变元素数量 |
| `reserve(n)` | 否 | n > capacity 时增大 | 否 | 预分配内存，避免多次扩容 |
| `shrink_to_fit()` | 否 | 可能缩小到 size | 否 | 释放多余内存（非强制） |

```cpp
vector<int> v;
v.reserve(100);      // capacity=100, size=0, 无元素
v.resize(50);        // capacity=100, size=50, 有50个值为0的元素
v.resize(10);        // capacity=100, size=10, 后40个元素被析构
v.shrink_to_fit();   // capacity 可能缩小到 10（实现可以忽略这个请求）
```

**实战建议**：如果你预知最终大小，先 `reserve()` 再 `push_back()`，避免中途多次扩容拷贝。

### 1.7 陷阱：vector\&lt;bool\> 不是真正的 vector

`vector<bool>` 是一个**特化版本**，为了节省空间，它用 1 个 bit 存储一个 bool（而非 1 字节）。这导致：

```cpp
vector<bool> vb = {true, false, true};

// ❌ 不能取引用，因为 bit 不可寻址
bool& ref = vb[0];           // 编译错误!
auto  val = vb[0];           // val 的类型不是 bool，而是 vector<bool>::reference

// ✅ 替代方案
vector<char> vc = {1, 0, 1}; // 用 char 代替
bitset<3> bs("101");         // 固定大小时用 bitset
deque<bool> db = {true};     // deque<bool> 没有特化
```

> **面试速答**
> - **是什么/本质**：动态数组，底层连续内存，用三个指针（start/finish/end_of_storage）管理大小和容量
> - **解决什么问题**：提供可变长度的随机访问序列，兼顾缓存友好和动态增长
> - **底层原理**：扩容时分配新内存（GCC 2倍/MSVC 1.5倍）、移动元素、释放旧内存，push_back 均摊 O(1)；emplace_back 通过完美转发原地构造省去临时对象
> - **坑点**：扩容导致所有迭代器失效，未扩容时插入/删除点之后失效；`vector<bool>` 是特化版本用 bit 存储不能取引用，实战中用 `vector<char>` 替代
> - **横向对比**：vs deque——vector 随机访问更快（真正连续内存），但头部插删 O(n)；vs array——array 编译期固定大小，零开销
> - **选型建议**：90% 场景的默认容器选择，预知大小时先 `reserve()` 避免多次扩容

---

## 2. list / forward_list

### 2.1 list：双向链表

**一句话本质**：list 是一个带哨兵节点的环形双向链表。

```cpp
// 简化的节点结构
template <typename T>
struct _List_node {
    _List_node* prev;  // 前驱指针
    _List_node* next;  // 后继指针
    T           data;  // 数据
};
```

```
内存布局（环形双向链表，sentinel 是哨兵节点）:

     ┌──────────────────────────────────────────────┐
     │                                              │
     ▼                                              │
  ┌──────┐     ┌──────┐     ┌──────┐     ┌──────┐  │
  │ sent │◄───►│ node │◄───►│ node │◄───►│ node │──┘
  │(哨兵) │     │  A   │     │  B   │     │  C   │
  └──────┘     └──────┘     └──────┘     └──────┘
  end()/        begin()                   --end()
  rend()
```

**为什么用哨兵节点？** 简化边界处理——插入/删除不需要判断头尾是否为空。

### 2.2 为什么 list::sort 不用 std::sort

`std::sort` 要求 **RandomAccessIterator**（支持 `it + n`、`it1 - it2`），而 list 的迭代器只是 **BidirectionalIterator**（只能 `++` 和 `--`）。

```cpp
std::list<int> lst = {3, 1, 2};

// ❌ 编译错误：list 迭代器不支持随机访问
std::sort(lst.begin(), lst.end());

// ✅ 使用 list 自带的成员函数 sort（底层是归并排序）
lst.sort();
```

**list::sort 用归并排序**，时间复杂度 O(n log n)，只需要修改指针，不需要随机访问。

### 2.3 forward_list：单向链表

比 list 少一个 `prev` 指针，每个节点省一个指针的空间。代价是只能**单向遍历**，插入/删除只能在**某个节点之后**（`insert_after` / `erase_after`）。

| 对比 | `list` | `forward_list` |
|------|--------|----------------|
| 链表类型 | 双向 | 单向 |
| 每节点开销 | 2 指针 + 数据 | 1 指针 + 数据 |
| 遍历方向 | 前后都行 | 只能向前 |
| 插入/删除 | `insert` / `erase` | `insert_after` / `erase_after` |
| `size()` | O(1)（C++11） | **无 size()** 成员 |

#### 2. 优缺点与权衡

**优点**：
- 任意位置插删 O(1)：只需修改前后节点的指针，不移动任何元素，操作代价与容器大小无关
- 迭代器高度稳定：插入不影响任何已有迭代器，删除只使被删元素的迭代器失效，其余全部有效——这在需要边遍历边修改的场景中是巨大优势
- splice O(1)：可以把另一个 list 的节点直接"嫁接"过来，无需拷贝/移动元素

**缺点/代价**：
- 缓存极不友好：每个节点独立 `new` 在堆上，地址分散，遍历时 CPU cache 几乎每次都 miss，实测遍历性能可能比 vector 差 10 倍以上
- 每节点额外内存开销大：双向链表每个节点多 2 个指针（16 字节/64位），存 `int`（4 字节）时指针开销是数据的 4 倍
- 不支持随机访问：访问第 n 个元素必须从头遍历 O(n)，无法使用 `std::sort`（要求 RandomAccessIterator）
- 频繁 new/delete：每次 push/insert 都要堆分配，频繁小内存分配对 allocator 有压力

**权衡**：在实际工程中，由于缓存友好性的碾压效应，vector 在绝大多数场景下比 list 更快——即使是"中间插删"这种理论上 list 占优的操作。只有当元素很大（移动代价高）、需要严格的迭代器稳定性、或频繁做 splice 操作时，list 才是正确选择

> **面试速答**
> - **是什么/本质**：带哨兵节点的环形双向链表，节点散布在堆上通过指针串联
> - **解决什么问题**：需要频繁在任意位置插删且不能让迭代器失效的场景
> - **底层原理**：插删只修改前后节点指针 O(1)，自带 sort 用归并排序只改指针不移动数据；forward_list 是单向链表，每节点省一个 prev 指针
> - **优缺点**：优点是插删不影响其他迭代器、不需要移动元素；缺点是缓存不友好（节点分散）、每节点额外两个指针开销、不支持随机访问
> - **坑点**：不能用 `std::sort`（需要 RandomAccessIterator），必须用成员函数 `list::sort()`；forward_list 没有 `size()` 成员
> - **选型建议**：除非需要频繁中间插删且元素数量大、或严格要求迭代器稳定性，否则优先 vector（缓存友好性通常碾压链表的理论优势）

---

## 3. deque 深度剖析

**一句话本质**：deque 是一个"伪连续"的分块数组，通过中控器(map)管理多个固定大小的缓冲区。

### 3.1 分块存储的内存布局

```
                      中控器 (map)
                  ┌───────────────┐
                  │   T** node_0  │───────► ┌───┬───┬───┬───┐
                  │   T** node_1  │───┐     │ a │ b │ c │ d │  缓冲区 0
                  │   T** node_2  │─┐ │     └───┴───┴───┴───┘
                  │   T** node_3  │ │ │
                  │      ...      │ │ └───► ┌───┬───┬───┬───┐
                  └───────────────┘ │       │ e │ f │ g │ h │  缓冲区 1
                                    │       └───┴───┴───┴───┘
                                    │
                                    └─────► ┌───┬───┬───┬───┐
                                            │ i │ j │   │   │  缓冲区 2
                                            └───┴───┴───┴───┘

deque 的迭代器结构（4 个指针）:
  struct iterator {
      T*  cur;    // 当前元素
      T*  first;  // 当前缓冲区的头
      T*  last;   // 当前缓冲区的尾
      T** node;   // 指向中控器中对应的节点
  };
```

**随机访问的实现**：`operator[](n)` 先算在第几个缓冲区（`n / buf_size`），再算缓冲区内偏移（`n % buf_size`），所以仍然是 O(1)，但常数比 vector 大。

### 3.2 为什么 stack 和 queue 默认用 deque 而不是 vector

| 对比维度 | deque | vector |
|---------|-------|--------|
| 头部插删 | O(1) | O(n)，需要移动所有元素 |
| 尾部插删 | O(1) | 均摊 O(1) |
| 扩容代价 | 只需新增一个缓冲区 | 需要拷贝所有元素到新内存 |
| 缩容 | 可以释放不用的缓冲区 | 不会自动缩容，内存占着不放 |

- **stack**（LIFO）：只需要尾部操作，vector 也行，但 deque 扩容更平滑（不需要整体拷贝）
- **queue**（FIFO）：需要头部删除 + 尾部插入，vector 头部删除是 O(n)，完全不适合

#### 3. 优缺点与权衡

**优点**：
- 首尾插删均 O(1)：头部和尾部都可以高效操作，这是 vector 做不到的（vector 头部插删 O(n)）
- 扩容平滑：只需新增一个缓冲区块，不需要像 vector 那样拷贝全部元素到新内存，单次扩容代价小
- 支持随机访问：虽然常数比 vector 大，但仍然是 O(1)，可以用 `operator[]`

**缺点/代价**：
- 随机访问常数大：每次 `operator[]` 需要做除法（算缓冲区号）+ 取模（算偏移），再加一次中控器间接寻址，比 vector 的纯指针算术慢
- 迭代器复杂度高：迭代器包含 4 个指针（cur/first/last/node），`++` 操作需要判断是否跨越缓冲区边界，开销比 vector 迭代器大
- 内存碎片：多个独立的缓冲区块分散在堆上，缓存友好性不如 vector 的单块连续内存
- 中间插删仍然 O(n)：中间位置的插入/删除需要移动元素（选择移动元素少的一端），性能不比 vector 好多少

**权衡**：需要双端操作（如实现队列、滑动窗口）时 deque 是最佳选择；如果只需要尾部操作且追求极致的随机访问和遍历性能，vector 更优；这就是 stack 和 queue 默认底层都用 deque 的原因——兼顾了两端操作的通用性

> **面试速答**
> - **是什么/本质**：分块数组，通过中控器（map 指针数组）管理多个固定大小的连续缓冲区，是"伪连续"容器
> - **解决什么问题**：需要首尾都能高效插删，同时保持随机访问能力
> - **底层原理**：迭代器含 4 个指针（cur/first/last/node），随机访问 O(1) 但需要除法算缓冲区号 + 取模算偏移，常数比 vector 大；扩容只需新增缓冲区不用拷贝全部元素
> - **优缺点**：优点是首尾插删 O(1)、扩容平滑；缺点是随机访问常数大、内存碎片、迭代器复杂
> - **横向对比**：vs vector——vector 只有尾部 O(1)，头部插删 O(n)；这就是 stack/queue 默认用 deque 的原因，queue 需要头部删除
> - **选型建议**：需要双端操作用 deque，只需要尾部操作且追求极致随机访问性能用 vector

---

## 4. map / set（红黑树）

### 4.1 红黑树的 5 个性质

红黑树是一种**自平衡二叉搜索树**，通过以下 5 个性质保证最长路径不超过最短路径的 2 倍：

1. 每个节点是**红色**或**黑色**
2. **根节点是黑色**
3. **叶节点（NIL）是黑色**（这里的叶节点是虚拟的空节点）
4. **红色节点的两个子节点都是黑色**（不能有连续的红节点）
5. 从任意节点到其所有后代叶节点的路径上，**黑色节点数量相同**（黑高相同）

**为什么这 5 条性质能保证平衡？** 性质 4 + 5 决定了：最长路径（红黑交替）最多是最短路径（全黑）的 2 倍。因此查找/插入/删除都是 O(log n)。

### 4.2 为什么不用 AVL 树

| 对比 | 红黑树 | AVL 树 |
|------|--------|--------|
| 平衡条件 | 最长路径 ≤ 2 * 最短路径 | 左右子树高度差 ≤ 1（更严格） |
| 查找 | O(log n)，常数稍大 | O(log n)，常数更小 |
| 插入 | 最多 2 次旋转 | 最多 2 次旋转 |
| 删除 | 最多 3 次旋转 | 可能旋转 O(log n) 次 |
| 适用场景 | **插入/删除频繁** | **查找密集、很少修改** |

**结论**：STL 的 map/set 需要频繁插入删除，红黑树的删除旋转次数是常数，比 AVL 更适合。数据库索引（B+ 树的变体）或查找密集场景才更适合 AVL。

### 4.3 map vs set

| 对比 | map | set |
|------|-----|-----|
| 存储内容 | key-value 键值对 | 只有 key |
| 迭代器修改 | 可以修改 value，不能修改 key | 迭代器是 const，不能修改元素 |
| `operator[]` | 支持（key 不存在时会自动插入默认值！） | 不支持 |
| 排序依据 | 按 key 排序 | 按元素本身排序 |

### 4.4 map 的四种插入/访问方式对比

```cpp
std::map<std::string, int> m;

// 1. operator[]：key 不存在则插入默认值，返回引用
m["apple"] = 1;       // 不存在 → 插入 {"apple", 0} → 赋值为 1
m["apple"] = 2;       // 已存在 → 直接修改 value

// 2. at()：key 不存在则抛出 std::out_of_range
int val = m.at("banana");  // 抛异常!

// 3. insert()：key 已存在则不覆盖，返回 pair<iterator, bool>
auto [it, ok] = m.insert({"apple", 99});
// ok == false, apple 的值仍然是 2

// 4. emplace()：类似 insert，但原地构造，避免临时对象
auto [it2, ok2] = m.emplace("grape", 5);
```

| 方式 | key 不存在 | key 已存在 | 是否可能意外插入 |
|------|-----------|-----------|--------------|
| `operator[]` | 插入默认值 | 返回引用（可修改） | **是！慎用** |
| `at()` | 抛异常 | 返回引用 | 否 |
| `insert()` | 插入 | 不覆盖 | 否 |
| `emplace()` | 插入 | 不覆盖 | 否 |

**陷阱**：`operator[]` 在 const map 上不能用，而且只要访问不存在的 key 就会插入默认值。只想查找时用 `find()` 或 `count()`。

### 4.5 lower_bound / upper_bound

```cpp
std::map<int, string> m = {{1,"a"}, {3,"b"}, {5,"c"}, {7,"d"}};

auto lb = m.lower_bound(3);  // 指向 {3,"b"}（第一个 >= 3 的）
auto ub = m.upper_bound(3);  // 指向 {5,"c"}（第一个 >  3 的）

// 查找区间 [lo, hi) 内的所有元素
auto lo = m.lower_bound(2);  // 指向 {3,"b"}
auto hi = m.upper_bound(5);  // 指向 {7,"d"}
for (auto it = lo; it != hi; ++it) {
    // 遍历 {3,"b"}, {5,"c"}
}
```

#### 4. 优缺点与权衡

**优点**：
- 有序性：元素按 key 自动排序，支持 `lower_bound`/`upper_bound` 做范围查询，遍历输出天然有序
- 稳定的 O(log n)：基于红黑树实现，查找/插入/删除最坏情况都是 O(log n)，没有哈希表那种退化到 O(n) 的风险
- 迭代器稳定：节点式容器，插入不影响已有迭代器，删除只使被删节点失效

**缺点/代价**：
- 查找速度不如哈希表：O(log n) vs unordered 容器的均摊 O(1)，数据量大时差距明显（100 万元素：~20 次比较 vs ~1 次哈希）
- 缓存不友好：红黑树节点散布在堆上，遍历时频繁 cache miss，实测性能可能比 sorted vector + binary search 差
- 每节点内存开销大：每个节点除了存储 key-value，还需要左右子指针 + 父指针 + 颜色标记（约 32 字节额外开销/64 位系统）
- 不支持随机访问：无法通过下标访问第 k 个元素

**权衡**：需要有序遍历、范围查询（`lower_bound`/`upper_bound`）、或要求最坏情况性能有保证时用 map/set；如果只需要快速查找且不关心顺序，unordered 版本几乎总是更快；对于静态数据（构建后不修改），sorted vector + `std::lower_bound` 兼顾有序和缓存友好

> **面试速答**
> - **是什么/本质**：基于红黑树的有序关联容器，元素按 key 自动排序，查找/插入/删除均 O(log n)
> - **解决什么问题**：需要有序存储键值对、按范围查询、或需要自定义排序的场景
> - **底层原理**：选红黑树而非 AVL 树——红黑树删除最多 3 次旋转（常数级），AVL 树删除可能旋转 O(log n) 次，频繁增删时红黑树更优
> - **坑点**：map 的 `operator[]` key 不存在时会自动插入默认值元素，只想查找时必须用 `find()` 或 `at()`
> - **横向对比**：vs unordered_map——有序容器 O(log n) 但支持范围查询和有序遍历，无序容器平均 O(1) 但无序
> - **选型建议**：需要有序遍历或范围查询用 map/set，只需要快速查找用 unordered 版本；节点式容器插入不影响已有迭代器

---

## 5. unordered_map / unordered_set（哈希表）

### 5.1 底层结构：桶 + 链表（开链法）

```
bucket 数组（桶数组）
┌─────┐
│  0  │ → nullptr
├─────┤
│  1  │ → [key=11, val=A] → [key=23, val=B] → nullptr
├─────┤
│  2  │ → [key=2, val=C] → nullptr
├─────┤
│  3  │ → nullptr
├─────┤
│  4  │ → [key=4, val=D] → [key=16, val=E] → [key=28, val=F] → nullptr
├─────┤
│  5  │ → nullptr
├─────┤
│  6  │ → [key=6, val=G] → nullptr
└─────┘

查找 key=23:
  1. hash(23) % bucket_count = 23 % 7 = 2... 不对
     假设 hash(23) % 7 = 1
  2. 遍历 bucket[1] 的链表
  3. 比较 key: 11 != 23, 继续 → 23 == 23, 找到!
```

**STL 默认桶大小**：初始约 10 个桶（具体实现可能不同），会在负载因子超过阈值时 rehash。

### 5.2 哈希冲突解决方案对比

| 方案 | 原理 | 优点 | 缺点 | 谁在用 |
|------|------|------|------|--------|
| **开链法** | 每个桶挂一个链表 | 实现简单，删除方便 | 链表长时退化为 O(n) | STL unordered_map |
| **线性探测** | 冲突后往后找第一个空位 | 缓存友好 | 聚簇问题（clustering） | Google dense_hash_map |
| **二次探测** | 冲突后按 1^2, 2^2... 跳 | 减少聚簇 | 可能无法遍历所有桶 | 较少使用 |
| **双重哈希** | 用第二个哈希函数算步长 | 分布均匀 | 计算开销大 | 理论上优秀 |

### 5.3 负载因子和 rehash

```cpp
std::unordered_map<int, int> m;

// 负载因子 = 元素数量 / 桶数量
float lf = m.load_factor();           // 当前负载因子
float mlf = m.max_load_factor();      // 默认 1.0

// 当 load_factor() > max_load_factor() 时自动 rehash
// rehash 过程：
//   1. 分配新的更大的桶数组（通常是大于 2*n 的下一个质数）
//   2. 所有元素重新计算 hash，放到新桶中
//   3. 释放旧桶数组
// 代价：O(n)，所有迭代器失效

m.reserve(1000);   // 预分配足够的桶，避免中途 rehash
m.rehash(2000);    // 手动设置桶数量 >= 2000
```

**rehash 的代价很大**（O(n) 且所有迭代器失效），如果预知元素数量，先 `reserve()` 是最佳实践。

### 5.4 自定义类型作为 key

unordered 容器需要两样东西：**hash 函数**和 **operator==**。

```cpp
struct Point {
    int x, y;
    // 需要 operator==
    bool operator==(const Point& other) const {
        return x == other.x && y == other.y;
    }
};

// 方式一：特化 std::hash
namespace std {
template <>
struct hash<Point> {
    size_t operator()(const Point& p) const {
        // 组合多个字段的常用方法
        size_t h1 = std::hash<int>{}(p.x);
        size_t h2 = std::hash<int>{}(p.y);
        return h1 ^ (h2 << 1);  // 简单但实用的组合
    }
};
}

std::unordered_set<Point> points;  // 直接使用

// 方式二：自定义 hash 仿函数
struct PointHash {
    size_t operator()(const Point& p) const {
        return std::hash<int>{}(p.x) ^ (std::hash<int>{}(p.y) << 1);
    }
};

std::unordered_set<Point, PointHash> points2;
```

**陷阱**：hash 函数的质量直接影响性能。一个差的 hash 函数会让大量元素落到同一个桶，退化为 O(n)。

#### 5. 优缺点与权衡

**优点**：
- 均摊 O(1) 查找/插入/删除：哈希计算 + 桶定位是常数时间操作，数据量从 1 万到 1 亿，单次查找耗时几乎不变，大规模数据下远快于 map 的 O(log n)
- 使用简单：内置类型（int、string 等）开箱即用，无需自定义比较函数

**缺点/代价**：
- 最坏退化到 O(n)：哈希冲突严重时（差的哈希函数、hash flooding 攻击），同一个桶挂长链表，查找退化为链表遍历 O(n)
- 无序：不支持范围查询（`lower_bound`/`upper_bound`），遍历顺序不确定且可能随 rehash 变化
- rehash 代价大：负载因子超过阈值时触发 rehash，需要重新分配桶数组 + 对所有元素重新哈希，单次 O(n) 且所有迭代器失效
- 内存开销：桶数组 + 每个节点的指针开销 + 为避免频繁 rehash 预留的空桶，整体内存占用通常比 map 大
- 自定义类型需要额外工作：必须同时提供 hash 函数和 `operator==`，hash 函数质量直接决定性能

**权衡**：大多数"查找"场景的首选容器——预估元素量后先 `reserve()` 避免 rehash，性能稳定接近 O(1)；但如果需要有序遍历、范围查询、或对安全性有要求（防 hash flooding），应回退到 map/set

> **面试速答**
> - **是什么/本质**：基于哈希表的无序关联容器，STL 采用开链法（每个桶挂链表）解决冲突，平均 O(1) 查找/插入
> - **解决什么问题**：需要最快的查找/插入速度且不关心元素顺序的场景
> - **底层原理**：负载因子（元素数/桶数）超过阈值（默认 1.0）时触发 rehash，重新分配桶数组并重新散列所有元素，代价 O(n)
> - **坑点**：性能退化到 O(n) 的三种情况——哈希函数差大量碰撞、负载因子过高、hash flooding 攻击；自定义类型做 key 需同时提供 hash 函数和 `operator==`
> - **横向对比**：vs map/set——平均 O(1) vs O(log n)，但最坏 O(n)、不支持有序遍历、rehash 时所有迭代器失效
> - **选型建议**：大多数查找场景的首选，预估元素量后先 `reserve()` 避免 rehash；需要有序或范围查询时回退到 map/set

---

## 6. 迭代器

### 6.1 五种迭代器类别

```
能力递增:
  InputIterator      → 只读，单遍前向（istream_iterator）
       ↑
  ForwardIterator    → 读写，多遍前向（forward_list）
       ↑
  BidirectionalIterator → 可双向移动（list, map, set）
       ↑
  RandomAccessIterator  → 支持 +n, -n, []（vector, deque, array）
       ↑
  ContiguousIterator    → 内存连续（C++20, vector, array, string）

  OutputIterator     → 只写（ostream_iterator, back_inserter）
```

**为什么分这么多类？** 算法根据迭代器类别选择最优实现。例如 `std::distance()`：
- RandomAccessIterator: 直接 `last - first`，O(1)
- InputIterator: 逐步 `++`，O(n)

### 6.2 迭代器失效总结表

| 容器 | 插入 | 删除 | 说明 |
|------|------|------|------|
| **vector** | 扩容→全部失效；未扩容→插入点之后失效 | 删除点之后失效 | end() 总是失效 |
| **deque** | 首尾插入→迭代器失效，引用不失效；中间插入→全部失效 | 首尾删除→只有被删元素失效；中间删除→全部失效 | 比 vector 更复杂 |
| **list / forward_list** | **不失效** | 仅被删元素的迭代器失效 | 链表的优势 |
| **map / set** | **不失效** | 仅被删元素的迭代器失效 | 红黑树节点不移动 |
| **unordered_map / unordered_set** | rehash 时全部失效；否则不失效 | 仅被删元素的迭代器失效 | rehash 是关键 |

**记忆技巧**：
- **连续内存**的容器（vector, deque）：插入/删除可能导致元素移动，迭代器容易失效
- **节点式**容器（list, map, set）：节点地址不变，只有被删节点失效
- **哈希表**：额外注意 rehash

#### 6. 优缺点与权衡

**优点**：
- 统一抽象：迭代器将"遍历"从容器中抽离，使得 N 个容器 + M 个算法只需 N+M 份代码而非 N*M，是 STL 泛型设计的核心桥梁
- 分层设计灵活：5 种迭代器类别（Input/Forward/Bidirectional/RandomAccess/Contiguous）让算法可以根据迭代器能力选择最优实现（如 `std::distance` 对 RandomAccess 用减法 O(1)，对 Input 用逐步递增 O(n)）
- 与原生指针兼容：指针天然满足 RandomAccessIterator 的要求，C 风格数组可以直接用 STL 算法

**缺点/代价**：
- 失效风险是最常见的 C++ bug 来源：不同容器的失效规则各异（vector 扩容全失效、deque 中间插入全失效、unordered 容器 rehash 全失效），记错规则就是 UB
- 悬空迭代器无法检测：标准库不做运行时检查（release 模式），使用失效迭代器是未定义行为，不会 crash 而是静默错误，极难调试
- 抽象泄漏：迭代器的行为强依赖底层容器实现——`vector::iterator` 的 `+n` 是 O(1)，`list::iterator` 的 `+n` 是 O(n)，调用方必须了解底层才能写出高效代码

**权衡**：迭代器的统一抽象是 STL 设计的精髓，代价是程序员必须熟记各容器的失效规则；开发阶段建议开启 `-D_GLIBCXX_DEBUG`（GCC）或 `/D_ITERATOR_DEBUG_LEVEL=2`（MSVC）启用迭代器调试检查，上线前再关闭

> **面试速答**
> - **是什么/本质**：迭代器指向的元素被移动或释放后，继续使用该迭代器就是未定义行为
> - **解决什么问题**：理解失效规律才能写出安全的遍历+修改代码，避免隐蔽的 UB
> - **底层原理**：连续内存容器（vector/deque）插删移动元素导致大面积失效——vector 扩容全失效、未扩容时插入/删除点之后失效；节点式容器（list/map/set）只有被删节点失效；unordered 容器 rehash 时全失效
> - **坑点**：安全删除写法是 `it = container.erase(it)`，千万不要 erase 后再 `++it`——这是最常见的迭代器失效 bug
> - **横向对比**：连续容器失效范围大但缓存友好，节点容器几乎不失效但缓存差——这是同一个 trade-off 的两面

---

## 7. 算法与分配器

### 7.1 sort 的实现：IntroSort

`std::sort` 不是单纯的快速排序，而是三种排序算法的组合（Introspective Sort）：

```
std::sort 的决策逻辑:

        数据规模?
       /         \
  ≤ 16 个        > 16 个
    │              │
 插入排序      快速排序开始
  O(n²)        │
  但 n 小      递归深度 > 2*log₂(n)?
  常数小       /            \
             否              是
             │              │
          继续快排       切换堆排序
                        O(n log n)
                        保证最坏情况
```

**为什么这样组合？**

| 算法 | 平均 | 最坏 | 优点 | 缺点 |
|------|------|------|------|------|
| 快排 | O(n log n) | O(n^2) | 缓存友好，常数小 | 最坏 O(n^2) |
| 堆排 | O(n log n) | O(n log n) | 最坏有保证 | 缓存不友好，常数大 |
| 插入排序 | O(n^2) | O(n^2) | n 小时常数极小 | n 大时太慢 |

IntroSort 取三者之长：大部分时间用快排（快），发现要退化时切堆排（保底），小规模用插入排序（省开销）。

### 7.2 stable_sort

```cpp
// stable_sort 保证相等元素的相对顺序不变
struct Student {
    string name;
    int score;
};

std::vector<Student> students = {{"Alice",90}, {"Bob",90}, {"Carol",85}};

// 按分数排序，相同分数的人保持原始顺序
std::stable_sort(students.begin(), students.end(),
    [](const Student& a, const Student& b) { return a.score > b.score; });
// 结果: Alice(90), Bob(90), Carol(85) — Alice 仍在 Bob 前面
```

底层实现是**归并排序**（有足够内存时）或**原地归并**（内存不足时，更慢），时间复杂度 O(n log n)，空间复杂度 O(n)。

> **面试速答**
> - **是什么/本质**：std::sort 用 IntroSort（内省排序），组合快排+堆排+插入排序三种算法取长补短
> - **解决什么问题**：保证最坏情况 O(n log n) 的同时，平均情况接近快排的性能
> - **底层原理**：大部分时间用快排（缓存友好），递归深度超过 2*log2(n) 时切换堆排保证不退化，小规模（&lt;=16 元素）用插入排序（常数最小）
> - **横向对比**：vs stable_sort——sort 不保证稳定性但更快（原地），stable_sort 用归并排序保证稳定性但需额外 O(n) 空间
> - **坑点**：sort 要求 RandomAccessIterator，list 不能用必须用成员函数 sort()；自定义比较函数必须满足严格弱序，否则 UB
> - **选型建议**：不需要稳定性用 sort，需要稳定性用 stable_sort；部分排序用 partial_sort，只需第 k 大用 nth_element

### 7.3 STL 空间分配器（allocator）两级分配策略

SGI STL（GCC 早期版本）采用两级配置器：

```
分配请求
   │
   ├── 大于 128 字节 ──► 第一级配置器
   │                      直接调用 malloc/free
   │                      失败时调用 oom_handler
   │
   └── 小于等于 128 字节 ──► 第二级配置器（内存池）
                              │
                              ▼
                    ┌──────────────────────┐
                    │ 16 个空闲链表 (free list) │
                    │                      │
                    │ [0]  8B  → ■→■→■→nil │
                    │ [1] 16B  → ■→■→nil   │
                    │ [2] 24B  → ■→nil     │
                    │ ...                  │
                    │ [15] 128B → ■→nil    │
                    └──────────────────────┘
                              │
                    申请时：从对应链表取一块
                    释放时：归还到对应链表
                    链表空了？从内存池批量切割补充
```

**为什么要两级？**
- 小内存频繁 malloc/free 会产生大量**内存碎片**，且系统调用**开销大**
- 内存池批量申请、按固定大小切割，减少碎片和系统调用
- 大小按 8 字节对齐（如请求 20B → 分配 24B）

**注意**：现代 GCC 的默认 allocator 已经改用标准的 `new/delete`，SGI 两级分配器是作为可选实现保留的。但面试中仍然经常考。

> **面试速答**
> - **是什么/本质**：SGI STL 的两级内存分配策略——大块走 malloc，小块走内存池，减少系统调用和碎片
> - **解决什么问题**：频繁 malloc/free 小内存导致的内存碎片和系统调用开销
> - **底层原理**：大于 128B 走第一级（直接 malloc/free）；小于等于 128B 走第二级——维护 16 个空闲链表管理 8B/16B/.../128B 内存块，按 8 字节对齐从链表取块，释放归还链表
> - **优缺点**：优点是小对象分配极快、碎片少；缺点是内存只还给空闲链表不还给 OS，长期运行可能内存占用偏高
> - **横向对比**：vs jemalloc/tcmalloc——现代内存分配器思路类似但更完善，有线程本地缓存和更好的多核扩展性
> - **选型建议**：现代 GCC 默认已改用标准 new/delete，但内存池+空闲链表的设计思想在高性能场景（如游戏引擎、交易系统）仍广泛使用

---

## 8. 容器选型决策树

```
需要什么样的数据结构?
│
├── 需要键值对?
│   ├── 需要有序遍历? → map（红黑树，O(log n)）
│   └── 不需要有序，追求速度? → unordered_map（哈希表，O(1)）
│
├── 只需要集合（去重）?
│   ├── 需要有序? → set
│   └── 不需要有序? → unordered_set
│
├── 需要序列容器?
│   ├── 大小编译期确定? → array
│   ├── 需要随机访问?
│   │   ├── 主要在尾部增删? → vector（首选）
│   │   └── 需要首尾都快速增删? → deque
│   └── 不需要随机访问?
│       ├── 需要双向遍历? → list
│       └── 只需前向遍历，省内存? → forward_list
│
├── LIFO? → stack（默认用 deque）
├── FIFO? → queue（默认用 deque）
└── 优先级? → priority_queue（vector + 堆）
```

**经验法则**：
- **不确定时默认用 vector**。连续内存对缓存友好，绝大多数场景性能最好
- **需要频繁在中间插删** → list（但先想想能不能用 vector + erase-remove idiom）
- **需要 O(1) 查找** → unordered_map/unordered_set
- **需要有序 + 范围查询** → map/set

### 容器关键操作性能总表

| 容器 | 随机访问 | 头部插删 | 尾部插删 | 中间插删 | 查找 | 内存布局 |
|------|:-------:|:-------:|:-------:|:-------:|:----:|---------|
| `vector` | O(1) | O(n) | 均摊 O(1) | O(n) | O(n) | 连续 |
| `deque` | O(1) | O(1) | O(1) | O(n) | O(n) | 分块连续 |
| `list` | O(n) | O(1) | O(1) | O(1)* | O(n) | 离散节点 |
| `forward_list` | O(n) | O(1) | O(n) | O(1)* | O(n) | 离散节点 |
| `array` | O(1) | N/A | N/A | N/A | O(n) | 连续、固定 |
| `map`/`set` | N/A | N/A | N/A | O(log n) | O(log n) | 红黑树节点 |
| `unordered_map`/`set` | N/A | N/A | N/A | 均摊 O(1) | 均摊 O(1) | 哈希桶+链表 |
| `stack`/`queue` | N/A | N/A | O(1) | N/A | N/A | 依赖底层容器 |
| `priority_queue` | N/A | N/A | O(log n) | N/A | N/A | vector+堆 |

> \* list/forward_list 的"中间插删 O(1)"指的是**已经拿到迭代器**的情况。定位到目标位置仍然是 O(n)。

---

## 9. 自测问题

### Q1: vector 扩容机制
vector 在 push_back 时如果空间不足，会发生什么？为什么扩容倍数选 2 而不是每次加一个固定值？

> [!note]- 答案
> 1. 分配 2 倍（GCC）或 1.5 倍（MSVC）大小的新内存
> 2. 把旧元素移动/拷贝到新内存
> 3. 在新位置构造新元素
> 4. 析构旧元素，释放旧内存
>
> 如果每次加固定值 C，n 次 push_back 的总拷贝次数是 O(n^2/C)，均摊 O(n)。按倍数扩容，总拷贝次数 O(n)，均摊 O(1)。

### Q2: 迭代器失效判断
下面的代码有什么问题？
```cpp
vector<int> v = {1, 2, 3, 4, 5};
for (auto it = v.begin(); it != v.end(); ++it) {
    if (*it % 2 == 0) v.erase(it);
}
```

> [!note]- 答案
> `erase` 之后 `it` 已经失效，再执行 `++it` 是未定义行为。正确写法是 `it = v.erase(it)`，并且在 erase 的分支里不要 `++it`。

### Q3: emplace_back 一定比 push_back 快吗？

> [!note]- 答案
> 不一定。如果传入的已经是右值，push_back 会调用移动构造函数，和 emplace_back 差距很小。emplace_back 的真正优势在于避免创建临时对象，直接用参数原地构造。例如 `v.emplace_back(1, 3.14)` 比 `v.push_back(Widget(1, 3.14))` 少一次移动构造。

### Q4: 为什么 STL 的 map/set 用红黑树而不是 AVL 树？

> [!note]- 答案
> 两者查找都是 O(log n)，但 AVL 树删除时可能需要 O(log n) 次旋转来恢复平衡，而红黑树删除最多 3 次旋转。STL 容器需要频繁插入和删除，红黑树在修改操作上的旋转次数是常数级别，综合性能更好。AVL 树的优势在于查找更快（严格平衡），适合查找密集的场景。

### Q5: map 的 operator[] 和 at() 有什么区别？什么时候用哪个？

> [!note]- 答案
> `operator[]`：key 不存在时自动插入一个默认值元素，不能用于 const map。`at()`：key 不存在时抛 `std::out_of_range` 异常。如果只是查找而不想意外插入，用 `find()` 或 `at()`。如果确定要插入或修改，用 `operator[]`。

### Q6: unordered_map 什么时候性能会退化为 O(n)？

> [!note]- 答案
> 1. 哈希函数质量差，大量 key 落到同一个桶（哈希碰撞严重），链表过长
> 2. 负载因子过高，没有及时 rehash
> 3. 极端情况下被恶意输入（hash flooding 攻击）
>
> 应对：选择好的哈希函数、合理设置负载因子上限、预估大小后 reserve。

### Q7: deque 的随机访问是 O(1) 吗？和 vector 比谁更快？

> [!note]- 答案
> deque 的随机访问是 O(1)，但常数比 vector 大。vector 的 `operator[]` 只是 `*(start + n)` 一次指针运算。deque 需要先算在哪个缓冲区（`n / buf_size`），再算缓冲区内偏移（`n % buf_size`），涉及除法和间接寻址。如果需要大量随机访问，vector 更快。

### Q8: vector\&lt;bool\> 有什么坑？

> [!note]- 答案
> `vector<bool>` 是特化版本，每个 bool 只用 1 bit 存储。导致 `operator[]` 返回的不是 `bool&` 而是一个代理对象 `vector<bool>::reference`，不能取真正的引用，也不能对元素取地址。替代方案：`vector<char>`、`deque<bool>`、`bitset`。

### Q9: list::sort() 为什么不能用 std::sort() 代替？

> [!note]- 答案
> `std::sort` 要求 RandomAccessIterator（支持 `it + n`、`it1 - it2`），而 list 的迭代器只是 BidirectionalIterator。list 的成员函数 `sort()` 使用归并排序，只需要修改指针，不需要随机访问能力。

### Q10: 什么是 rehash？什么时候触发？如何避免？

> [!note]- 答案
> rehash 是 unordered 容器重新分配桶数组并将所有元素重新散列的过程。当 `load_factor() > max_load_factor()` 时自动触发。代价是 O(n) 且所有迭代器失效。避免方法：预估元素数量后调用 `reserve(n)`，让容器预分配足够的桶。

### Q11: std::sort 用的什么算法？为什么不只用快排？

> [!note]- 答案
> std::sort 用 IntroSort（内省排序），组合了快排 + 堆排 + 插入排序。快排平均性能好但最坏 O(n^2)，当递归深度超过 2*log₂(n) 时切换到堆排序保证 O(n log n) 的最坏情况。小规模数据（≤16）用插入排序，因为其常数因子最小。三者取长补短。

### Q12: SGI STL 的两级分配器是怎么工作的？为什么要这样设计？

> [!note]- 答案
> 第一级：> 128B 的分配直接走 malloc/free。第二级：≤ 128B 的分配使用内存池，维护 16 个空闲链表（分别管理 8B, 16B, ..., 128B 大小的块）。请求时按 8 对齐后从对应链表取块，释放时归还链表。这样设计是因为频繁 malloc 小内存会产生大量碎片和系统调用开销，内存池可以大幅减少这两个问题。

### Q13: 以下哪些容器的迭代器在插入操作后不会失效？

> [!note]- 答案
> `list`、`forward_list`、`map`、`set` 的迭代器在插入操作后不会失效（节点式容器，插入不会移动已有节点）。`vector` 扩容时全部失效。`deque` 在中间插入时全部失效，首尾插入时迭代器失效但引用/指针不失效。`unordered_map/unordered_set` 如果触发 rehash 则全部失效。

### Q14: 如何让自定义类型作为 unordered_map 的 key？

> [!note]- 答案
> 需要提供两样东西：1) hash 函数（特化 `std::hash<T>` 或传入自定义 hash 仿函数）；2) `operator==`（用于桶内链表中精确比较 key）。缺少任一都会编译失败。

### Q15: "不确定时默认用 vector"这句话背后的原理是什么？

> [!note]- 答案
> vector 的内存是连续的，对 CPU 缓存极其友好（cache locality）。现代 CPU 的缓存命中对性能影响巨大，连续内存的顺序访问比链表的随机跳转快得多。即使 vector 的某些操作（如中间插入）理论复杂度不如 list，实际中因为缓存效应，vector 往往更快。只有在元素数量大且频繁在中间插删时，list 才可能赢。
