## Multi-stage Dockerfile: build Frontend, then run Backend
FROM node:18-alpine AS builder
WORKDIR /app

# Install frontend deps
COPY Frontend/package.json Frontend/package-lock.json* ./Frontend/
RUN npm ci --prefix Frontend || npm install --prefix Frontend

# Copy source and build frontend into Backend/public
COPY Frontend ./Frontend
COPY Backend ./Backend
RUN npm run build --prefix Frontend

FROM node:18-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Install backend production deps
COPY Backend/package.json ./Backend/package.json
RUN npm ci --prefix Backend --omit=dev || npm install --prefix Backend --production

# Copy backend source (includes built public)
COPY --from=builder /app/Backend ./Backend

EXPOSE 4000
CMD ["node", "Backend/server.js"]
