from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import mimetypes
import os
import secrets
import time
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote, urlparse

import boto3
import psycopg
from botocore.config import Config
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from psycopg.rows import dict_row
from pydantic import BaseModel

from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger("skyhop")

ROOT = Path(__file__).resolve().parent
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
APP_SECRET = os.getenv("APP_SECRET_KEY", "")
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "").strip()
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() in {"1", "true", "yes"}
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID", "")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY", "")
AWS_ENDPOINT_URL_S3 = os.getenv("AWS_ENDPOINT_URL_S3", "").rstrip("/")
AWS_REGION = os.getenv("AWS_REGION", "")
S3_BUCKET_NAME = os.getenv("S3_BUCKET_NAME", "skyhop-assets")

SESSION_TTL = 60 * 60 * 12
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_AUDIO_BYTES = 20 * 1024 * 1024

ASSET_RULES = {
    "character": {"kind": "image", "extensions": {".png", ".jpg", ".jpeg", ".webp", ".gif"}, "max": MAX_IMAGE_BYTES},
    "game_over_image": {"kind": "image", "extensions": {".png", ".jpg", ".jpeg", ".webp", ".gif"}, "max": MAX_IMAGE_BYTES},
    "flap_sound": {"kind": "audio", "extensions": {".mp3", ".wav", ".ogg", ".m4a", ".aac"}, "max": MAX_AUDIO_BYTES},
    "collision_sound": {"kind": "audio", "extensions": {".mp3", ".wav", ".ogg", ".m4a", ".aac"}, "max": MAX_AUDIO_BYTES},
}

app = FastAPI(title="Sky Hop", docs_url=None, redoc_url=None)
AUTH_ATTEMPTS: dict[str, list[int]] = {}


class LoginBody(BaseModel):
    username: str
    password: str


class AdminSettingsBody(BaseModel):
    game_over_opacity: int


@contextmanager
def db():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not configured.")
    with psycopg.connect(DATABASE_URL, row_factory=dict_row, connect_timeout=10) as conn:
        yield conn


@lru_cache(maxsize=1)
def s3_client():
    required = {
        "AWS_ACCESS_KEY_ID": AWS_ACCESS_KEY_ID,
        "AWS_SECRET_ACCESS_KEY": AWS_SECRET_ACCESS_KEY,
        "AWS_ENDPOINT_URL_S3": AWS_ENDPOINT_URL_S3,
        "AWS_REGION": AWS_REGION,
        "S3_BUCKET_NAME": S3_BUCKET_NAME,
    }
    missing = [name for name, value in required.items() if not value]
    if missing:
        raise RuntimeError(f"Missing object-storage configuration: {', '.join(missing)}")
    return boto3.client(
        "s3",
        region_name=AWS_REGION,
        endpoint_url=AWS_ENDPOINT_URL_S3,
        aws_access_key_id=AWS_ACCESS_KEY_ID,
        aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
        config=Config(s3={"addressing_style": "path"}),
    )


def object_url(key: str) -> str:
    # Neon public_read buckets serve objects at endpoint/bucket/key.
    return f"{AWS_ENDPOINT_URL_S3}/{quote(S3_BUCKET_NAME, safe='')}/{quote(key, safe='/')}"


def require_runtime_config() -> None:
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL must point to your Neon PostgreSQL database.")
    if len(APP_SECRET) < 32:
        raise RuntimeError("APP_SECRET_KEY must be a random value of at least 32 characters.")
    s3_client()


