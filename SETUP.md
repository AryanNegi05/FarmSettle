# ParaTrust Setup Guide

Complete setup instructions for the ParaTrust parametric insurance platform with Firebase.

## Prerequisites

- **Python 3.11+** (Python 3.14 recommended)
- **Node.js 18+** and npm
- **Firebase Project** (free tier is fine)
- **Git**

## Step 1: Firebase Project Setup

### 1.1 Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **Add Project**
3. Enter project name: `paratrust` (or your choice)
4. Disable Google Analytics (optional for demo)
5. Click **Create Project**

### 1.2 Enable Authentication

1. In Firebase Console, go to **Authentication**
2. Click **Get Started**
3. Click **Sign-in method** tab
4. Enable **Email/Password**
5. Save

### 1.3 Enable Firestore

1. In Firebase Console, go to **Firestore Database**
2. Click **Create Database**
3. Select **Start in production mode**
4. Choose location closest to you
5. Click **Enable**

### 1.4 Set Firestore Security Rules

Go to **Firestore** → **Rules** and paste:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users collection
    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && 
                     (request.auth.uid == userId || 
                      get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin');
    }
    
    // Farmer profiles
    match /farmer_profiles/{profileId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }
    
    // Farms
    match /farms/{farmId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }
    
    // Crops
    match /crops/{cropId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }
    
    // Policies
    match /policies/{policyId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }
    
    // Policy rules
    match /policy_rules/{ruleId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }
    
    // Bank accounts
    match /bank_accounts/{accountId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }
  }
}
```

Click **Publish**.

### 1.5 Get Service Account Key

1. Go to **Project Settings** (gear icon)
2. Click **Service Accounts** tab
3. Click **Generate New Private Key**
4. Click **Generate Key** (downloads JSON file)
5. **Rename** the file to `firebase-credentials.json`
6. **Move** it to: `backend/firebase-credentials.json`

⚠️ **Important**: Keep this file secure! Add to `.gitignore` (already done).

### 1.6 Get Web App Config

1. Go to **Project Settings** → **General**
2. Scroll to **Your apps**
3. Click **Web** icon (`</>`)
4. Register app with nickname: `paratrust-web`
5. Copy the `firebaseConfig` object
6. Update `frontend/src/config/firebase.ts` with your values

## Step 2: Backend Setup

### 2.1 Create Virtual Environment

```bash
cd backend
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

### 2.2 Install Dependencies

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

This installs:
- FastAPI & Uvicorn (API server)
- Firebase Admin SDK
- Pydantic (data validation)
- NumPy, Pandas, Scikit-learn (ML)
- And more...

### 2.3 Verify Installation

```bash
python -c "import firebase_admin; print('Firebase Admin SDK:', firebase_admin.__version__)"
```

Should print version without errors.

## Step 3: Frontend Setup

### 3.1 Install Dependencies

```bash
cd frontend
npm install
```

### 3.2 Update Firebase Config

Edit `frontend/src/config/firebase.ts`:

