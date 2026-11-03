"""
api/auth.py
-----------
Checks the Firebase ID token the browser sends. Passwords, verification emails and Google sign-in all live in Firebase;
this server never sees a password. FIREBASE_PROJECT_ID names the project whose tokens are accepted.
FIREBASE_AUTH_EMULATOR_HOST (firebase_admin reads it itself) points the check at the local Auth Emulator for testing.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import firebase_admin
from firebase_admin import auth as firebase_auth, credentials
from google.auth.credentials import AnonymousCredentials

logger = logging.getLogger(__name__)
CLOCK_SKEW_SECONDS = 30  # a token issued a moment "in the future" by a slightly slow PC clock is still fine


class _NoCredential(credentials.Base):
    """Checking a token only needs Google's public keys, so no service account key is required. Without this,
    firebase_admin looks for one before it even reads the token (the Auth Emulator skips that step)."""

    def get_credential(self):
        return AnonymousCredentials()


class AuthError(Exception):
    def __init__(self, message: str, status: int = 401):
        super().__init__(message)
        self.status = status


def _app() -> firebase_admin.App:
    project = os.environ.get("FIREBASE_PROJECT_ID")
    if not project:
        raise AuthError("The server has no Firebase project set. Start it with the FIREBASE_PROJECT_ID environment variable.", 503)
    try:
        return firebase_admin.get_app()
    except ValueError:
        return firebase_admin.initialize_app(_NoCredential(), options={"projectId": project})


def verify_token(token: str) -> dict[str, Any]:
    """The verified claims of a Firebase ID token. Password accounts must have confirmed their email address."""
    try:
        claims = firebase_auth.verify_id_token(token, app=_app(), clock_skew_seconds=CLOCK_SKEW_SECONDS)
    except AuthError:
        raise
    except Exception as exc:  # noqa: BLE001  (every way a token can be bad means the same thing to the caller)
        logger.warning("Firebase token refused (%s): %s", type(exc).__name__, exc)  # the real reason, for the server's console
        raise AuthError("Your sign-in has expired or is not valid. Please sign in again.") from exc
    if not claims.get("email_verified"):
        raise AuthError("Please verify your email address first.", 403)
    return claims
