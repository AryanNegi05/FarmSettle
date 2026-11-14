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
from app.api.policies import router as policies_router, admin_router
from app.api.geo import router as geo_router
from app.api.simulation import router as simulation_router
from app.api.sensors import router as sensors_router
from app.api.risk import router as risk_router

app = FastAPI(title="ParaTrust API", version="2.0.0 - Firebase")

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

@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "service": "paratrust-api", "stage": 6, "database": "firebase"}
