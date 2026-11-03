"""
api/log_source.py
-----------------
Fetches an event log from a link the user typed. The server makes the request, so it must not be usable to reach
private addresses: only http(s), every address the host resolves to must be public, redirects are checked the same way,
and the size is capped.
"""

from __future__ import annotations

import ipaddress
import os
import re
import socket
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse

import httpx

from replay_core.ingestion import SUPPORTED_EXTENSIONS

MAX_BYTES = int(os.environ.get("REPLAY_MAX_LOG_MB", 200)) * 1024 * 1024
MAX_REDIRECTS = 3
TIMEOUT = 60


class LogSourceError(ValueError):
    """The link or file cannot be used; the message is meant for the user."""


def check_public_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise LogSourceError("Enter a full http:// or https:// link to the log file.")
    try:
        infos = socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
    except socket.gaierror as exc:
        raise LogSourceError(f"Could not find the host {parsed.hostname}.") from exc
    for info in infos:
        if not ipaddress.ip_address(info[4][0].split("%")[0]).is_global:
            raise LogSourceError("That link points to a private address, which the server will not fetch.")


def extension_of(name: str) -> str:
    ext = Path(name).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise LogSourceError(f"Unsupported file type '{ext or name}'. Use one of: {', '.join(sorted(SUPPORTED_EXTENSIONS))}.")
    return ext


def clean_label(name: str) -> str:
    return (re.sub(r"[^\w.\- ()]+", "_", Path(name).name).strip() or "event log")[:120]


def _name_from(response: httpx.Response, url: str) -> str:
    found = re.search(r'filename\*?="?(?:UTF-8\'\')?([^";]+)', response.headers.get("content-disposition", ""))
    return unquote(found.group(1)) if found else unquote(Path(urlparse(url).path).name)


def download(url: str, dest_without_ext: Path) -> tuple[Path, str]:
    """Save the log beside `dest_without_ext`. Returns (saved path, the file's name). Raises LogSourceError with a clear reason."""
    current = url
    try:
        with httpx.Client(timeout=TIMEOUT, follow_redirects=False) as client:
            for _ in range(MAX_REDIRECTS + 1):
                check_public_url(current)
                with client.stream("GET", current) as response:
                    if response.is_redirect:
                        current = urljoin(current, response.headers["location"])
                        continue
                    if response.status_code != 200:
                        raise LogSourceError(f"The link answered with status {response.status_code}.")
                    name = _name_from(response, current)
                    try:
                        ext = extension_of(name)
                    except LogSourceError as exc:
                        raise LogSourceError(f"{exc} The link must lead directly to the log file, not to a web page.") from exc
                    path = dest_without_ext.with_suffix(ext)
                    total = 0
                    with path.open("wb") as out:
                        for chunk in response.iter_bytes():
                            total += len(chunk)
                            if total > MAX_BYTES:
                                out.close()
                                path.unlink(missing_ok=True)
                                raise LogSourceError(f"That log is larger than the {MAX_BYTES // (1024 * 1024)} MB limit.")
                            out.write(chunk)
                    return path, name
    except httpx.HTTPError as exc:
        raise LogSourceError(f"Could not download that link ({type(exc).__name__}).") from exc
    raise LogSourceError("That link redirects too many times.")
