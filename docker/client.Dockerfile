FROM node:24-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY client ./client

EXPOSE 5173
CMD ["npm", "run", "dev:client", "--", "--host", "0.0.0.0"]
