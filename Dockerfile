FROM node:20-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

FROM base AS deps
RUN apk add --no-cache libc6-compat
COPY package*.json ./
RUN npm ci --include=dev

FROM deps AS builder
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN addgroup -S nextjs && adduser -S nextjs -G nextjs
COPY --chown=nextjs:nextjs --from=builder /app/public ./public
COPY --chown=nextjs:nextjs --from=builder /app/.next ./.next
COPY --chown=nextjs:nextjs --from=builder /app/node_modules ./node_modules
COPY --chown=nextjs:nextjs --from=builder /app/package.json ./package.json
USER nextjs
EXPOSE 3000
CMD ["npm", "run", "start"]
