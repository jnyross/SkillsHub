FROM node:20-slim

# Install system deps
RUN apt-get update && apt-get install -y curl git docker.io

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Install Codex CLI
RUN npm install -g @openai/codex

# Install pnpm
RUN npm install -g pnpm@9

# App code
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build --filter=runner

CMD ["node", "apps/runner/dist/index.js"]
