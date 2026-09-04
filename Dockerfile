# Production image for the Render free test service.
# The React bundle and FastAPI API are served by one process/origin.
FROM node:22-bookworm-slim AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm run build

FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=10000
WORKDIR /app

COPY requirements.lock ./
# requirements.lock is resolved on Windows and contains the Windows-only
# pywin32 wheel. All runtime dependencies remain pinned; that platform-only
# entry is omitted for the Linux Render image.
RUN sed '/^pywin32==/d' requirements.lock > /tmp/requirements.render.lock \
    && pip install --no-cache-dir -r /tmp/requirements.render.lock \
    && rm -f /tmp/requirements.render.lock

COPY src/ ./src/
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
COPY data/samples/ ./data/samples/
COPY pyproject.toml README.md ./

EXPOSE 10000
CMD ["sh", "-c", "exec uvicorn src.api.main:app --host 0.0.0.0 --port ${PORT:-10000} --workers 1"]
