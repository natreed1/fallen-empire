# Build with Docker context = repository root (not `game-server/` alone).
# game-server imports ../../src/core/... — parent `src/` must be in the image.
#
# Railway: Root Directory = / (empty), Builder = Dockerfile, path = game-server/Dockerfile

FROM node:20-bookworm-slim

WORKDIR /app

COPY tsconfig.json ./
COPY src ./src
COPY game-server ./game-server

WORKDIR /app/game-server
RUN npm ci

ENV NODE_ENV=production
EXPOSE 3333

CMD ["npm", "start"]
