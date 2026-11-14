"""Authentication endpoints - Firebase only."""
from fastapi import APIRouter, Depends, HTTPException
from app.schemas.auth import UserOut
from app.core.firebase_auth import get_current_user, FirebaseUser

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/me", response_model=UserOut)
async def me(current_user: FirebaseUser = Depends(get_current_user)):
    """Get current authenticated user from Firebase token."""
    return UserOut(
        id=current_user.uid,
        email=current_user.email,
        full_name=current_user.full_name,
        role=current_user.role,
        is_active=current_user.is_active,
    )
