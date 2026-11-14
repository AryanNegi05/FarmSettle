import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
} from "firebase/firestore";
import { db } from "../config/firebase";
import { apiFetch } from "./client";
import type {
  PolicyOut,
  PolicyCreate,
  PolicyUpdate,
  FarmerSummary,
  FarmOut,
  FarmerDetail,
  CropOut,
} from "./stage2";

// ── Policies ──────────────────────────────────────────────────────────────────

export async function getPoliciesFromFirestore(farmerId?: number): Promise<PolicyOut[]> {
  const colRef = collection(db, "policies");
  let q = colRef;
  if (farmerId !== undefined) {
    q = query(colRef, where("farmer_profile_id", "==", farmerId)) as any;
  }
  const snap = await getDocs(q);
  const results: PolicyOut[] = [];
  snap.forEach((d) => {
    const data = d.data();
    results.push({
      id: typeof data.id === "number" ? data.id : parseInt(d.id, 10) || 1,
      policy_number: data.policy_number || d.id,
      farm_id: Number(data.farm_id) || 0,
      farmer_profile_id: Number(data.farmer_profile_id) || 0,
      insurer_id: Number(data.insurer_id) || 1,
      coverage_start: data.coverage_start || "",
      coverage_end: data.coverage_end || "",
      sum_insured: Number(data.sum_insured) || 0,
      rainfall_trigger_mm: data.rainfall_trigger_mm != null ? Number(data.rainfall_trigger_mm) : null,
      rainfall_max_payout_mm: data.rainfall_max_payout_mm != null ? Number(data.rainfall_max_payout_mm) : null,
      flood_trigger_level: data.flood_trigger_level != null ? Number(data.flood_trigger_level) : null,
      payout_limit: data.payout_limit != null ? Number(data.payout_limit) : null,
      status: data.status || "active",
      created_at: data.created_at ? String(data.created_at) : new Date().toISOString(),
    });
  });
  return results;
}

export async function savePolicyToFirestore(policy: PolicyOut): Promise<void> {
  const docRef = doc(db, "policies", String(policy.id || policy.policy_number));
  await setDoc(docRef, {
    ...policy,
    updated_at: new Date().toISOString(),
  }, { merge: true });
}

export async function updatePolicyInFirestore(id: number, data: PolicyUpdate): Promise<void> {
  const docRef = doc(db, "policies", String(id));
  await updateDoc(docRef, {
    ...data,
    updated_at: new Date().toISOString(),
  });
}

// ── Farmers ───────────────────────────────────────────────────────────────────

export async function getFarmersFromFirestore(queryStr?: string): Promise<FarmerSummary[]> {
  const snap = await getDocs(collection(db, "farmers"));
  let results: FarmerSummary[] = [];
  snap.forEach((d) => {
    const data = d.data();
    results.push({
      id: typeof data.id === "number" ? data.id : parseInt(d.id, 10) || 1,
      user_id: Number(data.user_id) || 1,
      full_name: data.full_name || "Farmer",
      email: data.email || "",
      phone: data.phone || null,
      district: data.district || null,
      state: data.state || null,
      farm_count: Number(data.farm_count) || 0,
      policy_count: Number(data.policy_count) || 0,
    });
  });

  if (queryStr && queryStr.trim()) {
    const lower = queryStr.toLowerCase().trim();
    results = results.filter(
      (f) =>
        f.full_name.toLowerCase().includes(lower) ||
        f.email.toLowerCase().includes(lower) ||
        (f.district && f.district.toLowerCase().includes(lower))
    );
  }
  return results;
}

export async function saveFarmerToFirestore(farmer: FarmerSummary): Promise<void> {
  const docRef = doc(db, "farmers", String(farmer.id));
  await setDoc(docRef, {
    ...farmer,
    updated_at: new Date().toISOString(),
  }, { merge: true });
}

// ── Farms ─────────────────────────────────────────────────────────────────────

export async function getFarmsFromFirestore(farmerProfileId?: number): Promise<FarmOut[]> {
  const colRef = collection(db, "farms");
  let q = colRef;
  if (farmerProfileId !== undefined) {
    q = query(colRef, where("farmer_profile_id", "==", farmerProfileId)) as any;
  }
  const snap = await getDocs(q);
  const results: FarmOut[] = [];
  snap.forEach((d) => {
    const data = d.data();
    results.push({
      id: typeof data.id === "number" ? data.id : parseInt(d.id, 10) || 1,
      farmer_profile_id: Number(data.farmer_profile_id) || 0,
      name: data.name || "Farm Plot",
      area_hectares: data.area_hectares != null ? Number(data.area_hectares) : null,
      latitude: data.latitude != null ? Number(data.latitude) : null,
      longitude: data.longitude != null ? Number(data.longitude) : null,
      boundary_geojson: data.boundary_geojson || null,
      created_at: data.created_at ? String(data.created_at) : new Date().toISOString(),
      crops: (data.crops as CropOut[]) || [],
    });
  });
  return results;
}

export async function saveFarmToFirestore(farm: FarmOut): Promise<void> {
  const docRef = doc(db, "farms", String(farm.id));
  await setDoc(docRef, {
    ...farm,
    updated_at: new Date().toISOString(),
  }, { merge: true });
}

// ── Full Firebase Sync ────────────────────────────────────────────────────────

/**
 * Syncs all farmers, farms, and policies from backend database into Firebase Firestore.
 */
export async function syncAllToFirestore(): Promise<{
  farmers: number;
  farms: number;
  policies: number;
}> {
  // 1. Fetch all farmers from backend
  const farmers = await apiFetch<FarmerSummary[]>("/admin/farmers/");
  for (const f of farmers) {
    await saveFarmerToFirestore(f);
  }

  // 2. Fetch all policies from backend
  const policies = await apiFetch<PolicyOut[]>("/policies/");
  for (const p of policies) {
    await savePolicyToFirestore(p);
  }

  // 3. Fetch all farms for each farmer
  let totalFarms = 0;
  for (const f of farmers) {
    try {
      const detail = await apiFetch<FarmerDetail>(`/admin/farmers/${f.id}`);
      if (detail.farms && detail.farms.length > 0) {
        for (const farm of detail.farms) {
          await saveFarmToFirestore(farm);
          totalFarms++;
        }
      }
    } catch {
      // Continue next farmer
    }
  }

  return {
    farmers: farmers.length,
    farms: totalFarms,
    policies: policies.length,
  };
}

