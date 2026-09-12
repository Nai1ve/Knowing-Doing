ARG NODE_BASE_IMAGE=node:22-bookworm-slim
FROM ${NODE_BASE_IMAGE}

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends docker.io \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY dist ./dist
EXPOSE 3101
# The server-managed base image is OpenHands and carries its own entrypoint.
# Workspace Runner must execute only its Node process and never bootstrap
# OpenHands when used as a runtime or during health checks.
ENTRYPOINT []
CMD ["node", "dist/src/server.js"]
