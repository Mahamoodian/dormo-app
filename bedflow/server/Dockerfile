FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY src ./src
USER node
EXPOSE 4000
CMD ["sh", "-c", "node src/db/migrate.js && node src/db/seed.js && node src/index.js"]
