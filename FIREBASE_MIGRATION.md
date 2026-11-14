# Firebase Migration Guide

This document explains the complete migration from SQLite to Firebase Firestore for authentication and business data.

## What Changed

### Before (SQLite + Firebase Auth)
- **Authentication**: Firebase Auth (frontend) + SQLite users table (backend)
- **Business Data**: SQLite (farmer profiles, farms, crops, policies, bank accounts)
- **Data Flow**: Frontend → Firebase Auth → Backend syncs to SQLite

### After (Firebase Only)
- **Authentication**: Firebase Auth only
- **Business Data**: Firebase Firestore
- **Data Flow**: Frontend → Firebase Auth → Backend → Firestore

## Benefits

1. **Single Source of Truth**: All data in Firebase
2. **Real-time Sync**: Firestore provides real-time updates
3. **Scalability**: Cloud-native, auto-scaling database
4. **Simplified Architecture**: No SQLite dependencies
5. **Better Offline Support**: Firestore has built-in offline capabilities

## Setup Instructions

### 1. Firebase Project Setup

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project or select existing one
3. Enable **Authentication** → Email/Password
4. Enable **Cloud Firestore** → Start in production mode
5. Download service account key:
   - Settings → Service Accounts
   - Generate New Private Key
   - Save as `backend/firebase-credentials.json`

### 2. Firestore Security Rules

