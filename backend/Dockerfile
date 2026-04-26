FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
RUN mkdir -p data

# Force cache bust for redeployments
ARG BUILD_DATE=default
ARG CACHE_BUST=2
RUN echo "Build date: ${BUILD_DATE} cache: ${CACHE_BUST}"

ENV PORT=8787
ENV HOST=0.0.0.0

EXPOSE 8787

CMD ["npm", "start"]
