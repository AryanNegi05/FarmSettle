import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  User as FirebaseUser,
} from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { auth, db } from "../config/firebase";
import { DEMO_ROLES } from "../config/constants";

export type UserRole = "farmer" | "insurer" | "auditor" | "admin";

export interface UserOut {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
  created_at?: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  role: UserRole;
  user_id: string;
  full_name: string | null;
}

export interface RegisterPayload {
  email: string;
  password: string;
  full_name?: string;
  role?: UserRole;
}

export interface LoginPayload {
  email: string;
  password: string;
}


/**
 * Ensures a user document exists in Firestore.
 */
/** Make sure farmers/{uid} exists for farmer accounts (merge: never wipes farm_ids). */
async function ensureFarmerDoc(user: FirebaseUser, role: string, fullName?: string | null): Promise<void> {
  if (role !== "farmer") return;
  try {
    await setDoc(doc(db, "farmers", user.uid), {
      farmer_id: user.uid,
      farmer_uid: user.uid,
      email: user.email,
      full_name: fullName || user.displayName || null,
      updated_at: serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    console.warn("[farmers] could not create farmers doc", err);
  }
}

async function syncUserProfile(
  user: FirebaseUser,
  defaultRole: UserRole = "farmer",
  fullName?: string | null
): Promise<UserOut> {
  const baseProfile: UserOut = {
    id: user.uid,
    email: user.email || "",
    full_name: fullName || user.displayName || null,
    role: defaultRole,
    is_active: true,
  };

  try {
    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);

    if (snap.exists()) {
      const data = snap.data();
      await ensureFarmerDoc(user, (data.role as string) || defaultRole, data.full_name || fullName);
      return {
        id: user.uid,
        email: user.email || data.email,
        full_name: data.full_name || fullName || user.displayName || null,
        role: (data.role as UserRole) || defaultRole,
        is_active: data.is_active !== undefined ? data.is_active : true,
        created_at: data.created_at ? data.created_at.toString() : undefined,
      };
    }

    // Create new profile doc in Firestore
    await setDoc(userRef, {
      uid: user.uid,
      email: user.email,
      full_name: fullName || user.displayName || null,
      role: defaultRole,
      is_active: true,
      created_at: serverTimestamp(),
    }, { merge: true });
    await ensureFarmerDoc(user, defaultRole, fullName);

  } catch (err: any) {
    // Firestore not provisioned or rules blocking — fall back to Auth-only profile
    console.warn("Firestore unavailable, using Auth-only profile:", err?.message);
  }

  return baseProfile;
}

export const authApi = {
  /**
   * Register a new user in Firebase Auth and store profile in Firestore.
   */
  register: async (payload: RegisterPayload): Promise<UserOut> => {
    try {
      const cred = await createUserWithEmailAndPassword(auth, payload.email, payload.password);
      const role = payload.role || DEMO_ROLES[payload.email.toLowerCase()] || "farmer";
      const profile = await syncUserProfile(cred.user, role, payload.full_name);

      return profile;
    } catch (err: any) {
      if (err.code === "auth/email-already-in-use") {
        throw new Error("Email is already registered. Please sign in instead.");
      } else if (err.code === "auth/weak-password") {
        throw new Error("Password should be at least 6 characters.");
      } else if (err.code === "auth/operation-not-allowed") {
        throw new Error(
          "Email/Password authentication is not enabled in Firebase Console. Enable it in Authentication > Sign-in method."
        );
      }
      throw new Error(err.message || "Failed to create account");
    }
  },

  /**
   * Sign in using Firebase Auth, then retrieve profile from Firestore.
   * If a demo account does not exist in Firebase Auth yet, it auto-registers it.
   */
  login: async (payload: LoginPayload): Promise<TokenResponse> => {
    let cred;
    const lowerEmail = payload.email.toLowerCase();
    const demoRole = DEMO_ROLES[lowerEmail];

    try {
      cred = await signInWithEmailAndPassword(auth, payload.email, payload.password);
    } catch (err: any) {
      // If it's a known demo account and doesn't exist yet, auto-provision it
      if (
        (err.code === "auth/user-not-found" || err.code === "auth/invalid-credential") &&
        demoRole
      ) {
        try {
          cred = await createUserWithEmailAndPassword(auth, payload.email, payload.password);
        } catch (createErr: any) {
          throw new Error(createErr.message || "Authentication failed");
        }
      } else if (err.code === "auth/operation-not-allowed") {
        throw new Error(
          "Email/Password authentication is not enabled in your Firebase project. Please enable it in Firebase Console > Authentication > Sign-in method."
        );
      } else if (err.code === "auth/invalid-credential" || err.code === "auth/wrong-password") {
        throw new Error("Invalid email or password.");
      } else {
        throw new Error(err.message || "Login failed");
      }
    }

    const role = demoRole || "farmer";
    const userProfile = await syncUserProfile(cred.user, role);
    const token = await cred.user.getIdToken();

    return {
      access_token: token,
      token_type: "bearer",
      role: userProfile.role,
      user_id: userProfile.id,
      full_name: userProfile.full_name,
    };
  },

  /**
   * Get current authenticated user profile from Firestore.
   */
  me: async (): Promise<UserOut> => {
    const current = auth.currentUser;
    if (!current) {
      throw new Error("Not authenticated");
    }
    const demoRole = DEMO_ROLES[current.email?.toLowerCase() || ""];
    return await syncUserProfile(current, demoRole || "farmer");
  },

  /**
   * Sign out from Firebase.
   */
  logout: async (): Promise<void> => {
    await firebaseSignOut(auth);
  },
};