Set the following security rules in Firebase Console → Firestore → Rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users collection - only admins can write
    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth.uid == userId || 
                     get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }
    
    // Farmer profiles - farmers can only access their own
    match /farmer_profiles/{profileId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && 
                      request.resource.data.firebase_uid == request.auth.uid;
      allow update, delete: if request.auth != null && 
                              resource.data.firebase_uid == request.auth.uid;
    }
    
    // Farms - farmers can only access their own
    match /farms/{farmId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }
    
    // Crops
    match /crops/{cropId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }
    
    // Policies - restricted access
    match /policies/{policyId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && 
                     (get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'insurer' ||
                      get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin');
    }
    
    // Policy rules
    match /policy_rules/{ruleId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && 
                     (get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'insurer' ||
                      get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin');
    }
    
    // Bank accounts - farmers only
    match /bank_accounts/{accountId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### 3. Install Dependencies

#### Backend
```bash
cd backend
pip install -r requirements.txt
```

The updated `requirements.txt` includes:
- `firebase-admin>=6.5.0` (added)
- Removed: `sqlalchemy`, `alembic`, `passlib`, `python-jose`

#### Frontend
No changes needed - already uses Firebase SDK.

### 4. Setup Demo Accounts

Create the demo accounts in Firebase:

```bash
cd scripts
npm install firebase-admin  # If not already installed
node setup-firebase-demo-accounts.js
```

This creates:
- `farmer@paratrust.dev` / `farmer123`
- `insurer@paratrust.dev` / `insurer123`
- `auditor@paratrust.dev` / `auditor123`
- `admin@paratrust.dev` / `admin123`

### 5. Migrate Existing Data (Optional)

If you have existing SQLite data to migrate:

```bash
cd scripts
python migrate-sqlite-to-firebase.py
```

This will:
- Read all data from `backend/paratrust.db`
- Migrate to Firestore collections
- Maintain all relationships
- Provide a migration summary

### 6. Start the Application

#### Backend
```bash
cd backend
uvicorn app.main:app --reload
```

#### Frontend
```bash
cd frontend
npm run dev
```

## Firestore Collections Structure

### `users`
```javascript
{
  uid: string,
  email: string,
  full_name: string,
  role: "farmer" | "insurer" | "auditor" | "admin",
  is_active: boolean,
  created_at: timestamp
}
```

### `farmer_profiles`
```javascript
{
  firebase_uid: string,
  phone: string,
  address: string,
  district: string,
  state: string,
  created_at: timestamp
}
```

### `farms`
```javascript
{
  farmer_profile_id: string,  // References farmer_profiles document ID
  name: string,
  area_hectares: number,
  latitude: number,
  longitude: number,
  boundary_geojson: string,
  created_at: timestamp
}
```

### `crops`
```javascript
{
  farm_id: string,  // References farms document ID
  crop_type: string,
  season: string,
  area_hectares: number
}
```

### `policies`
```javascript
{
  policy_number: string,
  farm_id: string,
  farmer_profile_id: string,
  insurer_firebase_uid: string,
  coverage_start: date,
  coverage_end: date,
  sum_insured: number,
  rainfall_trigger_mm: number,
  rainfall_max_payout_mm: number,
  flood_trigger_level: number,
  payout_limit: number,
  status: string,
  created_at: timestamp
}
```

### `policy_rules`
```javascript
{
  policy_id: string,
  rule_name: string,
  rule_value: string,
  description: string
}
```

### `bank_accounts`
```javascript
{
  farmer_profile_id: string,
  account_holder_name: string,
  masked_account_number: string,
  bank_name: string,
  ifsc_code: string,
  verification_status: string,
  verified_at: timestamp,
  created_at: timestamp
}
```

## API Changes

### Authentication
- ❌ Removed: `/api/auth/register`, `/api/auth/login`, `/api/auth/sync`
- ✅ Kept: `/api/auth/me` (now reads from Firebase token only)

All authentication happens on the frontend via Firebase Auth SDK.

### IDs Changed
- **Before**: Integer IDs (`id: 1`, `id: 2`)
- **After**: Firestore document IDs (`id: "abc123..."`)

Update any frontend code that assumes integer IDs.

## Testing

1. **Register a new user**: Visit `/register` and create an account
2. **Login**: Use demo accounts or newly created account
3. **Create farmer profile**: As farmer, fill out profile
4. **Register a farm**: Add farm details with location
5. **Add crops**: Add crops to your farm
6. **Create policy**: As insurer, create a policy for a farmer
7. **View data**: Check that all data persists across page reloads

## Troubleshooting

### Backend won't start
- Check `backend/firebase-credentials.json` exists
- Verify file permissions
- Check Firebase project settings

### "Permission denied" errors
- Verify Firestore security rules are set correctly
- Ensure user is authenticated
- Check user role in Firestore `users` collection

### Data not appearing
- Check browser console for errors
- Verify Firestore indexes are created (Firebase does this automatically)
- Check Firebase Console → Firestore to see raw data

### Migration failed
- Ensure SQLite database exists at `backend/paratrust.db`
- Check that all foreign key relationships are valid
- Review migration script output for specific errors

## Rollback (If Needed)

If you need to rollback to SQLite:

1. Restore previous backend code from git:
   ```bash
   cd backend
   git checkout HEAD~1 -- app/
   ```

2. Reinstall SQLite dependencies:
   ```bash
   pip install sqlalchemy alembic passlib python-jose
   ```

3. Restart backend

## Performance Considerations

### Firestore Quotas (Free Tier)
- 50,000 reads/day
- 20,000 writes/day
- 20,000 deletes/day
- 1 GB storage

### Optimization Tips
1. **Cache user data** on frontend to reduce reads
2. **Batch writes** when creating multiple documents
3. **Use subcollections** for large datasets
4. **Index frequently queried fields** in Firestore

## Next Steps

1. ✅ Complete migration
2. ✅ Test all user flows
3. 🔄 Monitor Firestore usage in Firebase Console
4. 🔄 Set up Firebase Analytics (optional)
5. 🔄 Configure backup rules for Firestore
6. 🔄 Set up Cloud Functions for complex operations (optional)

## Support

For issues:
1. Check Firebase Console → Firestore for data
2. Check browser console for frontend errors
3. Check backend logs for API errors
4. Review this document for setup steps

---

**Migration Date**: $(date)
**Version**: 2.0.0 - Firebase Edition
