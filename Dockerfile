FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY assets/images ./assets/images
EXPOSE 4000
CMD ["node", "src/server.js"]
