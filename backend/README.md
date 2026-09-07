# SQM backend

Create a virtual environment, install `requirements.txt`, then run from the repository root:

```powershell
uvicorn backend.app:app --host 127.0.0.1 --port 8001
```

For production, set a strong `AT_VISITOR_SECRET`, place the API behind HTTPS and configure the reverse proxy so `/api/` reaches this service. The static site can be served by the same FastAPI app or separately.