```typescript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

Get these values from Firebase Console → Project Settings → Your apps.

## Step 4: Create Demo Accounts

### 4.1 Install Script Dependencies

```bash
cd scripts
npm install
```

### 4.2 Run Setup Script

```bash
node setup-firebase-demo-accounts.js
```

This creates 4 demo accounts in Firebase:

| Role     | Email                     | Password     |
|----------|--------------------------|--------------|
| Farmer   | farmer@paratrust.dev     | farmer123    |
| Insurer  | insurer@paratrust.dev    | insurer123   |
| Auditor  | auditor@paratrust.dev    | auditor123   |
| Admin    | admin@paratrust.dev      | admin123     |

## Step 5: Start the Application

### 5.1 Start Backend (Terminal 1)

```bash
cd backend
source venv/bin/activate  # If not already activated
uvicorn app.main:app --reload
```

Backend runs at: **http://localhost:8000**

API docs: **http://localhost:8000/docs**

### 5.2 Start Frontend (Terminal 2)

```bash
cd frontend
npm run dev
```

Frontend runs at: **http://localhost:5173**

## Step 6: Test the Application

### 6.1 Login

1. Open http://localhost:5173
2. Click one of the quick login buttons (e.g., **Farmer**)
3. Or enter credentials manually

### 6.2 Test Farmer Flow

1. Login as `farmer@paratrust.dev` / `farmer123`
2. Go to **Profile** → Fill out farmer details
3. Go to **Farms** → Register a new farm
4. Add **Crops** to your farm
5. Add **Bank Account** details

### 6.3 Test Insurer Flow

1. Login as `insurer@paratrust.dev` / `insurer123`
2. Go to **Farmers** → View all registered farmers
3. Go to **Policies** → Create a new policy
4. View **Operations Map**

### 6.4 Test Auditor Flow

1. Login as `auditor@paratrust.dev` / `auditor123`
2. View farmers and policies (read-only)
3. Check sensor data

## Troubleshooting

### Backend Issues

**Error: "firebase-credentials.json not found"**
- Ensure you placed the service account key in `backend/firebase-credentials.json`
- Check file permissions

**Error: "Module not found"**
```bash
cd backend
source venv/bin/activate
pip install -r requirements.txt
```

**Port 8000 already in use**
```bash
uvicorn app.main:app --reload --port 8001
```

### Frontend Issues

**Firebase config errors**
- Double-check `frontend/src/config/firebase.ts`
- Ensure all values match your Firebase project

**Port 5173 already in use**
```bash
npm run dev -- --port 3000
```

**CORS errors**
- Check backend is running
- Verify `backend/app/core/config.py` has correct CORS origins

### Demo Accounts Issues

**"Email/Password not enabled" error**
- Go to Firebase Console → Authentication
- Enable Email/Password sign-in method

**Script fails to create accounts**
```bash
cd scripts
npm install firebase-admin
node setup-firebase-demo-accounts.js
```

## Project Structure

```
Parametric/
├── backend/
│   ├── app/
│   │   ├── api/          # API endpoints
│   │   ├── core/         # Firebase auth, config
│   │   ├── models/       # Data models
│   │   ├── schemas/      # Pydantic schemas
│   │   ├── services/     # Firestore service
│   │   └── main.py       # FastAPI app
│   ├── venv/             # Python virtual environment
│   ├── requirements.txt  # Python dependencies
│   └── firebase-credentials.json  # Firebase service account key
├── frontend/
│   ├── src/
│   │   ├── api/          # API clients
│   │   ├── components/   # React components
│   │   ├── config/       # Firebase config
│   │   ├── contexts/     # React contexts
│   │   ├── features/     # Feature modules
│   │   └── hooks/        # React hooks
│   └── package.json
├── scripts/
│   ├── setup-firebase-demo-accounts.js
│   ├── migrate-sqlite-to-firebase.py
│   └── package.json
├── SETUP.md              # This file
└── FIREBASE_MIGRATION.md # Migration details
```

## Useful Commands

### Backend

```bash
# Activate venv
source venv/bin/activate  # macOS/Linux
venv\Scripts\activate     # Windows

# Install new package
pip install package-name
pip freeze > requirements.txt

# Run server
uvicorn app.main:app --reload

# Run tests
pytest
```

### Frontend

```bash
# Install package
npm install package-name

# Run dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Firestore Management

View data in Firebase Console:
- Go to **Firestore Database**
- Browse collections: `users`, `farmer_profiles`, `farms`, etc.
- Click documents to view/edit

## Next Steps

1. ✅ Complete setup
2. ✅ Test all user flows
3. 🔄 Customize for your use case
4. 🔄 Add real weather data integration
5. 🔄 Deploy to production

## Production Deployment

### Backend (Render, Railway, or Cloud Run)

1. Set environment variable: `FIREBASE_CREDENTIALS_PATH`
2. Upload service account key securely
3. Set `CORS_ORIGINS` to your frontend URL

### Frontend (Vercel, Netlify, or Firebase Hosting)

1. Build: `npm run build`
2. Deploy `dist/` folder
3. Set environment variables for Firebase config

## Support

- **Firebase Docs**: https://firebase.google.com/docs
- **FastAPI Docs**: https://fastapi.tiangolo.com/
- **React Docs**: https://react.dev/

## Security Notes

⚠️ **Never commit these files:**
- `backend/firebase-credentials.json`
- `frontend/.env.local` (if using env vars)
- Any files containing API keys

✅ **Already in `.gitignore`:**
- `venv/`
- `node_modules/`
- `firebase-credentials.json`
- `.env*`

---

**Setup Complete!** 🎉

You now have a fully functional parametric insurance platform running on Firebase.
