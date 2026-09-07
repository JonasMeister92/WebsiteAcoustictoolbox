FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    AT_ENV=production \
    AT_USAGE_DB=/data/usage.sqlite3

RUN apt-get update \
    && apt-get install --no-install-recommends -y libsndfile1 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system app \
    && useradd --system --gid app --home-dir /app app

WORKDIR /app
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --requirement requirements.txt
COPY backend/app.py ./backend/app.py
RUN mkdir /data && chown app:app /data

USER app
EXPOSE 8001
CMD ["python", "-m", "uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1", "--no-server-header"]
