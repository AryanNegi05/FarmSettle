"""Firebase Admin SDK integration for authentication."""
import os
# gRPC's default DNS resolver hangs forever on some macOS/Python 3.14 setups, which
# froze every Firestore call. Must be set before grpc is first imported.
os.environ.setdefault("GRPC_DNS_RESOLVER", "native")

import logging
import os
import json
from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import firebase_admin
from firebase_admin import credentials, auth as firebase_auth, firestore
from app.core.config import settings

logger = logging.getLogger(__name__)

# Initialize Firebase Admin SDK
try:
    # Try to load from environment variables first
    if os.getenv("FIREBASE_PROJECT_ID"):
        logger.info("Loading Firebase credentials from environment variables")
        
        # Build service account dict from environment variables
        service_account_info = {
            "type": os.getenv("FIREBASE_TYPE", "service_account"),
            "project_id": os.getenv("FIREBASE_PROJECT_ID"),
            "private_key_id": os.getenv("FIREBASE_PRIVATE_KEY_ID"),
            "private_key": os.getenv("FIREBASE_PRIVATE_KEY", "").replace("\\n", "\n"),
            "client_email": os.getenv("FIREBASE_CLIENT_EMAIL"),
            "client_id": os.getenv("FIREBASE_CLIENT_ID"),
            "auth_uri": os.getenv("FIREBASE_AUTH_URI", "https://accounts.google.com/o/oauth2/auth"),
            "token_uri": os.getenv("FIREBASE_TOKEN_URI", "https://oauth2.googleapis.com/token"),
            "auth_provider_x509_cert_url": os.getenv("FIREBASE_AUTH_PROVIDER_X509_CERT_URL", 
                                                      "https://www.googleapis.com/oauth2/v1/certs"),
            "client_x509_cert_url": os.getenv("FIREBASE_CLIENT_X509_CERT_URL"),
        }
        
        cred = credentials.Certificate(service_account_info)
    else:
        # Fallback to credentials file
        logger.info("Loading Firebase credentials from file")
        cred = credentials.Certificate(settings.firebase_credentials_path)
    
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    logger.info("✅ Firebase Admin SDK initialized successfully")
except Exception as e:
    logger.error(f"❌ Failed to initialize Firebase Admin SDK: {e}")
    logger.warning("⚠️  Backend will not be able to verify Firebase tokens")
    db = None

security = HTTPBearer()


class FirebaseUser:
    """User object from Firebase token claims."""
    def __init__(self, uid: str, email: str, role: str, full_name: Optional[str] = None):
        self.id = uid
        self.uid = uid
        self.email = email
        self.role = role
        self.full_name = full_name or email.split("@")[0]
        self.is_active = True


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> FirebaseUser:
    """
    Verify Firebase ID token and return user information.
    Raises HTTPException if token is invalid.
    """
    token = credentials.credentials
    
    try:
        # Verify the Firebase ID token
        decoded_token = firebase_auth.verify_id_token(token)
        uid = decoded_token["uid"]
        email = decoded_token.get("email", "")
        
        # Get user role from Firestore
        if db:
            try:
                user_ref = db.collection("users").document(uid)
                user_doc = user_ref.get()
                
                if user_doc.exists:
                    user_data = user_doc.to_dict()
                    role = user_data.get("role", "farmer")
                    full_name = user_data.get("full_name")
                else:
                    # Default role for new users
                    role = "farmer"
                    full_name = None
            except Exception as e:
                logger.warning(f"Failed to fetch user from Firestore: {e}")
                role = "farmer"
                full_name = None
        else:
            role = "farmer"
            full_name = None
        
        return FirebaseUser(
            uid=uid,
            email=email,
            role=role,
            full_name=full_name
        )
        
    except firebase_auth.InvalidIdTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token"
        )
    except firebase_auth.ExpiredIdTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token has expired"
        )
    except Exception as e:
        logger.error(f"Token verification error: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials"
        )


def get_firestore_db():
    """Get Firestore database client."""
    if db is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Firebase Firestore is not available"
        )
    return db
