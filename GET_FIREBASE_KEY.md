# Get Firebase Service Account Key

Your Firebase project is already configured in the frontend, but the backend needs a **service account key** to access Firestore.

## Steps to Get the Key

### 1. Go to Firebase Console
Visit: https://console.firebase.google.com/project/parasf-3b57b/settings/serviceaccounts/adminsdk

(Or manually: Firebase Console → Your Project → Settings ⚙️ → Service Accounts)

### 2. Generate Private Key

1. You should see a section **"Firebase Admin SDK"**
2. Click the button **"Generate new private key"**
3. A dialog will appear - click **"Generate key"**
4. A JSON file will be downloaded (e.g., `parasf-3b57b-firebase-adminsdk-xxxxx-xxxxxxxxxx.json`)

### 3. Save the File

Rename and move the downloaded file:

```bash
# From your Downloads folder
mv ~/Downloads/parasf-3b57b-firebase-adminsdk-*.json ~/Downloads/Parametric/backend/firebase-credentials.json
```

Or manually:
1. Rename the downloaded file to: `firebase-credentials.json`
2. Move it to: `/Users/shubhamyadav/Downloads/Parametric/backend/firebase-credentials.json`

### 4. Verify

```bash
cd /Users/shubhamyadav/Downloads/Parametric/backend
ls -la firebase-credentials.json
```

You should see the file listed.

## Security Note

⚠️ **This file contains sensitive credentials!**

- Never commit it to git (already in .gitignore)
- Never share it publicly
- Keep it secure on your local machine

## Next Steps

Once you have the file in place:

1. **Setup demo accounts**:
   ```bash
   cd /Users/shubhamyadav/Downloads/Parametric/scripts
   npm install
   node setup-firebase-demo-accounts.js
   ```

2. **Start the backend**:
   ```bash
   cd /Users/shubhamyadav/Downloads/Parametric/backend
   source venv/bin/activate
   uvicorn app.main:app --reload
   ```

3. **Start the frontend** (in another terminal):
   ```bash
   cd /Users/shubhamyadav/Downloads/Parametric/frontend
   npm run dev
   ```

---

**Your Firebase Project Info:**
- Project ID: `parasf-3b57b`
- Auth Domain: `parasf-3b57b.firebaseapp.com`
- Already configured in frontend ✅
- Need service account key for backend ⏳
