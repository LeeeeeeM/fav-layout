FROM node:24-alpine AS frontend-builder

WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
COPY frontend/ ./
RUN npm run build

FROM golang:1.24-alpine AS backend-builder

ARG TARGETOS
ARG TARGETARCH

WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH} go build -o /out/server ./cmd/server
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH} go build -o /out/migrate ./cmd/migrate

FROM openresty/openresty:alpine

RUN apk add --no-cache tzdata && adduser -D -H -u 10001 appuser

WORKDIR /app
COPY --from=backend-builder /out/server /app/server
COPY --from=backend-builder /out/migrate /app/migrate
COPY --from=backend-builder /src/backend/migration /app/migration
COPY --from=frontend-builder /src/frontend/dist /usr/local/openresty/nginx/html
COPY deploy/openresty.default.conf /etc/nginx/conf.d/default.conf
COPY deploy/start.sh /app/start.sh
RUN chmod +x /app/start.sh \
    && chown -R appuser:appuser /app /usr/local/openresty/nginx/html \
    && chown -R appuser:appuser /usr/local/openresty/nginx/logs /var/run/openresty 2>/dev/null || true

USER appuser
EXPOSE 80
STOPSIGNAL SIGQUIT

ENTRYPOINT ["/app/start.sh"]
