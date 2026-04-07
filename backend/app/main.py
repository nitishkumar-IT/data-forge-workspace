from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .config import settings
from .database import Base, engine
from .routers import auth, projects

app = FastAPI(title=settings.app_name)

@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)

# IMPORTANT: define origins clearly
origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

# CORS must be added BEFORE routers
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"]
)

app.include_router(auth.router, prefix="/api")
app.include_router(projects.router, prefix="/api")

@app.get("/api/health")
def health_check():
    return {"status": "ok"}