def pbkdf2_hash(value: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", value.encode("utf-8"), salt, 310_000)
    return f"pbkdf2_sha256${base64.urlsafe_b64encode(salt).decode()}${base64.urlsafe_b64encode(digest).decode()}"


def pbkdf2_verify(value: str, stored: str) -> bool:
    try:
        algorithm, salt_b64, digest_b64 = stored.split("$", 2)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = base64.urlsafe_b64decode(salt_b64.encode())
        expected = base64.urlsafe_b64decode(digest_b64.encode())
        actual = hashlib.pbkdf2_hmac("sha256", value.encode("utf-8"), salt, 310_000)
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def initialize_database() -> None:
    require_runtime_config()
    with db() as conn:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS admins (
                username TEXT PRIMARY KEY,
                password_hash TEXT NOT NULL,
                created_at BIGINT NOT NULL
            )"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS admin_sessions (
                token_hash TEXT PRIMARY KEY,
                username TEXT NOT NULL REFERENCES admins(username) ON DELETE CASCADE,
                expires_at BIGINT NOT NULL,
                created_at BIGINT NOT NULL
            )"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS assets (
                kind TEXT PRIMARY KEY,
                object_key TEXT NOT NULL,
                original_name TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                updated_at BIGINT NOT NULL
            )"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS app_settings (
                setting_key TEXT PRIMARY KEY,
                setting_value TEXT NOT NULL
            )"""
        )
        existing = conn.execute("SELECT username FROM admins LIMIT 1").fetchone()
        if not existing:
            if not ADMIN_USERNAME or len(ADMIN_PASSWORD) < 12:
                raise RuntimeError(
                    "First startup requires ADMIN_USERNAME and ADMIN_PASSWORD (at least 12 characters). "
                    "Set them in your local .env file or service environment."
                )
            conn.execute(
                "INSERT INTO admins(username, password_hash, created_at) VALUES (%s, %s, %s)",
                (ADMIN_USERNAME, pbkdf2_hash(ADMIN_PASSWORD), int(time.time())),
            )
        conn.execute(
            "INSERT INTO app_settings(setting_key, setting_value) VALUES (%s, %s) ON CONFLICT(setting_key) DO NOTHING",
            ("game_over_opacity", "65"),
        )
        conn.execute("DELETE FROM admin_sessions WHERE expires_at < %s", (int(time.time()),))


@app.on_event("startup")
def startup() -> None:
    initialize_database()


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Cache-Control"] = "no-store" if request.url.path.startswith("/api/") else "public, max-age=300"
    return response


def enforce_attempt_limit(request: Request, bucket: str, limit: int = 10, window_seconds: int = 600) -> None:
    client_ip = request.client.host if request.client else "unknown"
    key = f"{bucket}:{client_ip}"
    now = int(time.time())
    recent = [stamp for stamp in AUTH_ATTEMPTS.get(key, []) if now - stamp < window_seconds]
    if len(recent) >= limit:
        raise HTTPException(status_code=429, detail="Too many attempts. Wait a few minutes and try again.")
    recent.append(now)
    AUTH_ATTEMPTS[key] = recent


def check_same_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    host = request.headers.get("host")
    if origin and host and urlparse(origin).netloc.lower() != host.lower():
        raise HTTPException(status_code=403, detail="Cross-origin request rejected.")


def get_admin(request: Request) -> str:
    token = request.cookies.get("skyhop_admin")
    if not token:
        raise HTTPException(status_code=401, detail="Admin login required.")
    with db() as conn:
        row = conn.execute(
            "SELECT username, expires_at FROM admin_sessions WHERE token_hash = %s",
            (token_hash(token),),
        ).fetchone()
    if not row or row["expires_at"] < int(time.time()):
        raise HTTPException(status_code=401, detail="Admin session expired.")
    return str(row["username"])


def public_asset_map() -> dict:
    with db() as conn:
        rows = conn.execute("SELECT kind, object_key, original_name, updated_at FROM assets").fetchall()
    assets = {kind: None for kind in ASSET_RULES}
    for row in rows:
        assets[row["kind"]] = {
            "url": object_url(row["object_key"]),
            "name": row["original_name"],
            "updated_at": row["updated_at"],
        }
    return assets


def allowed_signature(ext: str, data: bytes, kind: str) -> bool:
    if kind == "image":
        return (
            (ext == ".png" and data.startswith(b"\x89PNG\r\n\x1a\n"))
            or (ext in {".jpg", ".jpeg"} and data.startswith(b"\xff\xd8\xff"))
            or (ext == ".webp" and len(data) > 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP")
            or (ext == ".gif" and data[:6] in {b"GIF87a", b"GIF89a"})
        )
    return (
        (ext == ".mp3" and (data.startswith(b"ID3") or (len(data) > 1 and data[0] == 0xFF and data[1] & 0xE0 == 0xE0)))
        or (ext == ".wav" and len(data) > 12 and data[:4] == b"RIFF" and data[8:12] == b"WAVE")
        or (ext == ".ogg" and data.startswith(b"OggS"))
        or (ext == ".m4a" and len(data) > 12 and data[4:8] == b"ftyp")
        or (ext == ".aac" and len(data) > 2 and data[0] == 0xFF and (data[1] & 0xF6) == 0xF0)
    )


@app.get("/")
def home():
    return FileResponse(ROOT / "index.html")


@app.get("/admin")
def admin_page():
    return FileResponse(ROOT / "admin.html")


@app.get("/style.css")
def stylesheet():
    return FileResponse(ROOT / "style.css", media_type="text/css")


@app.get("/game.js")
def game_script():
    return FileResponse(ROOT / "game.js", media_type="text/javascript")


@app.get("/admin.js")
def admin_script():
    return FileResponse(ROOT / "admin.js", media_type="text/javascript")


@app.get("/api/health")
def health():
    with db() as conn:
        conn.execute("SELECT 1").fetchone()
    return {"ok": True, "database": "neon-postgresql", "storage": "neon-object-storage"}


@app.get("/api/public/settings")
def public_settings():
    with db() as conn:
        row = conn.execute(
            "SELECT setting_value FROM app_settings WHERE setting_key = %s", ("game_over_opacity",)
        ).fetchone()
    opacity = int(row["setting_value"]) if row else 65
    return {"assets": public_asset_map(), "game_over_opacity": opacity}


@app.post("/api/admin/login")
def admin_login(body: LoginBody, request: Request):
    check_same_origin(request)
    enforce_attempt_limit(request, "admin-login", limit=8)
    with db() as conn:
        row = conn.execute(
            "SELECT username, password_hash FROM admins WHERE username = %s", (body.username.strip(),)
        ).fetchone()
    if not row or not pbkdf2_verify(body.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect username or password.")
    client_ip = request.client.host if request.client else "unknown"
    AUTH_ATTEMPTS.pop(f"admin-login:{client_ip}", None)
    token = secrets.token_urlsafe(36)
    expires = int(time.time()) + SESSION_TTL
    with db() as conn:
        conn.execute(
            "INSERT INTO admin_sessions(token_hash, username, expires_at, created_at) VALUES (%s, %s, %s, %s)",
            (token_hash(token), row["username"], expires, int(time.time())),
        )
    response = JSONResponse({"ok": True, "username": row["username"]})
    response.set_cookie(
        "skyhop_admin", token, httponly=True, secure=COOKIE_SECURE,
        samesite="strict", max_age=SESSION_TTL, path="/",
    )
    return response


@app.get("/api/admin/me")
def admin_me(username: str = Depends(get_admin)):
    return {"ok": True, "username": username}


@app.post("/api/admin/logout")
def admin_logout(request: Request, username: str = Depends(get_admin)):
    check_same_origin(request)
    token = request.cookies.get("skyhop_admin", "")
    with db() as conn:
        conn.execute("DELETE FROM admin_sessions WHERE token_hash = %s", (token_hash(token),))
    response = JSONResponse({"ok": True})
    response.delete_cookie("skyhop_admin", path="/", samesite="strict")
    return response


@app.get("/api/admin/assets")
def admin_assets(username: str = Depends(get_admin)):
    with db() as conn:
        row = conn.execute(
            "SELECT setting_value FROM app_settings WHERE setting_key = %s", ("game_over_opacity",)
        ).fetchone()
    return {"assets": public_asset_map(), "game_over_opacity": int(row["setting_value"]) if row else 65}


@app.post("/api/admin/assets/{kind}")
async def upload_admin_asset(
    kind: str,
    request: Request,
    file: UploadFile = File(...),
    username: str = Depends(get_admin),
):
    check_same_origin(request)
    rule = ASSET_RULES.get(kind)
    if not rule:
        raise HTTPException(status_code=404, detail="Unknown asset type.")
    original_name = Path(file.filename or "upload").name[:120]
    ext = Path(original_name).suffix.lower()
    if ext not in rule["extensions"]:
        raise HTTPException(status_code=415, detail="Unsupported file extension.")
    data = await file.read(rule["max"] + 1)
    await file.close()
    if not data or len(data) > rule["max"]:
        raise HTTPException(status_code=413, detail=f"File must be smaller than {rule['max'] // (1024 * 1024)} MB.")
    if not allowed_signature(ext, data, rule["kind"]):
        raise HTTPException(status_code=415, detail="The file contents do not match the selected file type.")

    object_key = f"defaults/{kind}/{secrets.token_hex(16)}{ext}"
    content_type = mimetypes.guess_type(original_name)[0] or file.content_type or "application/octet-stream"
    client = s3_client()
    try:
        client.put_object(
            Bucket=S3_BUCKET_NAME,
            Key=object_key,
            Body=data,
            ContentType=content_type,
            CacheControl="public, max-age=31536000, immutable",
        )
        with db() as conn:
            old = conn.execute("SELECT object_key FROM assets WHERE kind = %s", (kind,)).fetchone()
            conn.execute(
                "INSERT INTO assets(kind, object_key, original_name, mime_type, updated_at) VALUES (%s, %s, %s, %s, %s) "
                "ON CONFLICT(kind) DO UPDATE SET object_key=excluded.object_key, original_name=excluded.original_name, "
                "mime_type=excluded.mime_type, updated_at=excluded.updated_at",
                (kind, object_key, original_name, content_type, int(time.time())),
            )
    except Exception:
        try:
            client.delete_object(Bucket=S3_BUCKET_NAME, Key=object_key)
        except Exception:
            logger.exception("Failed to clean up an object after an asset upload error.")
        raise

    if old and old["object_key"]:
        try:
            client.delete_object(Bucket=S3_BUCKET_NAME, Key=old["object_key"])
        except Exception:
            logger.exception("Uploaded the replacement asset but could not delete the old object.")
    return {"ok": True, "asset": public_asset_map()[kind]}


@app.delete("/api/admin/assets/{kind}")
def delete_admin_asset(kind: str, request: Request, username: str = Depends(get_admin)):
    check_same_origin(request)
    if kind not in ASSET_RULES:
        raise HTTPException(status_code=404, detail="Unknown asset type.")
    with db() as conn:
        row = conn.execute("SELECT object_key FROM assets WHERE kind = %s", (kind,)).fetchone()
        conn.execute("DELETE FROM assets WHERE kind = %s", (kind,))
    if row and row["object_key"]:
        try:
            s3_client().delete_object(Bucket=S3_BUCKET_NAME, Key=row["object_key"])
        except Exception:
            logger.exception("Could not delete removed asset object from Neon Storage.")
    return {"ok": True, "asset": None}


@app.post("/api/admin/settings")
def save_admin_settings(body: AdminSettingsBody, request: Request, username: str = Depends(get_admin)):
    check_same_origin(request)
    if not 10 <= body.game_over_opacity <= 100:
        raise HTTPException(status_code=422, detail="Image opacity must be between 10 and 100.")
    with db() as conn:
        conn.execute(
            "INSERT INTO app_settings(setting_key, setting_value) VALUES (%s, %s) "
            "ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value",
            ("game_over_opacity", str(body.game_over_opacity)),
        )
    return {"ok": True, "game_over_opacity": body.game_over_opacity}

