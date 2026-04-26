FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
RUN mkdir -p data

# Force cache bust for redeployments
ARG BUILD_DATE=default
RUN echo "Build date: ${BUILD_DATE}"

ENV PORT=8787
ENV HOST=0.0.0.0

EXPOSE 8787

CMD ["npm", "start"]
