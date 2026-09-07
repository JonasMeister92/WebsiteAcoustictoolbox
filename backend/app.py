from __future__ import annotations

import asyncio
import hashlib
import io
import logging
import math
import multiprocessing
import os
import sqlite3
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = Path(os.getenv("AT_USAGE_DB", ROOT / "backend" / "usage.sqlite3"))
ENVIRONMENT = os.getenv("AT_ENV", "development").lower()
CONFIGURED_VISITOR_SECRET = os.getenv("AT_VISITOR_SECRET")
MAX_DURATION_SECONDS = 10
MAX_FILE_BYTES = 50 * 1024 * 1024
MAX_SAMPLE_RATE = 192_000
MAX_CHANNELS = 8
MAX_PROCESSING_SECONDS = int(os.getenv("AT_PROCESSING_TIMEOUT", "90"))
DAILY_FREE_FILES = 3
DAILY_IP_CAP = 12
BURST_IP_CAP = 4
ANALYSIS_SLOTS = asyncio.Semaphore(2)
LOGGER = logging.getLogger("acoustictoolbox.sqm")

if ENVIRONMENT == "production" and (not CONFIGURED_VISITOR_SECRET or len(CONFIGURED_VISITOR_SECRET) < 32):
    raise RuntimeError("AT_VISITOR_SECRET must contain at least 32 random characters in production.")
VISITOR_SECRET = CONFIGURED_VISITOR_SECRET or uuid.uuid4().hex


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()"
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://127.0.0.1:8001; media-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
        if request.url.path.startswith("/api/"): response.headers["Cache-Control"] = "no-store"
        if ENVIRONMENT == "production": response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
        return response


app = FastAPI(title="Acoustic Toolbox SQM API", version="0.2.0", docs_url=None if ENVIRONMENT == "production" else "/api/docs", redoc_url=None, openapi_url=None if ENVIRONMENT == "production" else "/api/openapi.json")
allowed_hosts = [value.strip() for value in os.getenv("AT_ALLOWED_HOSTS", "localhost,127.0.0.1,acoustictoolbox.com,www.acoustictoolbox.com").split(",") if value.strip()]
allowed_origins = [value.strip() for value in os.getenv("AT_ALLOWED_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000,https://acoustictoolbox.com").split(",") if value.strip()]
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts)
app.add_middleware(CORSMiddleware, allow_origins=allowed_origins, allow_credentials=False, allow_methods=["GET", "POST"], allow_headers=["Content-Type", "X-Visitor-ID"], max_age=600)


def database() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=10, isolation_level=None)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("CREATE TABLE IF NOT EXISTS sqm_usage_v2 (request_id TEXT PRIMARY KEY, visitor_hash TEXT NOT NULL, ip_hash TEXT NOT NULL, day TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL)")
    connection.execute("CREATE INDEX IF NOT EXISTS sqm_usage_v2_visitor_day ON sqm_usage_v2(visitor_hash, day)")
    connection.execute("CREATE INDEX IF NOT EXISTS sqm_usage_v2_ip_day ON sqm_usage_v2(ip_hash, day)")
    connection.execute("DELETE FROM sqm_usage_v2 WHERE created_at < ?", ((datetime.now(UTC) - timedelta(days=8)).isoformat(),))
    return connection


def validated_visitor_id(value: str | None) -> str:
    try: return str(uuid.UUID(value or ""))
    except (ValueError, AttributeError) as error: raise HTTPException(400, "A valid visitor identifier is required.") from error


def identities(request: Request, visitor_id: str | None) -> tuple[str, str]:
    token, address = validated_visitor_id(visitor_id), request.client.host if request.client else "unknown"
    visitor_hash = hashlib.sha256(f"{VISITOR_SECRET}|visitor|{token}".encode()).hexdigest()
    ip_hash = hashlib.sha256(f"{VISITOR_SECRET}|ip|{address}".encode()).hexdigest()
    return visitor_hash, ip_hash


def usage(visitor_hash: str) -> int:
    with database() as db:
        return int(db.execute("SELECT count(*) FROM sqm_usage_v2 WHERE visitor_hash=? AND day=? AND status!='failed'", (visitor_hash, datetime.now(UTC).date().isoformat())).fetchone()[0])


def reserve(visitor_hash: str, ip_hash: str) -> str:
    request_id, now = str(uuid.uuid4()), datetime.now(UTC)
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        visitor_used = db.execute("SELECT count(*) FROM sqm_usage_v2 WHERE visitor_hash=? AND day=? AND status!='failed'", (visitor_hash, now.date().isoformat())).fetchone()[0]
        ip_used = db.execute("SELECT count(*) FROM sqm_usage_v2 WHERE ip_hash=? AND day=? AND status!='failed'", (ip_hash, now.date().isoformat())).fetchone()[0]
        burst_used = db.execute("SELECT count(*) FROM sqm_usage_v2 WHERE ip_hash=? AND created_at>=? AND status!='failed'", (ip_hash, (now - timedelta(minutes=10)).isoformat())).fetchone()[0]
        if visitor_used >= DAILY_FREE_FILES: raise HTTPException(429, "Daily free limit reached. Try again tomorrow.")
        if ip_used >= DAILY_IP_CAP or burst_used >= BURST_IP_CAP: raise HTTPException(429, "Too many analyses from this network. Please try again later.")
        db.execute("INSERT INTO sqm_usage_v2 VALUES (?,?,?,?,?,?)", (request_id, visitor_hash, ip_hash, now.date().isoformat(), now.isoformat(), "processing"))
    return request_id


