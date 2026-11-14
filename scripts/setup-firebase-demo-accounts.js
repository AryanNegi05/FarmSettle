#!/usr/bin/env node
/**
 * Setup Firebase Demo Accounts
 * Creates demo accounts in Firebase Auth and Firestore
 * 
 * Usage: 
 *   cd scripts
 *   npm install firebase-admin (if needed)
 *   node setup-firebase-demo-accounts.js
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// Initialize Firebase Admin SDK
const serviceAccountPath = path.join(__dirname, '../backend/firebase-credentials.json');

if (!fs.existsSync(serviceAccountPath)) {
  console.error('❌ Error: firebase-credentials.json not found!');
  console.error('');
  console.error('Please follow these steps:');
  console.error('1. Go to Firebase Console: https://console.firebase.google.com/');
  console.error('2. Select your project');
  console.error('3. Go to Settings → Service Accounts');
  console.error('4. Click "Generate New Private Key"');
  console.error('5. Save the file as: backend/firebase-credentials.json');
  console.error('');
  process.exit(1);
}

try {
  const serviceAccount = require(serviceAccountPath);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('✅ Firebase Admin SDK initialized');
} catch (error) {
  console.error('❌ Failed to initialize Firebase Admin SDK');
  console.error(error.message);
  process.exit(1);
}

const auth = admin.auth();
const db = admin.firestore();

const DEMO_ACCOUNTS = [
  {
    email: 'farmer@paratrust.dev',
    password: 'farmer123',
    role: 'farmer',
    displayName: 'Demo Farmer'
  },
  {
    email: 'insurer@paratrust.dev',
    password: 'insurer123',
    role: 'insurer',
    displayName: 'Demo Insurer'
  },
  {
    email: 'auditor@paratrust.dev',
    password: 'auditor123',
    role: 'auditor',
    displayName: 'Demo Auditor'
  },
  {
    email: 'admin@paratrust.dev',
    password: 'admin123',
    role: 'admin',
    displayName: 'Demo Admin'
  }
];

async function createOrUpdateAccount(account) {
  try {
    let user;
    
    // Try to get existing user
    try {
      user = await auth.getUserByEmail(account.email);
      console.log(`✓ User ${account.email} already exists (UID: ${user.uid})`);
      
      // Update password and display name
      await auth.updateUser(user.uid, {
        password: account.password,
        displayName: account.displayName
      });
      console.log(`  → Updated password and display name for ${account.email}`);
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        // Create new user
        user = await auth.createUser({
          email: account.email,
          password: account.password,
          displayName: account.displayName,
          emailVerified: true
        });
        console.log(`✅ Created user ${account.email} (UID: ${user.uid})`);
      } else {
        throw error;
      }
    }
    
    // Create/update Firestore document
    const userRef = db.collection('users').doc(user.uid);
    await userRef.set({
      uid: user.uid,
      email: account.email,
      full_name: account.displayName,
      role: account.role,
      is_active: true,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    
    console.log(`  → Firestore document updated for ${account.email}`);
    
    return { success: true, uid: user.uid, email: account.email };
  } catch (error) {
    console.error(`❌ Error with ${account.email}:`, error.message);
    return { success: false, email: account.email, error: error.message };
  }
}

async function main() {
  console.log('🚀 Setting up Firebase demo accounts...\n');
  
  const results = [];
  
  for (const account of DEMO_ACCOUNTS) {
    const result = await createOrUpdateAccount(account);
    results.push(result);
    console.log('');
  }
  
  console.log('═'.repeat(60));
  console.log('SUMMARY');
  console.log('═'.repeat(60));
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`✅ Successful: ${successful.length}`);
  if (failed.length > 0) {
    console.log(`❌ Failed: ${failed.length}`);
    failed.forEach(f => console.log(`   - ${f.email}: ${f.error}`));
  }
  
  console.log('\n📋 Demo Accounts:');
  console.log('─'.repeat(60));
  DEMO_ACCOUNTS.forEach(acc => {
    console.log(`${acc.role.padEnd(10)} | ${acc.email.padEnd(30)} | ${acc.password}`);
  });
  console.log('─'.repeat(60));
  
  console.log('\n✨ Setup complete! You can now use these accounts to log in.');
  console.log('\n💡 Next steps:');
  console.log('   1. Start the backend: cd backend && uvicorn app.main:app --reload');
  console.log('   2. Start the frontend: cd frontend && npm run dev');
  console.log('   3. Visit http://localhost:5173 and login with any demo account');
  
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
