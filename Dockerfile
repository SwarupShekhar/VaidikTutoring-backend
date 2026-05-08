# ========================================================
# Stage 1: Build & Prune Engine
# ========================================================
FROM node:20-alpine AS builder

# Install required build packages (Prisma/Native compilers need openssl & build tools)
RUN apk add --no-cache openssl

# Create and define application directory
WORKDIR /app

# Copy dependency schemas for deterministic package installs
COPY package*.json ./
COPY prisma ./prisma/

# Install exact production & development dependency packages (clean install)
RUN npm ci

# Copy core application source code
COPY . .

# Generate native Prisma Client binaries
RUN npx prisma generate

# Compile TypeScript sources into deployment distribution
RUN npm run build

# Prune development packages to minimize final container overhead
RUN npm prune --omit=dev

# ========================================================
# Stage 2: Hardened Runtime Environment
# ========================================================
FROM node:20-alpine AS runner

# Set production context indicators
ENV NODE_ENV=production
ENV PORT=3001

# Install standard dynamic libraries required by Prisma's binary engine on Alpine
RUN apk add --no-cache openssl

# Establish sandbox environment root
WORKDIR /app

# Securely copy compiled assets and pruned dependency trees from builder
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package*.json ./
COPY --from=builder --chown=node:node /app/prisma ./prisma

# Relinquish superuser permissions; execute process as non-privileged 'node' user
USER node

# Expose backend service port
EXPOSE 3001

# Fire up NestJS production application
CMD ["npm", "run", "start:prod"]

