FROM node:22-bookworm AS client
WORKDIR /app
COPY package.json ./
COPY client/package.json client/package-lock.json ./client/
RUN cd client && npm ci
COPY client ./client
RUN cd client && npm run build

FROM node:22-bookworm
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip python3-venv postgresql-client \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

COPY server/graph/requirements.txt ./server/graph/requirements.txt
RUN python3 -m venv /app/server/.venv \
  && /app/server/.venv/bin/pip install --no-cache-dir -r /app/server/graph/requirements.txt

COPY server ./server
COPY --from=client /app/client/dist ./client/dist

ENV NODE_ENV=production
ENV PORT=4000
ENV CLIENT_DIST=/app/client/dist
WORKDIR /app/server
EXPOSE 4000
CMD ["node", "src/index.js"]
