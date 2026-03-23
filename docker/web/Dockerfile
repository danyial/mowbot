# docker/web/Dockerfile
FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

RUN apk add --no-cache curl

ENV NODE_ENV=production
ENV PORT=3000

# Next.js standalone output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Custom server mit WebSocket-Proxy (NaN-Sanitization)
COPY --from=builder /app/server.mjs ./server.mjs

EXPOSE 3000
CMD ["node", "server.mjs"]
