from __future__ import annotations

import asyncio
import hashlib
import io
import os
import sqlite3
import uuid
from concurrent.futures import ProcessPoolExecutor
from datetime import date
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = Path(os.getenv("AT_USAGE_DB", ROOT / "backend" / "usage.sqlite3"))
MAX_DURATION_SECONDS = 30
MAX_FILE_BYTES = 50 * 1024 * 1024
DAILY_FREE_FILES = 3
POOL = ProcessPoolExecutor(max_workers=max(1, min(2, (os.cpu_count() or 2) - 1)))

app = FastAPI(title="Acoustic Toolbox SQM API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:8000", "http://127.0.0.1:8000", "https://acoustictoolbox.com"], allow_methods=["GET", "POST"], allow_headers=["Content-Type", "X-Visitor-ID"])


def database() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.execute("CREATE TABLE IF NOT EXISTS sqm_usage (request_id TEXT PRIMARY KEY, visitor_hash TEXT NOT NULL, day TEXT NOT NULL, status TEXT NOT NULL)")
    connection.execute("CREATE INDEX IF NOT EXISTS sqm_usage_visitor_day ON sqm_usage(visitor_hash, day)")
    return connection


def visitor_key(request: Request, visitor_id: str | None) -> str:
    token = visitor_id if visitor_id and 16 <= len(visitor_id) <= 128 else "anonymous"
    address = request.client.host if request.client else "unknown"
    secret = os.getenv("AT_VISITOR_SECRET", "development-only-change-me")
    return hashlib.sha256(f"{secret}|{address}|{token}".encode()).hexdigest()


def usage(visitor_hash: str) -> int:
    with database() as db:
        return int(db.execute("SELECT count(*) FROM sqm_usage WHERE visitor_hash=? AND day=? AND status IN ('processing','complete')", (visitor_hash, date.today().isoformat())).fetchone()[0])


def reserve(visitor_hash: str) -> str:
    request_id = str(uuid.uuid4())
    with database() as db:
        db.execute("BEGIN IMMEDIATE")
        used = db.execute("SELECT count(*) FROM sqm_usage WHERE visitor_hash=? AND day=? AND status IN ('processing','complete')", (visitor_hash, date.today().isoformat())).fetchone()[0]
        if used >= DAILY_FREE_FILES:
            raise HTTPException(429, "Daily free limit reached. Try again tomorrow.")
        db.execute("INSERT INTO sqm_usage VALUES (?,?,?,?)", (request_id, visitor_hash, date.today().isoformat(), "processing"))
    return request_id


def finish(request_id: str, successful: bool) -> None:
    with database() as db:
        if successful: db.execute("UPDATE sqm_usage SET status='complete' WHERE request_id=?", (request_id,))
        else: db.execute("DELETE FROM sqm_usage WHERE request_id=?", (request_id,))


def series(time, values, maximum=1000):
    time, values = np.asarray(time).ravel(), np.asarray(values).ravel()
    step = max(1, int(np.ceil(len(time) / maximum)))
    return {"time": np.nan_to_num(time[::step]).tolist(), "values": np.nan_to_num(values[::step]).tolist()}


