"""Media object storage — local disk (dev) or S3-compatible (R2 / AWS / MinIO)."""
from __future__ import annotations

import mimetypes
from pathlib import Path
from typing import Protocol

from config import settings

UPLOAD_DIR = Path(__file__).parent / "uploads"


class Storage(Protocol):
    def put(self, key: str, data: bytes, content_type: str | None = None) -> None: ...
    def delete(self, key: str) -> None: ...
    def exists(self, key: str) -> bool: ...
    def local_path(self, key: str) -> Path | None: ...
    def presigned_get_url(self, key: str, filename: str | None = None, expires: int = 900) -> str | None: ...


class LocalStorage:
    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        # Prevent path traversal
        safe = key.replace("\\", "/").lstrip("/")
        if ".." in safe.split("/"):
            raise ValueError("Invalid storage key")
        return self.root / safe

    def put(self, key: str, data: bytes, content_type: str | None = None) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def delete(self, key: str) -> None:
        path = self._path(key)
        if path.exists():
            path.unlink()

    def exists(self, key: str) -> bool:
        return self._path(key).exists()

    def local_path(self, key: str) -> Path | None:
        path = self._path(key)
        return path if path.exists() else None

    def presigned_get_url(self, key: str, filename: str | None = None, expires: int = 900) -> str | None:
        return None


class S3Storage:
    def __init__(self, bucket: str, region: str, endpoint_url: str | None,
                 access_key: str, secret_key: str):
        import boto3
        from botocore.config import Config

        self.bucket = bucket
        kwargs = {
            "service_name": "s3",
            "region_name": region or "auto",
            "aws_access_key_id": access_key,
            "aws_secret_access_key": secret_key,
            "config": Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        }
        if endpoint_url:
            kwargs["endpoint_url"] = endpoint_url
        self.client = boto3.client(**kwargs)

    def put(self, key: str, data: bytes, content_type: str | None = None) -> None:
        ct = content_type or mimetypes.guess_type(key)[0] or "application/octet-stream"
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=data,
            ContentType=ct,
            # Private by default — served via authenticated API redirect / presign
        )

    def delete(self, key: str) -> None:
        try:
            self.client.delete_object(Bucket=self.bucket, Key=key)
        except Exception:
            pass

    def exists(self, key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
            return True
        except Exception:
            return False

    def local_path(self, key: str) -> Path | None:
        return None

    def presigned_get_url(self, key: str, filename: str | None = None, expires: int = 900) -> str | None:
        params = {"Bucket": self.bucket, "Key": key}
        if filename:
            params["ResponseContentDisposition"] = f'inline; filename="{filename}"'
        return self.client.generate_presigned_url(
            "get_object", Params=params, ExpiresIn=expires)


def media_object_key(organization_id: str, stored_name: str) -> str:
    """Tenant-scoped object key. Falls back to bare stored_name for legacy local files."""
    org = (organization_id or "unknown").replace("/", "_")
    name = stored_name.replace("\\", "/").lstrip("/")
    return f"{org}/{name}"


def get_storage() -> Storage:
    if settings.storage_backend == "s3":
        return S3Storage(
            bucket=settings.s3_bucket or "",
            region=settings.s3_region or "auto",
            endpoint_url=settings.s3_endpoint_url,
            access_key=settings.s3_access_key or "",
            secret_key=settings.s3_secret_key or "",
        )
    return LocalStorage(UPLOAD_DIR)


# Singleton used by routes
storage: Storage = get_storage()
