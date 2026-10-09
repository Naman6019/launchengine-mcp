# Builds the server from source and runs it over stdio. Used by registries
# (Glama) to start the server and list its tools; no API key is needed for that.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build && npm run bundle
ENV NODE_ENV=production
ENTRYPOINT ["node", "dist/cli.js"]
