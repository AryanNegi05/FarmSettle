"""Firestore service for CRUD operations on all business entities."""
from typing import Optional, List, Dict, Any
from datetime import datetime
from google.cloud.firestore_v1 import FieldFilter
from app.core.firebase_auth import get_firestore_db


class FirestoreService:
    """Service layer for Firestore operations."""
    
    def __init__(self):
        self.db = get_firestore_db()
    
    # ═══════════════════════════════════════════════════════════════════════════
    # FARMER PROFILES
    # ═══════════════════════════════════════════════════════════════════════════
    
    def mirror_farmer(self, profile_id: str, add_farm_id: Optional[str] = None) -> None:
        """Maintain the `farmers/{farmer_id}` document (one per farmer, linked to their farms).

        Never raises: a failure here must not break the main write.
        """
        try:
            from google.cloud import firestore as gfs
            prof_snap = self.db.collection("farmer_profiles").document(profile_id).get()
            if not prof_snap.exists:
                return
            prof = prof_snap.to_dict() or {}
            uid = prof.get("firebase_uid")
            user: Dict[str, Any] = {}
            if uid:
                u = self.db.collection("users").document(uid).get()
                user = (u.to_dict() or {}) if u.exists else {}
            if not uid:
                return
            doc: Dict[str, Any] = {
                # Keyed by Firebase uid so the browser (registration) and backend agree.
                "farmer_id": uid,
                "farmer_uid": uid,
                "profile_id": profile_id,
                "full_name": user.get("full_name"),
                "email": user.get("email"),
                "phone": prof.get("phone"),
                "address": prof.get("address"),
                "district": prof.get("district"),
                "state": prof.get("state"),
                "updated_at": datetime.utcnow(),
            }
            if add_farm_id:
                doc["farm_ids"] = gfs.ArrayUnion([add_farm_id])
            self.db.collection("farmers").document(uid).set(doc, merge=True)
        except Exception as exc:  # noqa: BLE001
            import logging
            logging.getLogger("uvicorn.error").warning("farmers mirror failed for %s: %s", profile_id, exc)

    def backfill_farmers(self) -> int:
        """Create/refresh `farmers` docs for every existing profile, linking their farms."""
        n = 0
        for prof in self.db.collection("farmer_profiles").stream():
            self.mirror_farmer(prof.id)
            uid = (prof.to_dict() or {}).get("firebase_uid")
            farm_ids = [f.id for f in self.db.collection("farms").where(
                filter=FieldFilter("farmer_profile_id", "==", prof.id)).stream()]
            if uid and farm_ids:
                self.db.collection("farmers").document(uid).set({"farm_ids": farm_ids}, merge=True)
            n += 1
        return n

    def create_farmer_profile(self, firebase_uid: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a farmer profile."""
        profile_data = {
            "firebase_uid": firebase_uid,
            "phone": data.get("phone"),
            "address": data.get("address"),
            "district": data.get("district"),
            "state": data.get("state"),
            "created_at": datetime.utcnow(),
        }
        
        doc_ref = self.db.collection("farmer_profiles").document()
        doc_ref.set(profile_data)
        
        profile_data["id"] = doc_ref.id
        self.mirror_farmer(doc_ref.id)
        return profile_data
    
    def get_farmer_profile_by_uid(self, firebase_uid: str) -> Optional[Dict[str, Any]]:
        """Get farmer profile by Firebase UID."""
        profiles = self.db.collection("farmer_profiles").where(
            filter=FieldFilter("firebase_uid", "==", firebase_uid)
        ).limit(1).stream()
        
        for doc in profiles:
            profile = doc.to_dict()
            profile["id"] = doc.id
            return profile
        
        return None
    
    def get_farmer_profile_by_id(self, profile_id: str) -> Optional[Dict[str, Any]]:
        """Get farmer profile by ID."""
        doc = self.db.collection("farmer_profiles").document(profile_id).get()
        if doc.exists:
            profile = doc.to_dict()
            profile["id"] = doc.id
            return profile
        return None
    
    def update_farmer_profile(self, profile_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Update farmer profile."""
        doc_ref = self.db.collection("farmer_profiles").document(profile_id)
        doc_ref.update(data)
        
        updated = doc_ref.get().to_dict()
        updated["id"] = profile_id
        self.mirror_farmer(profile_id)
        return updated
    
    def list_all_farmer_profiles(self, search_query: Optional[str] = None) -> List[Dict[str, Any]]:
        """List all farmer profiles with optional search."""
        query = self.db.collection("farmer_profiles")
        
        profiles = []
        for doc in query.stream():
            profile = doc.to_dict()
            profile["id"] = doc.id
            profiles.append(profile)
        
        return profiles
    
    # ═══════════════════════════════════════════════════════════════════════════
    # FARMS
    # ═══════════════════════════════════════════════════════════════════════════
    
    @staticmethod
    def _boundary_coordinates(boundary_geojson: Optional[str]) -> List[Dict[str, float]]:
        """Traced boundary as a list of {lat, lng} points (Firestore can't store nested arrays)."""
        if not boundary_geojson:
            return []
        try:
            import json
            data = json.loads(boundary_geojson)
            geom = data.get("geometry", data) if isinstance(data, dict) else {}
            ring = geom["coordinates"][0] if geom.get("type") == "Polygon" else []
            pts = [{"lat": float(lat), "lng": float(lng)} for lng, lat in ring]
            if len(pts) > 1 and pts[0] == pts[-1]:
                pts = pts[:-1]
            return pts
        except Exception:
            return []

    def create_farm(self, farmer_profile_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a farm."""
        doc_ref = self.db.collection("farms").document()
        profile = self.db.collection("farmer_profiles").document(farmer_profile_id).get()
        farmer_uid = (profile.to_dict() or {}).get("firebase_uid") if profile.exists else None
        farm_data = {
            # Identity: who owns this farm and its own id
            "farm_id": doc_ref.id,
            "farmer_id": farmer_uid or farmer_profile_id,  # Firebase uid = farmers/{id}
            "farmer_uid": farmer_uid,
            "farmer_profile_id": farmer_profile_id,  # kept for existing code
            # Location
            "coordinates": self._boundary_coordinates(data.get("boundary_geojson")),
            "name": data.get("name"),
            "area_hectares": data.get("area_hectares"),
            "latitude": data.get("latitude"),
            "longitude": data.get("longitude"),
            "boundary_geojson": data.get("boundary_geojson"),
            "map_image_url": data.get("map_image_url"),
            "image_url": data.get("map_image_url"),  # Cloudinary link
            "created_at": datetime.utcnow(),
        }

        doc_ref.set(farm_data)
        self.mirror_farmer(farmer_profile_id, add_farm_id=doc_ref.id)

        farm_data["id"] = doc_ref.id
        return farm_data
    
    def get_farm_by_id(self, farm_id: str) -> Optional[Dict[str, Any]]:
        """Get farm by ID."""
        doc = self.db.collection("farms").document(farm_id).get()
        if doc.exists:
            farm = doc.to_dict()
            farm["id"] = doc.id
            return farm
        return None
    
    def update_farm(self, farm_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update fields on a farm and return the updated document."""
        doc_ref = self.db.collection("farms").document(farm_id)
        data = dict(data)
        if "boundary_geojson" in data:
            data["coordinates"] = self._boundary_coordinates(data["boundary_geojson"])
        if "map_image_url" in data:
            data["image_url"] = data["map_image_url"]
        doc_ref.update(data)
        doc = doc_ref.get()
        if not doc.exists:
            return None
        farm = doc.to_dict()
        farm["id"] = doc.id
        return farm

    def list_farms_by_profile(self, farmer_profile_id: str) -> List[Dict[str, Any]]:
        """List all farms for a farmer profile."""
        farms = []
        docs = self.db.collection("farms").where(
            filter=FieldFilter("farmer_profile_id", "==", farmer_profile_id)
        ).stream()
        
        for doc in docs:
            farm = doc.to_dict()
            farm["id"] = doc.id
            farms.append(farm)
        
        return farms
    
    def list_all_farms(self) -> List[Dict[str, Any]]:
        """List all farms."""
        farms = []
        for doc in self.db.collection("farms").stream():
            farm = doc.to_dict()
            farm["id"] = doc.id
            farms.append(farm)
        return farms
    
    # ═══════════════════════════════════════════════════════════════════════════
    # CLAIMS  (document id = idempotency key "farm__event__policy")
    # ═══════════════════════════════════════════════════════════════════════════

    def create_claim_once(self, claim_id: str, data: Dict[str, Any]) -> tuple[Dict[str, Any], bool]:
        """Create a claim; if one already exists for this settlement identity return it.

        Firestore `create()` fails atomically when the document exists, so two
        simultaneous requests can never produce two claims.
        """
        from google.api_core.exceptions import AlreadyExists
        ref = self.db.collection("claims").document(claim_id)
        try:
            ref.create(data)
            return {**data, "id": claim_id}, True
        except AlreadyExists:
            existing = ref.get().to_dict() or {}
            existing["id"] = claim_id
            return existing, False

    def get_claim(self, claim_id: str) -> Optional[Dict[str, Any]]:
        doc = self.db.collection("claims").document(claim_id).get()
        if not doc.exists:
            return None
        claim = doc.to_dict()
        claim["id"] = doc.id
        return claim

    def list_claims(self, status: Optional[str] = None) -> List[Dict[str, Any]]:
        claims = []
        for doc in self.db.collection("claims").stream():
            c = doc.to_dict()
            c["id"] = doc.id
            if status and c.get("status") != status:
                continue
            claims.append(c)
        claims.sort(key=lambda c: c.get("created_at", ""), reverse=True)
        return claims

    def list_claims_by_policy(self, policy_id: str) -> List[Dict[str, Any]]:
        docs = self.db.collection("claims").where(filter=FieldFilter("policy_id", "==", policy_id)).stream()
        out = []
        for doc in docs:
            c = doc.to_dict()
            c["id"] = doc.id
            out.append(c)
        return out

    def update_claim(self, claim_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        ref = self.db.collection("claims").document(claim_id)
        ref.update(data)
        claim = ref.get().to_dict()
        claim["id"] = claim_id
        return claim

    # ═══════════════════════════════════════════════════════════════════════════
    # PAYMENTS  (document id = claim id, so one payment per settlement)
    # ═══════════════════════════════════════════════════════════════════════════

    def create_payment_once(self, claim_id: str, data: Dict[str, Any]) -> tuple[Dict[str, Any], bool]:
        from google.api_core.exceptions import AlreadyExists
        ref = self.db.collection("payments").document(claim_id)
        try:
            ref.create(data)
            return {**data, "id": claim_id}, True
        except AlreadyExists:
            existing = ref.get().to_dict() or {}
            existing["id"] = claim_id
            return existing, False

    def get_payment(self, claim_id: str) -> Optional[Dict[str, Any]]:
        doc = self.db.collection("payments").document(claim_id).get()
        if not doc.exists:
            return None
        p = doc.to_dict()
        p["id"] = doc.id
        return p

    def list_payments(self) -> List[Dict[str, Any]]:
        out = []
        for doc in self.db.collection("payments").stream():
            p = doc.to_dict()
            p["id"] = doc.id
            out.append(p)
        out.sort(key=lambda p: p.get("created_at", ""), reverse=True)
        return out

    # ═══════════════════════════════════════════════════════════════════════════
    # CROPS
    # ═══════════════════════════════════════════════════════════════════════════
    
    def create_crop(self, farm_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a crop."""
        crop_data = {
            "farm_id": farm_id,
            "crop_type": data.get("crop_type"),
            "season": data.get("season"),
            "area_hectares": data.get("area_hectares"),
        }
        
        doc_ref = self.db.collection("crops").document()
        doc_ref.set(crop_data)
        
        crop_data["id"] = doc_ref.id
        return crop_data
    
    def list_crops_by_farm(self, farm_id: str) -> List[Dict[str, Any]]:
        """List all crops for a farm."""
        crops = []
        docs = self.db.collection("crops").where(
            filter=FieldFilter("farm_id", "==", farm_id)
        ).stream()
        
        for doc in docs:
            crop = doc.to_dict()
            crop["id"] = doc.id
            crops.append(crop)
        
        return crops
    
    # ═══════════════════════════════════════════════════════════════════════════
    # INSURANCE POLICIES
    # ═══════════════════════════════════════════════════════════════════════════
    
    @staticmethod
    def _firestore_safe(data: Dict[str, Any]) -> Dict[str, Any]:
        """Firestore cannot store datetime.date; keep calendar dates as ISO strings (YYYY-MM-DD)."""
        from datetime import date as _date
        return {k: (v.isoformat() if isinstance(v, _date) and not isinstance(v, datetime) else v) for k, v in data.items()}

    def create_policy(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Create an insurance policy."""
        data = self._firestore_safe(data)
        policy_data = {
            "policy_number": data.get("policy_number"),
            "farm_id": data.get("farm_id"),
            "farmer_profile_id": data.get("farmer_profile_id"),
            "insurer_firebase_uid": data.get("insurer_firebase_uid"),
            "coverage_start": data.get("coverage_start"),
            "coverage_end": data.get("coverage_end"),
            "sum_insured": data.get("sum_insured"),
            "rainfall_trigger_mm": data.get("rainfall_trigger_mm"),
            "rainfall_max_payout_mm": data.get("rainfall_max_payout_mm"),
            "flood_trigger_level": data.get("flood_trigger_level"),
            "payout_limit": data.get("payout_limit"),
            "status": data.get("status", "active"),
            "created_at": datetime.utcnow(),
        }
        
        doc_ref = self.db.collection("policies").document()
        doc_ref.set(policy_data)
        
        policy_data["id"] = doc_ref.id
        return policy_data
    
    def get_policy_by_id(self, policy_id: str) -> Optional[Dict[str, Any]]:
        """Get policy by ID."""
        doc = self.db.collection("policies").document(policy_id).get()
        if doc.exists:
            policy = doc.to_dict()
            policy["id"] = doc.id
            return policy
        return None
    
    def get_policy_by_number(self, policy_number: str) -> Optional[Dict[str, Any]]:
        """Get policy by policy number."""
        policies = self.db.collection("policies").where(
            filter=FieldFilter("policy_number", "==", policy_number)
        ).limit(1).stream()
        
        for doc in policies:
            policy = doc.to_dict()
            policy["id"] = doc.id
            return policy
        
        return None
    
    def list_policies_by_profile(self, farmer_profile_id: str) -> List[Dict[str, Any]]:
        """List all policies for a farmer profile."""
        policies = []
        docs = self.db.collection("policies").where(
            filter=FieldFilter("farmer_profile_id", "==", farmer_profile_id)
        ).stream()
        
        for doc in docs:
            policy = doc.to_dict()
            policy["id"] = doc.id
            policies.append(policy)
        
        return policies
    
    def list_all_policies(self) -> List[Dict[str, Any]]:
        """List all policies."""
        policies = []
        for doc in self.db.collection("policies").stream():
            policy = doc.to_dict()
            policy["id"] = doc.id
            policies.append(policy)
        return policies
    
    def update_policy(self, policy_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Update a policy."""
        doc_ref = self.db.collection("policies").document(policy_id)
        doc_ref.update(self._firestore_safe(data))
        
        updated = doc_ref.get().to_dict()
        updated["id"] = policy_id
        return updated
    
    # ═══════════════════════════════════════════════════════════════════════════
    # POLICY RULES
    # ═══════════════════════════════════════════════════════════════════════════
    
    def create_policy_rule(self, policy_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a policy rule."""
        rule_data = {
            "policy_id": policy_id,
            "rule_name": data.get("rule_name"),
            "rule_value": data.get("rule_value"),
            "description": data.get("description"),
        }
        
        doc_ref = self.db.collection("policy_rules").document()
        doc_ref.set(rule_data)
        
        rule_data["id"] = doc_ref.id
        return rule_data
    
    def list_rules_by_policy(self, policy_id: str) -> List[Dict[str, Any]]:
        """List all rules for a policy."""
        rules = []
        docs = self.db.collection("policy_rules").where(
            filter=FieldFilter("policy_id", "==", policy_id)
        ).stream()
        
        for doc in docs:
            rule = doc.to_dict()
            rule["id"] = doc.id
            rules.append(rule)
        
        return rules
    
    # ═══════════════════════════════════════════════════════════════════════════
    # BANK ACCOUNTS
    # ═══════════════════════════════════════════════════════════════════════════
    
    def create_bank_account(self, farmer_profile_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Create or update a bank account reference."""
        # Check if bank account already exists for this profile
        existing = self.get_bank_account_by_profile(farmer_profile_id)
        
        bank_data = {
            "farmer_profile_id": farmer_profile_id,
            "account_holder_name": data.get("account_holder_name"),
            "masked_account_number": data.get("masked_account_number"),
            "bank_name": data.get("bank_name"),
            "ifsc_code": data.get("ifsc_code"),
            "verification_status": data.get("verification_status", "verified"),
            "verified_at": datetime.utcnow(),
            "created_at": data.get("created_at", datetime.utcnow()),
        }
        
        if existing:
            # Update existing
            doc_ref = self.db.collection("bank_accounts").document(existing["id"])
            doc_ref.update(bank_data)
            bank_data["id"] = existing["id"]
        else:
            # Create new
            doc_ref = self.db.collection("bank_accounts").document()
            doc_ref.set(bank_data)
            bank_data["id"] = doc_ref.id
        
        return bank_data
    
    def get_bank_account_by_profile(self, farmer_profile_id: str) -> Optional[Dict[str, Any]]:
        """Get bank account for a farmer profile."""
        accounts = self.db.collection("bank_accounts").where(
            filter=FieldFilter("farmer_profile_id", "==", farmer_profile_id)
        ).limit(1).stream()
        
        for doc in accounts:
            account = doc.to_dict()
            account["id"] = doc.id
            return account
        
        return None


    # ═══════════════════════════════════════════════════════════════════════════
    # SIMULATION RUNS
    # ═══════════════════════════════════════════════════════════════════════════

    def create_simulation_run(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a simulation run."""
        run_data = {
            "scenario": data.get("scenario"),
            "seed": data.get("seed"),
            "current_tick": data.get("current_tick", 0),
            "total_ticks": data.get("total_ticks"),
            "status": data.get("status", "paused"),
            "created_by": data.get("created_by"),
            "created_at": datetime.utcnow(),
        }
        doc_ref = self.db.collection("simulation_runs").document()
        doc_ref.set(run_data)
        run_data["id"] = doc_ref.id
        return run_data

    def get_simulation_run(self, run_id: str) -> Optional[Dict[str, Any]]:
        """Get a simulation run by ID."""
        doc = self.db.collection("simulation_runs").document(run_id).get()
        if doc.exists:
            r = doc.to_dict()
            r["id"] = doc.id
            return r
        return None

    def list_simulation_runs(self, limit: int = 20) -> List[Dict[str, Any]]:
        """List simulation runs ordered by creation time (newest first)."""
        runs = []
        for doc in (
            self.db.collection("simulation_runs")
            .order_by("created_at", direction="DESCENDING")
            .limit(limit)
            .stream()
        ):
            r = doc.to_dict()
            r["id"] = doc.id
            runs.append(r)
        return runs

    def update_simulation_run(self, run_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Update a simulation run (partial update)."""
        doc_ref = self.db.collection("simulation_runs").document(run_id)
        doc_ref.update(data)
        updated = doc_ref.get().to_dict()
        updated["id"] = run_id
        return updated

    # ═══════════════════════════════════════════════════════════════════════════
    # SENSOR TRUST SCORES
    # ═══════════════════════════════════════════════════════════════════════════

    def upsert_sensor_trust_score(self, run_id: str, sensor_id: str, tick: int,
                                   data: Dict[str, Any]) -> Dict[str, Any]:
        """Upsert a sensor trust score for a given run/sensor/tick."""
        from google.cloud.firestore_v1 import FieldFilter
        # Check if record already exists
        existing_docs = list(
            self.db.collection("sensor_trust_scores")
            .where(filter=FieldFilter("run_id", "==", run_id))
            .where(filter=FieldFilter("sensor_id", "==", sensor_id))
            .where(filter=FieldFilter("tick", "==", tick))
            .limit(1)
            .stream()
        )
        record = {
            "run_id": run_id,
            "sensor_id": sensor_id,
            "tick": tick,
            **data,
        }
        if existing_docs:
            doc_ref = existing_docs[0].reference
            doc_ref.update(data)
            record["id"] = existing_docs[0].id
        else:
            doc_ref = self.db.collection("sensor_trust_scores").document()
            doc_ref.set(record)
            record["id"] = doc_ref.id
        return record

    def list_sensor_trust_scores(self, run_id: str) -> List[Dict[str, Any]]:
        """List all sensor trust scores for a run."""
        from google.cloud.firestore_v1 import FieldFilter
        rows = []
        for doc in (
            self.db.collection("sensor_trust_scores")
            .where(filter=FieldFilter("run_id", "==", run_id))
            .order_by("tick", direction="DESCENDING")
            .stream()
        ):
            r = doc.to_dict()
            r["id"] = doc.id
            rows.append(r)
        return rows

    def get_sensor_trust_history(self, run_id: str, sensor_id: str) -> List[Dict[str, Any]]:
        """Get trust score history for a single sensor in a run."""
        from google.cloud.firestore_v1 import FieldFilter
        rows = []
        for doc in (
            self.db.collection("sensor_trust_scores")
            .where(filter=FieldFilter("run_id", "==", run_id))
            .where(filter=FieldFilter("sensor_id", "==", sensor_id))
            .order_by("tick")
            .stream()
        ):
            r = doc.to_dict()
            r["id"] = doc.id
            rows.append(r)
        return rows

    # ═══════════════════════════════════════════════════════════════════════════
    # FARM RISK ESTIMATES
    # ═══════════════════════════════════════════════════════════════════════════

    def upsert_farm_risk_estimate(self, run_id: str, farm_id: str, tick: int,
                                   data: Dict[str, Any]) -> Dict[str, Any]:
        """Upsert a farm risk estimate for a given run/farm/tick."""
        from google.cloud.firestore_v1 import FieldFilter
        existing_docs = list(
            self.db.collection("farm_risk_estimates")
            .where(filter=FieldFilter("run_id", "==", run_id))
            .where(filter=FieldFilter("farm_id", "==", farm_id))
            .where(filter=FieldFilter("tick", "==", tick))
            .limit(1)
            .stream()
        )
        record = {
            "run_id": run_id,
            "farm_id": farm_id,
            "tick": tick,
            **data,
        }
        if existing_docs:
            doc_ref = existing_docs[0].reference
            doc_ref.update(data)
            record["id"] = existing_docs[0].id
        else:
            doc_ref = self.db.collection("farm_risk_estimates").document()
            doc_ref.set(record)
            record["id"] = doc_ref.id
        return record

    def list_farm_risk_estimates(self, run_id: str) -> List[Dict[str, Any]]:
        """List all farm risk estimates for a run, newest tick first."""
        from google.cloud.firestore_v1 import FieldFilter
        rows = []
        for doc in (
            self.db.collection("farm_risk_estimates")
            .where(filter=FieldFilter("run_id", "==", run_id))
            .order_by("tick", direction="DESCENDING")
            .stream()
        ):
            r = doc.to_dict()
            r["id"] = doc.id
            rows.append(r)
        return rows

    def get_farm_risk_history(self, run_id: str, farm_id: str) -> List[Dict[str, Any]]:
        """Get risk estimate history for a single farm in a run."""
        from google.cloud.firestore_v1 import FieldFilter
        rows = []
        for doc in (
            self.db.collection("farm_risk_estimates")
            .where(filter=FieldFilter("run_id", "==", run_id))
            .where(filter=FieldFilter("farm_id", "==", farm_id))
            .order_by("tick")
            .stream()
        ):
            r = doc.to_dict()
            r["id"] = doc.id
            rows.append(r)
        return rows


# Global instance
firestore_service = FirestoreService()

