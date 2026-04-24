from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, Text, JSON, ForeignKey, Enum as SAEnum
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase, relationship
import enum
from core.config import settings

engine = create_async_engine(settings.DATABASE_URL, echo=settings.DEBUG)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

class EntityType(str, enum.Enum):
    AIRCRAFT  = "aircraft"
    SHIP      = "ship"
    SATELLITE = "satellite"
    PERSON    = "person"
    VEHICLE   = "vehicle"
    FACILITY  = "facility"

class ThreatLevel(str, enum.Enum):
    NONE     = "none"
    LOW      = "low"
    MEDIUM   = "medium"
    HIGH     = "high"
    CRITICAL = "critical"

class AlertType(str, enum.Enum):
    ANOMALY          = "anomaly"
    ROUTE_DEVIATION  = "route_deviation"
    SIGNAL_LOST      = "signal_lost"
    THREAT_DETECTED  = "threat_detected"
    CLUSTER_ACTIVITY = "cluster_activity"
    AI_INSIGHT       = "ai_insight"

class TrackedEntity(Base):
    __tablename__ = "tracked_entities"
    id           = Column(Integer, primary_key=True, index=True)
    external_id  = Column(String(128), unique=True, index=True)
    entity_type  = Column(SAEnum(EntityType), nullable=False)
    name         = Column(String(256))
    callsign     = Column(String(64))
    country      = Column(String(64))
    threat_level = Column(SAEnum(ThreatLevel), default=ThreatLevel.NONE)
    metadata_    = Column("metadata", JSON, default=dict)
    is_active    = Column(Boolean, default=True)
    first_seen   = Column(DateTime, default=datetime.utcnow)
    last_seen    = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    positions    = relationship("PositionHistory", back_populates="entity", cascade="all, delete-orphan")
    alerts       = relationship("Alert", back_populates="entity")

class PositionHistory(Base):
    __tablename__ = "position_history"
    id         = Column(Integer, primary_key=True, index=True)
    entity_id  = Column(Integer, ForeignKey("tracked_entities.id"), index=True)
    latitude   = Column(Float, nullable=False)
    longitude  = Column(Float, nullable=False)
    altitude   = Column(Float, nullable=True)
    speed      = Column(Float, nullable=True)
    heading    = Column(Float, nullable=True)
    timestamp  = Column(DateTime, default=datetime.utcnow, index=True)
    raw_data   = Column(JSON, default=dict)
    entity     = relationship("TrackedEntity", back_populates="positions")

class GlobalEvent(Base):
    __tablename__ = "global_events"
    id              = Column(Integer, primary_key=True, index=True)
    event_type      = Column(String(64), index=True)
    title           = Column(String(512))
    description     = Column(Text)
    latitude        = Column(Float)
    longitude       = Column(Float)
    magnitude       = Column(Float, nullable=True)
    threat_level    = Column(SAEnum(ThreatLevel), default=ThreatLevel.NONE)
    source          = Column(String(128))
    source_url      = Column(String(1024))
    ai_summary      = Column(Text, nullable=True)
    ai_threat_score = Column(Float, default=0.0)
    occurred_at     = Column(DateTime, index=True)
    created_at      = Column(DateTime, default=datetime.utcnow)
    raw_data        = Column(JSON, default=dict)

class Alert(Base):
    __tablename__ = "alerts"
    id           = Column(Integer, primary_key=True, index=True)
    entity_id    = Column(Integer, ForeignKey("tracked_entities.id"), nullable=True)
    alert_type   = Column(SAEnum(AlertType), nullable=False)
    threat_level = Column(SAEnum(ThreatLevel), default=ThreatLevel.MEDIUM)
    title        = Column(String(512))
    description  = Column(Text)
    latitude     = Column(Float, nullable=True)
    longitude    = Column(Float, nullable=True)
    is_active    = Column(Boolean, default=True)
    is_read      = Column(Boolean, default=False)
    ai_analysis  = Column(Text, nullable=True)
    created_at   = Column(DateTime, default=datetime.utcnow, index=True)
    resolved_at  = Column(DateTime, nullable=True)
    entity       = relationship("TrackedEntity", back_populates="alerts")

class IntelligenceReport(Base):
    __tablename__ = "intelligence_reports"
    id          = Column(Integer, primary_key=True, index=True)
    report_type = Column(String(64))
    title       = Column(String(512))
    content     = Column(Text)
    entities_   = Column("entities", JSON, default=list)
    events_     = Column("events", JSON, default=list)
    confidence  = Column(Float, default=0.0)
    created_at  = Column(DateTime, default=datetime.utcnow, index=True)

class EntityRelationship(Base):
    __tablename__ = "entity_relationships"
    id            = Column(Integer, primary_key=True, index=True)
    entity_a_id   = Column(Integer, ForeignKey("tracked_entities.id"))
    entity_b_id   = Column(Integer, ForeignKey("tracked_entities.id"))
    relationship  = Column(String(128))
    confidence    = Column(Float, default=0.0)
    ai_reasoning  = Column(Text, nullable=True)
    discovered_at = Column(DateTime, default=datetime.utcnow)


class OperationalEvent(Base):
    __tablename__ = "operational_events"
    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(String(128), unique=True, index=True, nullable=False)
    feed = Column(String(64), index=True, nullable=False)
    severity = Column(String(16), index=True, nullable=False, default="info")
    status = Column(String(32), index=True, nullable=False)
    prev_status = Column(String(32), nullable=False)
    source = Column(String(128), nullable=True)
    confidence = Column(Integer, nullable=True)
    last_error = Column(String(256), nullable=True)
    occurred_at = Column(DateTime, index=True, default=datetime.utcnow)
    payload = Column(JSON, default=dict)

async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
