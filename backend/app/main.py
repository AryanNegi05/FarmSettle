import os
# gRPC's default DNS resolver hangs forever on some macOS/Python 3.14 setups, which
# froze every Firestore call. Must be set before grpc is first imported.
os.environ.setdefault("GRPC_DNS_RESOLVER", "native")
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings

# Import routers
from app.api.auth import router as auth_router
from app.api.farmers import router as farmers_router
from app.api.claims import router as claims_router
from app.api.command import router as command_router
from app.api.backtest import router as backtest_router
from app.api.agents import router as agents_router
from app.api.my_claims import router as my_claims_router
from app.api.basis_risk import router as basis_risk_router
from app.api.policies import router as policies_router, admin_router
from app.api.geo import router as geo_router
from app.api.simulation import router as simulation_router
from app.api.sensors import router as sensors_router
from app.api.risk import router as risk_router
from app.api.premium import router as premium_router

app = FastAPI(title="FarmTrust API", version="2.0.0 - Firebase")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(farmers_router)
app.include_router(policies_router)
app.include_router(admin_router)
app.include_router(geo_router)
app.include_router(simulation_router)
app.include_router(sensors_router)
app.include_router(risk_router)
app.include_router(claims_router)
app.include_router(command_router)
app.include_router(backtest_router)
app.include_router(agents_router)
app.include_router(my_claims_router)
app.include_router(basis_risk_router)
app.include_router(premium_router)

@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "paratrust-api", "stage": 6, "database": "firebase"}


@app.on_event("startup")
def _warm_models() -> None:
    """Train/cache the LightGBM sensor model in the background so the first slider move is fast."""
    import threading

    def warm() -> None:
        try:
            from app.services.fault_detection import get_trained_model
            get_trained_model()
        except Exception:  # noqa: BLE001
            pass

    threading.Thread(target=warm, daemon=True).start()
