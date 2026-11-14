import logging
from typing import Union, Any
import json
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./paratrust.db"
    secret_key: str = "change-me-in-dev-only"
    access_token_minutes: int = 60
    firebase_credentials_path: str = "firebase-credentials.json"
    cors_origins: Union[list[str], str] = ["http://localhost:5173"]
    simulation_seed: int = 42
    cloudinary_url: str = ""

    @field_validator("cors_origins", mode="after")
    @classmethod
    def assemble_cors_origins(cls, v: Any) -> list[str]:
        if isinstance(v, str):
            v = v.strip()
            if v.startswith("[") and v.endswith("]"):
                try:
                    return json.loads(v)
                except Exception:
                    pass
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v


settings = Settings()
