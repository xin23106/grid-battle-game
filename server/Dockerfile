# 联机服务器的容器镜像（Fly.io / Render Docker / 任意容器平台可用）
# 构建： docker build -t grid-battle-server ./server
# 运行： docker run -p 3000:3000 -e PORT=3000 grid-battle-server
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
