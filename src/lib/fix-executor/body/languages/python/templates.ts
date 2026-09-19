export const SECURITY_HEADERS_PYTHON = `"""Security headers for Flask or FastAPI — register in your app factory."""
from __future__ import annotations

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}


def register_flask_security_headers(app):
    @app.after_request
    def _add_headers(response):
        for key, value in SECURITY_HEADERS.items():
            response.headers[key] = value
        return response


def register_fastapi_security_headers(app):
    from starlette.middleware.base import BaseHTTPMiddleware

    class _SecurityHeadersMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            response = await call_next(request)
            for key, value in SECURITY_HEADERS.items():
                response.headers[key] = value
            return response

    app.add_middleware(_SecurityHeadersMiddleware)
`;

export const CORS_PYTHON = `"""CORS helpers — set ALLOWED_ORIGINS (comma-separated) in production."""
from __future__ import annotations

import os

ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",")]


def cors_headers(origin: str | None) -> dict[str, str]:
    allowed = (
        origin
        if origin and ("*" in ALLOWED_ORIGINS or origin in ALLOWED_ORIGINS)
        else (ALLOWED_ORIGINS[0] if ALLOWED_ORIGINS else "*")
    )
    return {
        "Access-Control-Allow-Origin": allowed,
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
    }


def register_flask_cors(app):
    try:
        from flask_cors import CORS

        CORS(
            app,
            origins=ALLOWED_ORIGINS if "*" not in ALLOWED_ORIGINS else "*",
            methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
            allow_headers=["Content-Type", "Authorization"],
        )
    except ImportError:
        @app.after_request
        def _cors(response):
            origin = None  # set from request.headers.get("Origin") in your view layer
            for key, value in cors_headers(origin).items():
                response.headers[key] = value
            return response


def register_fastapi_cors(app):
    from fastapi.middleware.cors import CORSMiddleware

    wildcard = "*" in ALLOWED_ORIGINS

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"] if wildcard else ALLOWED_ORIGINS,
        # Credentials must never be combined with a wildcard origin. A browser rejects
        # \`Access-Control-Allow-Origin: *\` alongside credentials, so Starlette echoes the
        # caller's own origin back instead — which lets any site issue credentialed
        # cross-origin requests against this API. Set ALLOWED_ORIGINS to your real origins
        # to turn credentials on.
        allow_credentials=not wildcard,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
    )
`;

export const RATE_LIMIT_PYTHON = `"""Simple in-memory rate limiter — use Redis or a gateway for multi-instance production."""
from __future__ import annotations

import time
from collections import defaultdict

WINDOW_SECONDS = 15 * 60
MAX_REQUESTS = 100
_hits: dict[str, list[float]] = defaultdict(list)


def check_rate_limit(client_id: str) -> bool:
    now = time.time()
    window = [t for t in _hits[client_id] if now - t < WINDOW_SECONDS]
    window.append(now)
    _hits[client_id] = window
    return len(window) <= MAX_REQUESTS


def register_flask_rate_limit(app):
    from flask import jsonify, request

    @app.before_request
    def _rate_limit():
        if not check_rate_limit(request.remote_addr or "unknown"):
            return jsonify({"error": "Too many requests"}), 429


def register_fastapi_rate_limit(app):
    from fastapi import Request
    from fastapi.responses import JSONResponse
    from starlette.middleware.base import BaseHTTPMiddleware

    class _RateLimitMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request: Request, call_next):
            client = request.client.host if request.client else "unknown"
            if not check_rate_limit(client):
                return JSONResponse({"error": "Too many requests"}, status_code=429)
            return await call_next(request)

    app.add_middleware(_RateLimitMiddleware)
`;

