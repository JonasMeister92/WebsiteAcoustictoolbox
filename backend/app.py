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
MAX_DURATION_SECONDS = 30
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
        return int(db.execute("SELECT count(*) FROM sqm_usage_v2 WHERE visitor_hash=? AND day=? AND status IN ('processing','complete')", (visitor_hash, datetime.now(UTC).date().isoformat())).fetchone()[0])


def reserve(visitor_hash: str, ip_hash: str) -> str:
    request_id, now = str(uuid.uuid4()), datetime.now(UTC)
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        states = ("processing", "complete")
        visitor_used = db.execute("SELECT count(*) FROM sqm_usage_v2 WHERE visitor_hash=? AND day=? AND status IN (?,?)", (visitor_hash, now.date().isoformat(), *states)).fetchone()[0]
        ip_used = db.execute("SELECT count(*) FROM sqm_usage_v2 WHERE ip_hash=? AND day=? AND status IN (?,?)", (ip_hash, now.date().isoformat(), *states)).fetchone()[0]
        burst_used = db.execute("SELECT count(*) FROM sqm_usage_v2 WHERE ip_hash=? AND created_at>=? AND status IN (?,?)", (ip_hash, (now - timedelta(minutes=10)).isoformat(), *states)).fetchone()[0]
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


def analyze_audio(raw: bytes, channel: str, calibration_mode: str, calibration_value: float, field_type: str):
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
    loudness, specific, bark, loudness_time = loudness_zwtv(pressure, fs=fs, field_type=field_type)
    sharpness = sharpness_din_from_loudness(loudness, specific, weighting="din")
    roughness, _, _, roughness_time = roughness_dw(pressure, fs=fs, overlap=.5)
    total_pr, pr, _, tone_frequencies = pr_ecma_st(pressure, fs=fs, prominence=True)
    loudness, sharpness, roughness = map(np.asarray, (loudness, sharpness, roughness))
    tones = [{"frequencyHz": float(f), "prominenceRatioDb": float(v)} for f, v in zip(np.asarray(tone_frequencies).ravel(), np.asarray(pr).ravel())]
    return {"input": {"sampleRateHz": int(fs), "channels": int(audio.shape[1]), "durationSeconds": len(digital) / fs, "fieldType": field_type}, "summary": {"loudnessMeanSone": float(np.mean(loudness)), "loudnessN5Sone": float(np.percentile(loudness, 95)), "sharpnessMeanAcum": float(np.mean(sharpness)), "roughnessMeanAsper": float(np.mean(roughness)), "prominenceRatioDb": float(np.max(np.asarray(total_pr))) if np.size(total_pr) else 0.0, "prominentToneCount": len(tones)}, "curves": {"loudness": series(loudness_time, loudness), "sharpness": series(loudness_time, sharpness), "roughness": series(roughness_time, roughness)}, "specificLoudness": {"bark": np.asarray(bark).ravel().tolist(), "mean": np.mean(np.asarray(specific), axis=1).ravel().tolist()}, "tones": tones, "methods": {"loudness": "ISO 532-1:2017 Zwicker", "sharpness": "DIN 45692", "roughness": "Daniel-Weber", "tonality": "ECMA-418-1 prominence ratio", "engine": "MoSQITo 1.2.1"}}


def worker(connection, arguments):
    try: connection.send((True, analyze_audio(*arguments)))
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
async def analyze(request: Request, audio: UploadFile = File(), channel: str = Form("mix"), calibration_mode: str = Form("known_level"), calibration_value: float = Form(70), field_type: str = Form("free"), x_visitor_id: str | None = Header(default=None)):
    if field_type not in {"free", "diffuse"}: raise HTTPException(400, "Invalid sound field.")
    if calibration_mode not in {"known_level", "pa_per_fs"}: raise HTTPException(400, "Invalid calibration method.")
    if not math.isfinite(calibration_value) or calibration_value <= 0 or (calibration_mode == "known_level" and calibration_value > 180) or (calibration_mode == "pa_per_fs" and calibration_value > 1_000_000): raise HTTPException(400, "Calibration value is outside the accepted range.")
    if channel != "mix" and (not channel.isdigit() or len(channel) > 2): raise HTTPException(400, "Invalid channel selection.")
    raw = await audio.read(MAX_FILE_BYTES + 1); await audio.close()
    if len(raw) > MAX_FILE_BYTES: raise HTTPException(413, "File exceeds 50 MB.")
    if not (raw.startswith(b"RIFF") or raw.startswith(b"RF64")): raise HTTPException(415, "Please upload a WAV file.")
    validate_audio_container(raw)
    visitor_hash, ip_hash = identities(request, x_visitor_id); request_id = reserve(visitor_hash, ip_hash)
    try:
        async with ANALYSIS_SLOTS: result = await asyncio.to_thread(isolated_analysis, (raw, channel, calibration_mode, calibration_value, field_type))
        finish(request_id, True); used = usage(visitor_hash); result["quota"] = {"used": used, "remaining": max(0, DAILY_FREE_FILES - used), "limit": DAILY_FREE_FILES}; return result
    except ValueError as error:
        finish(request_id, False); raise HTTPException(400, str(error)) from error
    except TimeoutError as error:
        finish(request_id, False); raise HTTPException(504, "The analysis exceeded its processing time limit.") from error
    except Exception:
        finish(request_id, False); LOGGER.exception("SQM analysis failed; request_id=%s", request_id)
        raise HTTPException(500, f"SQM calculation failed. Reference: {request_id}")
