"""Role-based authorization helper shared across routers."""
from fastapi import Depends, HTTPException, status
from app.core.firebase_auth import get_current_user
from app.models.user import UserRole


def require_role(*roles: UserRole):
    """Return a FastAPI dependency that enforces the caller has one of the given roles."""
    async def _check(current_user=Depends(get_current_user)):
        user_role = UserRole(current_user.role) if isinstance(current_user.role, str) else current_user.role
        if user_role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required role(s): {[r.value for r in roles]}",
            )
        return current_user
    return _check

