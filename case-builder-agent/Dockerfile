FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends docker.io docker-compose default-mysql-client python3 python3-pip ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# This wrapper is the only product-facing service with the host Docker socket.
# OpenHands itself runs in a separately digest-pinned task image; see
# Dockerfile.openhands for the reproducible extension recipe.
WORKDIR /srv/case-builder-agent
COPY src ./src

ENV CASE_BUILDER_PORT=3102 \
    CASE_BUILDER_STATE_DIR=/var/lib/case-builder-agent

EXPOSE 3102
CMD ["node", "src/server.mjs"]
