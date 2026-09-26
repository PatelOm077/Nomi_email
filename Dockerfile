FROM node:20-alpine AS build
RUN apk add --no-cache openssl

WORKDIR /app

# Prisma validates the datasource while generating its client. Render replaces
# this development-only value with its persistent-disk URL at runtime.
ENV DATABASE_URL=file:dev.sqlite

COPY package.json package-lock.json* ./

RUN npm ci

COPY . .

RUN npx prisma generate && npm run build

FROM node:20-alpine
RUN apk add --no-cache openssl

WORKDIR /app

ENV NODE_ENV=production
ENV DATABASE_URL=file:dev.sqlite

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/build ./build
COPY --from=build /app/app ./app
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/public ./public

EXPOSE 3000

CMD ["npm", "run", "docker-start"]
