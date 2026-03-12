# 我的博客

基于 VitePress 搭建的个人博客。

## 开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建
npm run build

# 预览构建结果
npm run preview
```

## 部署

### GitHub Pages

推送到 `main` 分支后会自动部署。

需要在 GitHub 仓库设置中：
1. 进入 Settings → Pages
2. Source 选择 "GitHub Actions"

### Gitee Pages

1. 修改 `deploy-gitee.sh` 中的仓库地址
2. 运行 `bash deploy-gitee.sh`
3. 在 Gitee 仓库中手动开启 Gitee Pages

## 目录结构

```
docs/
├── .vitepress/
│   └── config.mts    # 配置文件
├── public/           # 静态资源
├── posts/            # 博客文章
├── about/            # 关于页面
└── index.md          # 首页
```

## 添加新文章

1. 在 `docs/posts/` 目录下创建 `.md` 文件
2. 在 `docs/.vitepress/config.mts` 的 sidebar 中添加链接
