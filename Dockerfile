# --- build stage ---
FROM node:24.14.0-alpine3.23 AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- runtime stage ---
FROM node:24.14.0-alpine3.23 AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node public ./public
USER node
EXPOSE 8080
# Dependency-aware healthcheck against the /ready endpoint.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||8080)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
