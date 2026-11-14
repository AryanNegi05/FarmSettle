import { apiFetch } from "./client";
import {
  getPoliciesFromFirestore,
  savePolicyToFirestore,
  updatePolicyInFirestore,
  getFarmersFromFirestore,
  saveFarmerToFirestore,
  saveFarmToFirestore,
  syncAllToFirestore,
} from "./firestoreService";

export { syncAllToFirestore };

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FarmerProfileCreate {
  phone?: string;
  address?: string;
  district?: string;
  state?: string;
}

export interface FarmerProfileOut {
  id: string;
  user_id: number;
  phone: string | null;
  address: string | null;
  district: string | null;
  state: string | null;
  created_at: string;
}

export interface CropCreate {
  crop_type: string;
  season?: string;
  area_hectares?: number;
}

export interface CropOut {
  id: string;
  farm_id: string;
  crop_type: string;
  season: string | null;
  area_hectares: number | null;
}

export interface FarmCreate {
  name: string;
  area_hectares?: number;
  latitude?: number;
  longitude?: number;
  boundary_geojson?: string;
  map_image_url?: string;
}

export interface FarmOut {
  id: string;
  farmer_profile_id: string;
  name: string;
  area_hectares: number | null;
  latitude: number | null;
  longitude: number | null;
  boundary_geojson: string | null;
  map_image_url?: string | null;
  created_at: string;
  crops: CropOut[];
}

export interface BankAccountCreate {
  account_holder_name: string;
  account_number: string;
  bank_name?: string;
  ifsc_code?: string;
}

export interface BankAccountOut {
  id: string;
  farmer_profile_id: string;
  account_holder_name: string;
  masked_account_number: string;
  bank_name: string | null;
  ifsc_code: string | null;
  verification_status: "pending" | "verified" | "failed";
  verified_at: string | null;
  created_at: string;
}

export interface PolicyCreate {
  policy_number: string;
  farm_id: string;
  farmer_profile_id: string;
  coverage_start: string;
  coverage_end: string;
  sum_insured: number;
  rainfall_trigger_mm?: number;
  rainfall_max_payout_mm?: number;
  flood_trigger_level?: number;
  payout_limit?: number;
  status?: string;
}

export interface PolicyUpdate {
  coverage_start?: string;
  coverage_end?: string;
  sum_insured?: number;
  // null clears an optional value
  rainfall_trigger_mm?: number | null;
  rainfall_max_payout_mm?: number | null;
  flood_trigger_level?: number | null;
  payout_limit?: number | null;
  status?: string;
}

export interface PolicyOut {
  id: string;
  policy_number: string;
  farm_id: string;
  farmer_profile_id: string;
  insurer_firebase_uid: string;
  farm_name?: string | null;
  farmer_name?: string | null;
  farmer_email?: string | null;
  coverage_start: string;
  coverage_end: string;
  sum_insured: number;
  rainfall_trigger_mm: number | null;
  rainfall_max_payout_mm: number | null;
  flood_trigger_level: number | null;
  payout_limit: number | null;
  status: string;
  created_at: string;
}

export interface FarmerSummary {
  id: string | number;
  user_id: number;
  full_name: string;
  email: string;
  phone: string | null;
  district: string | null;
  state: string | null;
  farm_count: number;
  policy_count: number;
}

export interface FarmerDetail extends FarmerSummary {
  farms: FarmOut[];
  policies: PolicyOut[];
}

// ─── API functions ────────────────────────────────────────────────────────────

// Farmer profile
export async function getMyProfile(): Promise<FarmerProfileOut> {
  return apiFetch<FarmerProfileOut>("/farmers/profile");
}

export async function upsertMyProfile(data: FarmerProfileCreate): Promise<FarmerProfileOut> {
  return apiFetch<FarmerProfileOut>("/farmers/profile", { method: "POST", body: data });
}

// Farms
export async function getMyFarms(): Promise<FarmOut[]> {
  const farms = await apiFetch<FarmOut[]>("/farmers/farms");
  farms.forEach((f) => {
    saveFarmToFirestore(f).catch(() => {});
  });
  return farms;
}

export async function createFarm(data: FarmCreate): Promise<FarmOut> {
  const farm = await apiFetch<FarmOut>("/farmers/farms", { method: "POST", body: data });
  saveFarmToFirestore(farm).catch(() => {});
  return farm;
}

export async function updateFarm(id: string | number, data: Partial<FarmCreate>): Promise<FarmOut> {
  const farm = await apiFetch<FarmOut>(`/farmers/farms/${id}`, { method: "PUT", body: data });
  saveFarmToFirestore(farm).catch(() => {});
  return farm;
}

/** Upload the traced-map snapshot (JPEG/PNG data URL). The server stores it on Cloudinary. */
export async function uploadFarmImage(id: string | number, imageDataUrl: string): Promise<FarmOut> {
  return apiFetch<FarmOut>(`/farmers/farms/${id}/image`, { method: "POST", body: { image_data_url: imageDataUrl } });
}

export async function getFarm(id: string | number): Promise<FarmOut> {
  return apiFetch<FarmOut>(`/farmers/farms/${id}`);
}

export async function addCrop(farmId: string | number, data: CropCreate): Promise<CropOut> {
  return apiFetch<CropOut>(`/farmers/farms/${farmId}/crops`, { method: "POST", body: data });
}

// Bank account
export async function getBankAccount(): Promise<BankAccountOut> {
  return apiFetch<BankAccountOut>("/farmers/bank-account");
}

export async function submitBankAccount(data: BankAccountCreate): Promise<BankAccountOut> {
  return apiFetch<BankAccountOut>("/farmers/bank-account", { method: "POST", body: data });
}

// Policies (insurer)
export async function listPolicies(farmerId?: string | number): Promise<PolicyOut[]> {
  // The backend is the source of truth (it also adds farmer and farm names).
  try {
    const qs = farmerId !== undefined ? `?farmer_id=${farmerId}` : "";
    return await apiFetch<PolicyOut[]>(`/policies/${qs}`);
  } catch (err) {
    console.warn("Backend policy list failed, falling back to Firestore:", err);
    return getPoliciesFromFirestore(farmerId);
  }
}

export async function getPolicy(id: string | number): Promise<PolicyOut> {
  return apiFetch<PolicyOut>(`/policies/${id}`);
}

export async function createPolicy(data: PolicyCreate): Promise<PolicyOut> {
  // The backend writes the policy to Firestore itself; no second write from the browser.
  return apiFetch<PolicyOut>("/policies/", { method: "POST", body: data });
}

export async function updatePolicy(id: string | number, data: PolicyUpdate): Promise<PolicyOut> {
  return apiFetch<PolicyOut>(`/policies/${id}`, { method: "PATCH", body: data });
}

// Admin / insurer farmer search
export async function searchFarmers(query?: string): Promise<FarmerSummary[]> {
  const qs = query ? `?search=${encodeURIComponent(query)}` : "";
  try {
    // Backend is the source of truth: correct profile ids and farm/policy counts.
    const backendFarmers = await apiFetch<FarmerSummary[]>(`/admin/farmers/${qs}`);
    backendFarmers.forEach((f) => { saveFarmerToFirestore(f).catch(() => {}); });
    return backendFarmers;
  } catch (err) {
    console.warn("Backend farmer list failed, falling back to Firestore:", err);
    return getFarmersFromFirestore(query);
  }
}

export async function getFarmerDetail(profileId: string | number): Promise<FarmerDetail> {
  return apiFetch<FarmerDetail>(`/admin/farmers/${profileId}`);
}
