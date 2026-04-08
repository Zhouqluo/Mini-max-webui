# 使用官方 Node 镜像
FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 拷贝所有代码
COPY . .

# 暴露端口
EXPOSE 16010

# 启动命令
CMD ["node", "proxy.js"]
