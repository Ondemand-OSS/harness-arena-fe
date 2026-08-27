# Standalone container for this frontend, for any Docker-based host.
# Vercel itself doesn't need this — it builds the Vite project natively
# from vercel.json — but it's here so the same repo can also be deployed
# anywhere else that only speaks "give me a Dockerfile."
#
# VITE_API_BASE (the backend's public URL, e.g.
# https://your-backend.example.com — see src/api.js) must be supplied as a
# build ARG, not a runtime env var: Vite bakes it into the JS bundle at
# build time, so it has to be present during `npm run build`, not after.
#   docker build --build-arg VITE_API_BASE=https://your-backend.example.com .

FROM node:18-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_BASE
ENV VITE_API_BASE=${VITE_API_BASE}
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
# SPA fallback: any path that isn't a real static file resolves to
# index.html, so a hard refresh on e.g. /arena or /eval/:id still works —
# same rule vercel.json's rewrite encodes for the Vercel deploy path.
RUN printf 'server {\n\
    listen 8080;\n\
    root /usr/share/nginx/html;\n\
    location / {\n\
        try_files $uri /index.html;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