def finish(request_id: str, successful: bool) -> None:
    with database() as db:
        if successful: db.execute("UPDATE sqm_usage_v2 SET status='complete' WHERE request_id=?", (request_id,))
        else: db.execute("DELETE FROM sqm_usage_v2 WHERE request_id=?", (request_id,))


def series(time, values, maximum=1000):
    time, values = np.asarray(time).ravel(), np.asarray(values).ravel()
    step = max(1, int(np.ceil(len(time) / maximum)))
    return {"time": np.nan_to_num(time[::step]).tolist(), "values": np.nan_to_num(values[::step]).tolist()}


def validate_audio_container(raw: bytes):
    try: info = sf.info(io.BytesIO(raw))
    except Exception as error: raise HTTPException(400, "The WAV file is invalid or unsupported.") from error
    if info.format != "WAV": raise HTTPException(415, "Only WAV containers are accepted.")
    if not 8_000 <= info.samplerate <= MAX_SAMPLE_RATE: raise HTTPException(400, f"Sample rate must be between 8 kHz and {MAX_SAMPLE_RATE // 1000} kHz.")
    if not 1 <= info.channels <= MAX_CHANNELS: raise HTTPException(400, f"Audio must contain between 1 and {MAX_CHANNELS} channels.")
    if info.duration <= 0 or info.duration > MAX_DURATION_SECONDS + 1 / info.samplerate: raise HTTPException(400, f"Audio must not exceed {MAX_DURATION_SECONDS} seconds.")


def analyze_metric(raw: bytes, channel: str, calibration_mode: str, calibration_value: float, field_type: str, metric: str):
    from mosqito.sq_metrics import loudness_zwtv, pr_ecma_st, roughness_dw, sharpness_din_from_loudness
    audio, fs = sf.read(io.BytesIO(raw), dtype="float64", always_2d=True)
    if channel == "mix": digital = np.mean(audio, axis=1)
    else:
        index = int(channel)
        if index < 0 or index >= audio.shape[1]: raise ValueError("Selected channel does not exist.")
        digital = audio[:, index]
    if calibration_mode == "known_level":
        rms = float(np.sqrt(np.mean(digital ** 2)))
        if rms <= 0: raise ValueError("A silent file cannot be calibrated.")
        pressure = digital * (20e-6 * 10 ** (calibration_value / 20) / rms)
    else: pressure = digital * calibration_value
    if not np.all(np.isfinite(pressure)): raise ValueError("Audio contains invalid values.")
    result = {"metric": metric, "input": {"sampleRateHz": int(fs), "channels": int(audio.shape[1]), "durationSeconds": len(digital) / fs, "fieldType": field_type}, "summary": {}, "curves": {}, "tones": [], "methods": {"engine": "MoSQITo 1.2.1"}}
    if metric == "loudness":
        loudness, specific, bark, metric_time = loudness_zwtv(pressure, fs=fs, field_type=field_type)
        loudness = np.asarray(loudness)
        result["summary"] = {"loudnessMeanSone": float(np.mean(loudness)), "loudnessN5Sone": float(np.percentile(loudness, 95))}
        result["curves"][metric] = series(metric_time, loudness)
        result["specificLoudness"] = {"bark": np.asarray(bark).ravel().tolist(), "mean": np.mean(np.asarray(specific), axis=1).ravel().tolist()}
        result["methods"][metric] = "ISO 532-1:2017 Zwicker"
    elif metric == "sharpness":
        loudness, specific, _, metric_time = loudness_zwtv(pressure, fs=fs, field_type=field_type)
        values = np.asarray(sharpness_din_from_loudness(loudness, specific, weighting="din"))
        result["summary"] = {"sharpnessMeanAcum": float(np.mean(values))}
        result["curves"][metric] = series(metric_time, values)
        result["methods"][metric] = "DIN 45692"
    elif metric == "roughness":
        values, _, _, metric_time = roughness_dw(pressure, fs=fs, overlap=.5)
        values = np.asarray(values)
        result["summary"] = {"roughnessMeanAsper": float(np.mean(values))}
        result["curves"][metric] = series(metric_time, values)
        result["methods"][metric] = "Daniel-Weber"
    elif metric == "tonality":
        total_pr, prominence, _, frequencies = pr_ecma_st(pressure, fs=fs, prominence=True)
        tones = [{"frequencyHz": float(f), "prominenceRatioDb": float(v)} for f, v in zip(np.asarray(frequencies).ravel(), np.asarray(prominence).ravel())]
        result["summary"] = {"prominenceRatioDb": float(np.max(np.asarray(total_pr))) if np.size(total_pr) else 0.0, "prominentToneCount": len(tones)}
        result["tones"] = tones
        result["methods"][metric] = "ECMA-418-1 prominence ratio"
    else:
        raise ValueError("Unknown metric.")
    return result


