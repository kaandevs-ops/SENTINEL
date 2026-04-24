from pydantic_settings import BaseSettings
from typing import List

class Settings(BaseSettings):
    # AI Providers
    ANTHROPIC_API_KEY: str = ""
    OPENAI_API_KEY: str = ""
    GEMINI_API_KEY: str = ""
    GROQ_API_KEY: str = ""
    OLLAMA_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "llama3.2"

    DATABASE_URL: str = "sqlite+aiosqlite:///./sentinel.db"
    REDIS_URL: str = "redis://localhost:6379"
    OPENSKY_USERNAME: str = ""
    OPENSKY_PASSWORD: str = ""
    DEBUG: bool = True
    CORS_ORIGINS: List[str] = ["http://localhost:3000"]
    DATA_REFRESH_INTERVAL: int = 30
    AI_ANALYSIS_INTERVAL: int = 60

    # Enrichment (optional)
    # If enabled, threat IPs will be geolocated to appear on the map.
    IP_GEO_ENABLED: bool = False
    # Supported: "ip-api"
    IP_GEO_PROVIDER: str = "ip-api"
    # ip-api base URL (pro users can point to pro endpoint)
    IP_API_BASE_URL: str = "http://ip-api.com/json"
    # Basic throttle for public endpoints (seconds between requests)
    IP_GEO_MIN_INTERVAL_SEC: float = 0.4
    # Max IPs to enrich per collector tick (keeps rate limits safe)
    IP_GEO_MAX_PER_TICK: int = 50

    # If enabled, news items will be geolocated (country-level) to appear on the map.
    NEWS_GEO_ENABLED: bool = False
    # Supported: "restcountries"
    NEWS_GEO_PROVIDER: str = "restcountries"
    # Basic throttle for public endpoints (seconds between requests)
    NEWS_GEO_MIN_INTERVAL_SEC: float = 0.3
    # Max news items to enrich per collector tick
    NEWS_GEO_MAX_PER_TICK: int = 50

    # Cameras (OSINT)
    # Optional: additional camera catalog URL returning JSON list of cameras.
    CAMERA_CATALOG_URL: str = ""
    # Local camera catalog path (relative to backend/). Default is data/cameras.json
    CAMERA_CATALOG_PATH: str = "data/cameras.json"
    # Overpass API base URL for OSM camera points.
    CAMERA_OVERPASS_URL: str = "https://overpass-api.de/api/interpreter"
    # Comma-separated bbox list: "minLon,minLat,maxLon,maxLat;minLon,minLat,maxLon,maxLat"
    # Defaults to a few large Turkish metro areas for manageable payload sizes.
    CAMERA_OSM_BBOXES: str = "28.5,40.7,29.8,41.4;32.4,39.6,33.3,40.2;26.7,38.2,28.2,39.2"
    CAMERA_OSM_MAX: int = 450

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

settings = Settings()
