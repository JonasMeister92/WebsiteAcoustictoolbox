# SQM backend

The API and static site are deliberately served separately. The API must never expose the repository root as a static directory.

## Local development

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
.venv\Scripts\python.exe -m uvicorn backend.app:app --host 127.0.0.1 --port 8001
```

Serve the static website separately on port 8000. The frontend automatically uses `http://127.0.0.1:8001` locally.

The analyzer calls `POST /api/sqm/analyze` once per metric in this order: loudness, sharpness, roughness and tonality. The first response returns an `analysisId`; subsequent steps send it back so the complete sequence consumes one daily file allowance. Each metric has its own processing timeout, and a failed metric does not discard results from completed steps.

## Required production configuration

```text
AT_ENV=production
AT_VISITOR_SECRET=<at least 32 random bytes>
AT_ALLOWED_HOSTS=api.acoustictoolbox.com
AT_ALLOWED_ORIGINS=https://acoustictoolbox.com
AT_USAGE_DB=/data/usage.sqlite3
AT_PROCESSING_TIMEOUT=90
```

Do not commit the secret. Terminate TLS at the hosting platform or a trusted reverse proxy. The proxy must enforce a 50 MB body limit, request timeouts, and an additional IP rate limit. Trust forwarded client-IP headers only when the API cannot be reached except through that proxy.

Run only one container instance while SQLite stores quotas. Move quota state to a managed database or Redis before horizontal scaling.

## Implemented protections

- Strict host and CORS allowlists
- Required UUID visitor header plus visitor, IP and burst quotas
- Bounded upload reads and WAV metadata validation
- Duration, sample-rate, channel, calibration and output limits
- Two concurrent analyses at most
- Isolated child process with a hard timeout and termination
- Generic public errors with server-side correlation IDs
- No-store API responses and restrictive browser security headers
- No persistent audio storage
- Production startup fails when the visitor secret is missing or shorter than 32 characters