export const LOGGER_PYTHON = `"""Structured JSON logging."""
from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "level": record.levelname.lower(),
            "message": record.getMessage(),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        return json.dumps(payload)


logger = logging.getLogger("app")
logger.setLevel(logging.INFO)
_handler = logging.StreamHandler(sys.stdout)
_handler.setFormatter(JsonFormatter())
logger.handlers = [_handler]


def register_flask_request_logger(app):
    from flask import request

    @app.before_request
    def _log_request():
        logger.info(f"{request.method} {request.path}")


def register_fastapi_request_logger(app):
    from starlette.middleware.base import BaseHTTPMiddleware

    class _RequestLogMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            logger.info(f"{request.method} {request.url.path}")
            return await call_next(request)

    app.add_middleware(_RequestLogMiddleware)
`;

export const SENTRY_INIT_PYTHON = `import sentry_sdk
import os

sentry_sdk.init(
    dsn=os.environ.get("SENTRY_DSN"),
    environment=os.environ.get("ENVIRONMENT", "production"),
    release=os.environ.get("APP_VERSION"),
    traces_sample_rate=0.1 if os.environ.get("ENVIRONMENT") == "production" else 0.0,
)
`;

export const COOKIE_FLAGS_PYTHON = `"""Cookie security — adds missing Secure/HttpOnly/SameSite attributes to Set-Cookie headers."""
from __future__ import annotations


def _fix_cookie(cookie: str) -> str:
    attrs = [p.strip().lower() for p in cookie.split(";")[1:]]
    fixed = cookie
    if "httponly" not in attrs:
        fixed += "; HttpOnly"
    if "secure" not in attrs:
        fixed += "; Secure"
    if not any(a.startswith("samesite") for a in attrs):
        fixed += "; SameSite=Lax"
    return fixed


def register_flask_cookie_flags(app):
    @app.after_request
    def _secure_cookies(response):
        cookies = response.headers.getlist("Set-Cookie")
        if cookies:
            del response.headers["Set-Cookie"]
            for cookie in cookies:
                response.headers.add("Set-Cookie", _fix_cookie(cookie))
        return response


def register_fastapi_cookie_flags(app):
    from starlette.middleware.base import BaseHTTPMiddleware

    class _CookieFlagsMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            response = await call_next(request)
            cookies = response.headers.getlist("set-cookie")
            if cookies:
                del response.headers["set-cookie"]
                for cookie in cookies:
                    response.headers.append("set-cookie", _fix_cookie(cookie))
            return response

    app.add_middleware(_CookieFlagsMiddleware)
`;

export const HTTPS_REDIRECT_PYTHON = `"""HTTPS redirect — trusts X-Forwarded-Proto (edge/proxy) first, falls back to the request's own scheme."""
from __future__ import annotations


def register_flask_https_redirect(app):
    from flask import redirect, request

    @app.before_request
    def _https_redirect():
        forwarded = request.headers.get("X-Forwarded-Proto")
        is_https = forwarded.split(",")[0].strip().lower() == "https" if forwarded else request.is_secure
        if not is_https:
            url = request.url.replace("http://", "https://", 1)
            return redirect(url, code=301)


def register_fastapi_https_redirect(app):
    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.responses import RedirectResponse

    class _HttpsRedirectMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            forwarded = request.headers.get("X-Forwarded-Proto")
            is_https = (
                forwarded.split(",")[0].strip().lower() == "https"
                if forwarded
                else request.url.scheme == "https"
            )
            if not is_https:
                url = str(request.url).replace("http://", "https://", 1)
                return RedirectResponse(url, status_code=301)
            return await call_next(request)

    app.add_middleware(_HttpsRedirectMiddleware)
`;

export const HEALTH_CHECK_PYTHON = `# Health check endpoint — import and register in your app entry point
# Flask: app.register_blueprint(health_bp)
# FastAPI: app.include_router(health_router)

try:
    from flask import Blueprint, jsonify
    health_bp = Blueprint("health", __name__)

    @health_bp.route("/health")
    def health():
        import time
        return jsonify({"status": "ok", "uptime": time.process_time()})

except ImportError:
    from fastapi import APIRouter
    from fastapi.responses import JSONResponse
    import time
    health_router = APIRouter()

    @health_router.get("/health")
    async def health():
        return JSONResponse({"status": "ok", "uptime": time.process_time()})
`;
