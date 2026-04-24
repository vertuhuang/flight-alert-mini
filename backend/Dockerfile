FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY data ./data

ENV PORT=3000
ENV HOST=0.0.0.0
ENV STORE_DRIVER=cloudbase
ENV CLOUDBASE_ENV_ID=cloud1-d3gu5h3dk5e16d52b

EXPOSE 3000

CMD ["npm", "start"]
