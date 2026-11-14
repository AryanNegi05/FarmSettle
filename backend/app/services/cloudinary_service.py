"""Cloudinary image storage for farm map snapshots.

The CLOUDINARY_URL credential lives only in the backend environment; the
browser sends the snapshot to our API and never sees the secret.
"""
import logging
import time
from urllib.parse import urlparse

import cloudinary
import cloudinary.uploader

from app.core.config import settings

logger = logging.getLogger("uvicorn.error")

_configured = False


def _configure() -> None:
    global _configured
    if _configured:
        return
    if not settings.cloudinary_url:
        raise RuntimeError("CLOUDINARY_URL is not configured on the server")
    u = urlparse(settings.cloudinary_url)
    cloudinary.config(
        cloud_name=u.hostname,
        api_key=u.username,
        api_secret=u.password,
        secure=True,
    )
    _configured = True


def upload_farm_snapshot(farm_id: str, image_data_url: str) -> str:
    """Upload a data-URL image for a farm (replacing any previous one) and return its https URL."""
    _configure()
    t0 = time.time()
    logger.info("Cloudinary upload start: farm=%s size=%dKB", farm_id, len(image_data_url) // 1024)
    res = cloudinary.uploader.upload(
        image_data_url,
        folder="paratrust/farms",
        public_id=f"farm_{farm_id}",
        overwrite=True,
        invalidate=True,
        resource_type="image",
    )
    logger.info("Cloudinary upload done: farm=%s in %.2fs -> %s", farm_id, time.time() - t0, res["secure_url"])
    return res["secure_url"]
