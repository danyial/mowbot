# docker/web/Dockerfile
FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# NEXT_PUBLIC_* Variablen werden zur Build-Zeit in den Client-Code eingebettet
ENV NEXT_PUBLIC_ROSBRIDGE_URL=/rosbridge

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

# Custom server braucht das vollstaendige next + ws Package
# (standalone Output enthaelt nur eine abgespeckte Version)
COPY --from=builder /app/node_modules/next ./node_modules/next
COPY --from=builder /app/node_modules/@next ./node_modules/@next
COPY --from=builder /app/node_modules/ws ./node_modules/ws

EXPOSE 3000
CMD ["node", "server.mjs"]