def analyze_audio(raw: bytes, channel: str, calibration_mode: str, calibration_value: float, field_type: str):
    from mosqito.sq_metrics import loudness_zwtv, pr_ecma_st, roughness_dw, sharpness_din_from_loudness

    audio, fs = sf.read(io.BytesIO(raw), dtype="float64", always_2d=True)
    if channel == "mix": digital = np.mean(audio, axis=1)
    else:
        index = int(channel)
        if index < 0 or index >= audio.shape[1]: raise ValueError("Selected channel does not exist.")
        digital = audio[:, index]
    if len(digital) / fs > MAX_DURATION_SECONDS + 1 / fs: raise ValueError(f"Audio must not exceed {MAX_DURATION_SECONDS} seconds.")
    if calibration_mode == "known_level":
        rms = float(np.sqrt(np.mean(digital ** 2)))
        if rms <= 0: raise ValueError("A silent file cannot be calibrated.")
        pressure = digital * (20e-6 * 10 ** (calibration_value / 20) / rms)
    elif calibration_mode == "pa_per_fs": pressure = digital * calibration_value
    else: raise ValueError("Unknown calibration mode.")
    if calibration_value <= 0 or not np.all(np.isfinite(pressure)): raise ValueError("Calibration and audio values must be finite and positive.")

    loudness, specific, bark, loudness_time = loudness_zwtv(pressure, fs=fs, field_type=field_type)
    sharpness = sharpness_din_from_loudness(loudness, specific, weighting="din")
    roughness, _, _, roughness_time = roughness_dw(pressure, fs=fs, overlap=.5)
    total_pr, pr, prominent, tone_frequencies = pr_ecma_st(pressure, fs=fs, prominence=True)
    loudness, sharpness, roughness = map(np.asarray, (loudness, sharpness, roughness))
    tones = [{"frequencyHz": float(f), "prominenceRatioDb": float(v)} for f, v in zip(np.asarray(tone_frequencies).ravel(), np.asarray(pr).ravel())]
    return {
        "input": {"sampleRateHz": int(fs), "channels": int(audio.shape[1]), "durationSeconds": len(digital) / fs, "fieldType": field_type},
        "summary": {"loudnessMeanSone": float(np.mean(loudness)), "loudnessN5Sone": float(np.percentile(loudness, 95)), "sharpnessMeanAcum": float(np.mean(sharpness)), "roughnessMeanAsper": float(np.mean(roughness)), "prominenceRatioDb": float(np.max(np.asarray(total_pr))) if np.size(total_pr) else 0.0, "prominentToneCount": len(tones)},
        "curves": {"loudness": series(loudness_time, loudness), "sharpness": series(loudness_time, sharpness), "roughness": series(roughness_time, roughness)},
        "specificLoudness": {"bark": np.asarray(bark).ravel().tolist(), "mean": np.mean(np.asarray(specific), axis=1).ravel().tolist()}, "tones": tones,
        "methods": {"loudness": "ISO 532-1:2017 Zwicker", "sharpness": "DIN 45692", "roughness": "Daniel–Weber", "tonality": "ECMA-418-1 prominence ratio", "engine": "MoSQITo 1.2.1"}
    }


@app.get("/api/sqm/health")
def health(): return {"status": "ok", "maximumDurationSeconds": MAX_DURATION_SECONDS, "dailyFreeFiles": DAILY_FREE_FILES}


@app.get("/api/sqm/usage")
def get_usage(request: Request, x_visitor_id: str | None = Header(default=None)):
    used = usage(visitor_key(request, x_visitor_id)); return {"used": used, "remaining": max(0, DAILY_FREE_FILES - used), "limit": DAILY_FREE_FILES}


@app.post("/api/sqm/analyze")
async def analyze(request: Request, audio: UploadFile = File(), channel: str = Form("mix"), calibration_mode: str = Form("known_level"), calibration_value: float = Form(70), field_type: str = Form("free"), x_visitor_id: str | None = Header(default=None)):
    if field_type not in {"free", "diffuse"}: raise HTTPException(400, "Invalid sound field.")
    raw = await audio.read(MAX_FILE_BYTES + 1)
    if len(raw) > MAX_FILE_BYTES: raise HTTPException(413, "File exceeds 50 MB.")
    if not (raw.startswith(b"RIFF") or raw.startswith(b"RF64")): raise HTTPException(415, "Please upload an uncompressed WAV file.")
    visitor_hash = visitor_key(request, x_visitor_id); request_id = reserve(visitor_hash)
    try:
        result = await asyncio.get_running_loop().run_in_executor(POOL, analyze_audio, raw, channel, calibration_mode, calibration_value, field_type)
        finish(request_id, True); result["quota"] = {"used": usage(visitor_hash), "remaining": max(0, DAILY_FREE_FILES - usage(visitor_hash)), "limit": DAILY_FREE_FILES}; return result
    except ValueError as error:
        finish(request_id, False); raise HTTPException(400, str(error)) from error
    except Exception as error:
        finish(request_id, False); raise HTTPException(500, f"SQM calculation failed: {error}") from error


app.mount("/", StaticFiles(directory=ROOT, html=True), name="site")
