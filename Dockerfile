# Claude Phone — Node chat UI + Claude Code CLI in one image.
# Claude settings / sessions live on a volume (HOME), not in the image.

FROM node:20-bookworm-slim

LABEL org.opencontainers.image.title="claude-phone" \
      org.opencontainers.image.description="Self-hosted mobile chat UI for Claude Code CLI" \
      org.opencontainers.image.source="https://github.com/nianshou555qiansui/claude-phone"

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    # Container must listen on all interfaces; host still binds via compose ports
    BIND=0.0.0.0 \
    PORT=7681 \
    HOME=/home/claude \
    WORK_DIR=/workspace \
    CLAUDE_BIN=claude \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Minimal tools Claude Code / shell turns often need
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    python3 \
    bash \
    tini \
  && rm -rf /var/lib/apt/lists/*

# Claude Code CLI (same package the host npm install -g uses)
RUN npm install -g @anthropic-ai/claude-code@latest \
  && npm cache clean --force \
  && claude --version

# Non-root user (uid fixed so bind-mounted volumes stay consistent)
RUN groupadd --gid 10001 claude \
  && useradd --uid 10001 --gid claude --create-home --home-dir /home/claude --shell /bin/bash claude \
  && mkdir -p /app /workspace /app/data \
  && chown -R claude:claude /app /workspace /home/claude

WORKDIR /app

COPY --chown=claude:claude package.json ./
COPY --chown=claude:claude server ./server
COPY --chown=claude:claude public ./public
COPY docker/entrypoint.sh /entrypoint.sh

RUN chmod 755 /entrypoint.sh \
  && chown claude:claude /entrypoint.sh

USER claude

EXPOSE 7681

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||7681)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
CMD ["node", "server/server.js"]
