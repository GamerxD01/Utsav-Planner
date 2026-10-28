# Small, non-root production image for Cloud Run.
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Zero runtime dependencies: only the manifest, source and static assets are copied.
COPY package.json ./
COPY src ./src
COPY public ./public

USER node
EXPOSE 8080
CMD ["node", "src/server.js"]
