"""User roles enum (Firestore-only backend — no SQLAlchemy User model needed)."""
import enum


class UserRole(str, enum.Enum):
    farmer = "farmer"
    insurer = "insurer"
    auditor = "auditor"
    admin = "admin"