def worker(connection, arguments):
    try: connection.send((True, analyze_metric(*arguments)))
    except Exception as error: connection.send((False, type(error).__name__, str(error)))
    finally: connection.close()


def isolated_analysis(arguments):
    context = multiprocessing.get_context("spawn")
    receive, send = context.Pipe(duplex=False)
    process = context.Process(target=worker, args=(send, arguments), daemon=True)
    process.start(); send.close()
    try:
        if not receive.poll(MAX_PROCESSING_SECONDS):
            process.terminate(); process.join(5)
            if process.is_alive(): process.kill()
            raise TimeoutError("SQM calculation exceeded its time limit.")
        message = receive.recv(); process.join(5)
        if message[0]: return message[1]
        if message[1] == "ValueError": raise ValueError(message[2])
        raise RuntimeError(message[2])
    finally:
        receive.close()
        if process.is_alive(): process.terminate()


@app.get("/api/sqm/health")
def health(): return {"status": "ok", "maximumDurationSeconds": MAX_DURATION_SECONDS, "dailyFreeFiles": DAILY_FREE_FILES}


@app.get("/api/sqm/usage")
def get_usage(request: Request, x_visitor_id: str | None = Header(default=None)):
    visitor_hash, _ = identities(request, x_visitor_id); used = usage(visitor_hash)
    return {"used": used, "remaining": max(0, DAILY_FREE_FILES - used), "limit": DAILY_FREE_FILES}


@app.post("/api/sqm/analyze")
async def analyze(request: Request, audio: UploadFile = File(), channel: str = Form("mix"), calibration_mode: str = Form("known_level"), calibration_value: float = Form(70), field_type: str = Form("free"), metric: str = Form("loudness"), analysis_id: str | None = Form(None), x_visitor_id: str | None = Header(default=None)):
    if field_type not in {"free", "diffuse"}: raise HTTPException(400, "Invalid sound field.")
    if calibration_mode not in {"known_level", "pa_per_fs"}: raise HTTPException(400, "Invalid calibration method.")
    if not math.isfinite(calibration_value) or calibration_value <= 0 or (calibration_mode == "known_level" and calibration_value > 180) or (calibration_mode == "pa_per_fs" and calibration_value > 1_000_000): raise HTTPException(400, "Calibration value is outside the accepted range.")
    if channel != "mix" and (not channel.isdigit() or len(channel) > 2): raise HTTPException(400, "Invalid channel selection.")
    raw = await audio.read(MAX_FILE_BYTES + 1); await audio.close()
    if len(raw) > MAX_FILE_BYTES: raise HTTPException(413, "File exceeds 50 MB.")
    if not (raw.startswith(b"RIFF") or raw.startswith(b"RF64")): raise HTTPException(415, "Please upload a WAV file.")
    validate_audio_container(raw)
    if metric not in {"loudness", "sharpness", "roughness", "tonality"}: raise HTTPException(400, "Invalid metric.")
    visitor_hash, ip_hash = identities(request, x_visitor_id)
    if metric == "loudness": request_id = reserve(visitor_hash, ip_hash)
    else:
        try: request_id = str(uuid.UUID(analysis_id or ""))
        except ValueError as error: raise HTTPException(400, "A valid analysis identifier is required.") from error
        expected = {"sharpness": "loudness", "roughness": "sharpness", "tonality": "roughness"}[metric]
        with database() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT status FROM sqm_usage_v2 WHERE request_id=? AND visitor_hash=?", (request_id, visitor_hash)).fetchone()
            if not row or row[0] != expected: raise HTTPException(409, "This analysis step is missing or was already calculated.")
            db.execute("UPDATE sqm_usage_v2 SET status=? WHERE request_id=?", (f"processing_{metric}", request_id))
    try:
        async with ANALYSIS_SLOTS: result = await asyncio.to_thread(isolated_analysis, (raw, channel, calibration_mode, calibration_value, field_type, metric))
    except ValueError as error:
        result = {"metric": metric, "error": str(error)}
    except TimeoutError:
        result = {"metric": metric, "error": f"{metric.capitalize()} exceeded its processing time limit."}
    except Exception:
        LOGGER.exception("SQM metric failed; request_id=%s metric=%s", request_id, metric)
        result = {"metric": metric, "error": f"{metric.capitalize()} could not be calculated. Reference: {request_id}"}
    next_status = "complete" if metric == "tonality" else metric
    with database() as db: db.execute("UPDATE sqm_usage_v2 SET status=? WHERE request_id=? AND visitor_hash=?", (next_status, request_id, visitor_hash))
    used = usage(visitor_hash)
    result["analysisId"] = request_id
    result["quota"] = {"used": used, "remaining": max(0, DAILY_FREE_FILES - used), "limit": DAILY_FREE_FILES}
    return result
