#!/usr/bin/env sh

# 确保脚本抛出遇到的错误
set -e

# 生成静态文件
npm run build

# 进入生成的文件夹
cd docs/.vitepress/dist

git init
git add -A
git commit -m 'deploy'

# 部署到 Gitee Pages
# 替换为你的 Gitee 仓库地址
# git push -f git@gitee.com:你的用户名/仓库名.git master:gitee-pages

cd -
