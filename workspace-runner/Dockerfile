FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY dist ./dist
EXPOSE 3101
CMD ["node", "dist/src/server.js"]
