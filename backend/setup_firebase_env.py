#!/usr/bin/env python3
"""
Helper script to setup Firebase environment variables from service account JSON file.
This converts a Firebase service account JSON file into .env format.

Usage:
1. Download your service account key from Firebase Console
2. Run: python setup_firebase_env.py path/to/your-firebase-key.json
"""

import sys
import json
import os

def setup_firebase_env(json_path):
    """Convert Firebase service account JSON to .env format."""
    
    if not os.path.exists(json_path):
        print(f"❌ Error: File not found: {json_path}")
        print("\nPlease download your Firebase service account key:")
        print("1. Go to: https://console.firebase.google.com/project/parasf-3b57b/settings/serviceaccounts/adminsdk")
        print("2. Click 'Generate new private key'")
        print("3. Save the downloaded JSON file")
        print("4. Run this script with the path to that file")
        return False
    
    try:
        with open(json_path, 'r') as f:
            creds = json.load(f)
        
        # Escape the private key for .env format
        private_key = creds['private_key'].replace('\n', '\\n')
        
        env_content = f"""# Firebase Configuration (Auto-generated from service account)
FIREBASE_TYPE={creds['type']}
FIREBASE_PROJECT_ID={creds['project_id']}
FIREBASE_PRIVATE_KEY_ID={creds['private_key_id']}
FIREBASE_PRIVATE_KEY="{private_key}"
FIREBASE_CLIENT_EMAIL={creds['client_email']}
FIREBASE_CLIENT_ID={creds['client_id']}
FIREBASE_AUTH_URI={creds['auth_uri']}
FIREBASE_TOKEN_URI={creds['token_uri']}
FIREBASE_AUTH_PROVIDER_X509_CERT_URL={creds['auth_provider_x509_cert_url']}
FIREBASE_CLIENT_X509_CERT_URL={creds['client_x509_cert_url']}

# API Configuration
CORS_ORIGINS=["http://localhost:5173"]
SIMULATION_SEED=42
"""
        
        # Backup existing .env if it exists
        env_path = os.path.join(os.path.dirname(__file__), '.env')
        if os.path.exists(env_path):
            backup_path = env_path + '.backup'
            with open(env_path, 'r') as f:
                with open(backup_path, 'w') as bf:
                    bf.write(f.read())
            print(f"📋 Backed up existing .env to {backup_path}")
        
        # Write new .env
        with open(env_path, 'w') as f:
            f.write(env_content)
        
        print("✅ Successfully created .env file with Firebase credentials!")
        print(f"📁 Location: {env_path}")
        print("\n🔐 Security note: Never commit .env to git (already in .gitignore)")
        print("\n✨ Next steps:")
        print("   1. cd scripts && npm install && node setup-firebase-demo-accounts.js")
        print("   2. source venv/bin/activate")
        print("   3. uvicorn app.main:app --reload")
        
        return True
        
    except json.JSONDecodeError:
        print(f"❌ Error: Invalid JSON file: {json_path}")
        return False
    except KeyError as e:
        print(f"❌ Error: Missing key in JSON: {e}")
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False


if __name__ == "__main__":
    print("🔥 Firebase Environment Setup\n")
    
    if len(sys.argv) < 2:
        print("Usage: python setup_firebase_env.py <path-to-firebase-service-account.json>")
        print("\nExample:")
        print("   python setup_firebase_env.py ~/Downloads/parasf-3b57b-firebase-adminsdk-xxxxx.json")
        print("\n📥 Get your service account key:")
        print("   https://console.firebase.google.com/project/parasf-3b57b/settings/serviceaccounts/adminsdk")
        sys.exit(1)
    
    json_path = os.path.expanduser(sys.argv[1])
    success = setup_firebase_env(json_path)
    sys.exit(0 if success else 1)
