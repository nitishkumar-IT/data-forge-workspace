from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .config import settings
from .database import Base, engine
from .routers import auth, projects

app = FastAPI(
    title=settings.app_name,
    version="1.0.0"
)

# Create DB tables on startup
@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)

# CORS (important for frontend communication)
origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://data-forge-workspace.onrender.com"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,   # allowed frontend domains
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(auth.router, prefix="/api", tags=["Auth"])
app.include_router(projects.router, prefix="/api", tags=["Projects"])

# Health check
@app.get("/api/health")
def health_check():
    return {
        "status": "ok"
    }