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
    cors_origins: Union[list[str], str] = [
        "http://localhost:5173",
        "https://farm-settle-deploy.vercel.app",
        "https://farmsettle-backend.onrender.com"
    ]
    simulation_seed: int = 42
    cloudinary_url: str = ""
    # Stage 7 agents: any OpenAI-compatible chat endpoint. Defaults to Groq's free tier; a missing or
    # dummy key simply switches the agents to deterministic, templated explanations.
    llm_base_url: str = "https://api.groq.com/openai/v1"
    llm_api_key: str = ""
    llm_model: str = "llama-3.3-70b-versatile"
    llm_timeout_s: float = 20.0
    agent_payout_budget: float = 5_000_000.0     # per-run payout budget checked by Compliance
    payment_mode: str = "sim"                    # sim | razorpay_test | razorpay_live
    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""
    razorpay_webhook_secret: str = ""
    premium_rate: float = 0.03                   # premium = sum_insured * rate
    agent_large_claim: float = 50_000.0          # claims at/above this are flagged "large"

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
