#!/usr/bin/env python3
"""
Migrate data from SQLite to Firebase Firestore.
This script reads all business data from the SQLite database and migrates it to Firestore.

Usage: python scripts/migrate-sqlite-to-firebase.py
"""

import sys
import os
from pathlib import Path

# Add backend to path
backend_path = Path(__file__).parent.parent / "backend"
sys.path.insert(0, str(backend_path))

import firebase_admin
from firebase_admin import credentials, firestore
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from datetime import datetime

# Import SQLAlchemy models
from app.models.stage2 import FarmerProfile, Farm, Crop, InsurancePolicy, PolicyRule, BankAccountReference
from app.core.config import settings

print("🔄 Starting SQLite to Firebase migration...\n")

# Initialize Firebase
try:
    cred = credentials.Certificate(str(backend_path / settings.firebase_credentials_path))
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    print("✅ Firebase Admin SDK initialized")
except Exception as e:
    print(f"❌ Failed to initialize Firebase: {e}")
    sys.exit(1)

# Initialize SQLite
try:
    sqlite_path = backend_path / "paratrust.db"
    if not sqlite_path.exists():
        print(f"❌ SQLite database not found at {sqlite_path}")
        print("   No data to migrate.")
        sys.exit(0)
    
    engine = create_engine(f"sqlite:///{sqlite_path}")
    SessionLocal = sessionmaker(bind=engine)
    session = SessionLocal()
    print(f"✅ Connected to SQLite database at {sqlite_path}\n")
except Exception as e:
    print(f"❌ Failed to connect to SQLite: {e}")
    sys.exit(1)


# Mapping from SQLite IDs to Firestore document IDs
id_mapping = {
    "farmer_profiles": {},
    "farms": {},
    "policies": {},
}


def migrate_farmer_profiles():
    """Migrate farmer profiles."""
    print("📋 Migrating farmer profiles...")
    profiles = session.query(FarmerProfile).all()
    
    if not profiles:
        print("   No farmer profiles to migrate.")
        return
    
    count = 0
    for profile in profiles:
        try:
            # Create Firestore document
            profile_data = {
                "firebase_uid": profile.firebase_uid,
                "phone": profile.phone,
                "address": profile.address,
                "district": profile.district,
                "state": profile.state,
                "created_at": profile.created_at or datetime.utcnow(),
            }
            
            doc_ref = db.collection("farmer_profiles").document()
            doc_ref.set(profile_data)
            
            # Store mapping
            id_mapping["farmer_profiles"][profile.id] = doc_ref.id
            
            count += 1
            print(f"   ✓ Migrated profile {profile.id} → {doc_ref.id} (UID: {profile.firebase_uid})")
        except Exception as e:
            print(f"   ✗ Failed to migrate profile {profile.id}: {e}")
    
    print(f"✅ Migrated {count}/{len(profiles)} farmer profiles\n")


def migrate_farms():
    """Migrate farms."""
    print("🌾 Migrating farms...")
    farms = session.query(Farm).all()
    
    if not farms:
        print("   No farms to migrate.")
        return
    
    count = 0
    for farm in farms:
        try:
            # Map farmer_profile_id to Firestore ID
            farmer_profile_id = id_mapping["farmer_profiles"].get(farm.farmer_profile_id)
            if not farmer_profile_id:
                print(f"   ✗ Skipping farm {farm.id}: farmer profile {farm.farmer_profile_id} not found")
                continue
            
            # Create Firestore document
            farm_data = {
                "farmer_profile_id": farmer_profile_id,
                "name": farm.name,
                "area_hectares": farm.area_hectares,
                "latitude": farm.latitude,
                "longitude": farm.longitude,
                "boundary_geojson": farm.boundary_geojson,
                "created_at": farm.created_at or datetime.utcnow(),
            }
            
            doc_ref = db.collection("farms").document()
            doc_ref.set(farm_data)
            
            # Store mapping
            id_mapping["farms"][farm.id] = doc_ref.id
            
            count += 1
            print(f"   ✓ Migrated farm {farm.id} → {doc_ref.id} ({farm.name})")
        except Exception as e:
            print(f"   ✗ Failed to migrate farm {farm.id}: {e}")
    
    print(f"✅ Migrated {count}/{len(farms)} farms\n")


def migrate_crops():
    """Migrate crops."""
    print("🌱 Migrating crops...")
    crops = session.query(Crop).all()
    
    if not crops:
        print("   No crops to migrate.")
        return
    
    count = 0
    for crop in crops:
        try:
            # Map farm_id to Firestore ID
            farm_id = id_mapping["farms"].get(crop.farm_id)
            if not farm_id:
                print(f"   ✗ Skipping crop {crop.id}: farm {crop.farm_id} not found")
                continue
            
            # Create Firestore document
            crop_data = {
                "farm_id": farm_id,
                "crop_type": crop.crop_type,
                "season": crop.season,
                "area_hectares": crop.area_hectares,
            }
            
            doc_ref = db.collection("crops").document()
            doc_ref.set(crop_data)
            
            count += 1
            print(f"   ✓ Migrated crop {crop.id} → {doc_ref.id} ({crop.crop_type})")
        except Exception as e:
            print(f"   ✗ Failed to migrate crop {crop.id}: {e}")
    
    print(f"✅ Migrated {count}/{len(crops)} crops\n")


def migrate_policies():
    """Migrate insurance policies."""
    print("📄 Migrating insurance policies...")
    policies = session.query(InsurancePolicy).all()
    
    if not policies:
        print("   No policies to migrate.")
        return
    
    count = 0
    for policy in policies:
        try:
            # Map IDs to Firestore IDs
            farm_id = id_mapping["farms"].get(policy.farm_id)
            farmer_profile_id = id_mapping["farmer_profiles"].get(policy.farmer_profile_id)
            
            if not farm_id or not farmer_profile_id:
                print(f"   ✗ Skipping policy {policy.id}: missing farm or farmer profile")
                continue
            
            # Create Firestore document
            policy_data = {
                "policy_number": policy.policy_number,
                "farm_id": farm_id,
                "farmer_profile_id": farmer_profile_id,
                "insurer_firebase_uid": policy.insurer_firebase_uid,
                "coverage_start": policy.coverage_start,
                "coverage_end": policy.coverage_end,
                "sum_insured": float(policy.sum_insured),
                "rainfall_trigger_mm": float(policy.rainfall_trigger_mm) if policy.rainfall_trigger_mm else None,
                "rainfall_max_payout_mm": float(policy.rainfall_max_payout_mm) if policy.rainfall_max_payout_mm else None,
                "flood_trigger_level": float(policy.flood_trigger_level) if policy.flood_trigger_level else None,
                "payout_limit": float(policy.payout_limit) if policy.payout_limit else None,
                "status": policy.status,
                "created_at": policy.created_at or datetime.utcnow(),
            }
            
            doc_ref = db.collection("policies").document()
            doc_ref.set(policy_data)
            
            # Store mapping
            id_mapping["policies"][policy.id] = doc_ref.id
            
            count += 1
            print(f"   ✓ Migrated policy {policy.id} → {doc_ref.id} ({policy.policy_number})")
        except Exception as e:
            print(f"   ✗ Failed to migrate policy {policy.id}: {e}")
    
    print(f"✅ Migrated {count}/{len(policies)} policies\n")


def migrate_policy_rules():
    """Migrate policy rules."""
    print("📜 Migrating policy rules...")
    rules = session.query(PolicyRule).all()
    
    if not rules:
        print("   No policy rules to migrate.")
        return
    
    count = 0
    for rule in rules:
        try:
            # Map policy_id to Firestore ID
            policy_id = id_mapping["policies"].get(rule.policy_id)
            if not policy_id:
                print(f"   ✗ Skipping rule {rule.id}: policy {rule.policy_id} not found")
                continue
            
            # Create Firestore document
            rule_data = {
                "policy_id": policy_id,
                "rule_name": rule.rule_name,
                "rule_value": rule.rule_value,
                "description": rule.description,
            }
            
            doc_ref = db.collection("policy_rules").document()
            doc_ref.set(rule_data)
            
            count += 1
            print(f"   ✓ Migrated rule {rule.id} → {doc_ref.id} ({rule.rule_name})")
        except Exception as e:
            print(f"   ✗ Failed to migrate rule {rule.id}: {e}")
    
    print(f"✅ Migrated {count}/{len(rules)} policy rules\n")


def migrate_bank_accounts():
    """Migrate bank account references."""
    print("🏦 Migrating bank accounts...")
    accounts = session.query(BankAccountReference).all()
    
    if not accounts:
        print("   No bank accounts to migrate.")
        return
    
    count = 0
    for account in accounts:
        try:
            # Map farmer_profile_id to Firestore ID
            farmer_profile_id = id_mapping["farmer_profiles"].get(account.farmer_profile_id)
            if not farmer_profile_id:
                print(f"   ✗ Skipping account {account.id}: farmer profile {account.farmer_profile_id} not found")
                continue
            
            # Create Firestore document
            account_data = {
                "farmer_profile_id": farmer_profile_id,
                "account_holder_name": account.account_holder_name,
                "masked_account_number": account.masked_account_number,
                "bank_name": account.bank_name,
                "ifsc_code": account.ifsc_code,
                "verification_status": account.verification_status,
                "verified_at": account.verified_at,
                "created_at": account.created_at or datetime.utcnow(),
            }
            
            doc_ref = db.collection("bank_accounts").document()
            doc_ref.set(account_data)
            
            count += 1
            print(f"   ✓ Migrated bank account {account.id} → {doc_ref.id}")
        except Exception as e:
            print(f"   ✗ Failed to migrate bank account {account.id}: {e}")
    
    print(f"✅ Migrated {count}/{len(accounts)} bank accounts\n")


def main():
    """Run migration."""
    try:
        # Migrate in order to maintain relationships
        migrate_farmer_profiles()
        migrate_farms()
        migrate_crops()
        migrate_policies()
        migrate_policy_rules()
        migrate_bank_accounts()
        
        print("═" * 60)
        print("✨ Migration completed successfully!")
        print("═" * 60)
        print("\n📊 Summary:")
        print(f"  Farmer Profiles: {len(id_mapping['farmer_profiles'])}")
        print(f"  Farms:           {len(id_mapping['farms'])}")
        print(f"  Policies:        {len(id_mapping['policies'])}")
        print("\n💡 You can now delete the SQLite database (paratrust.db) if desired.")
        
    except Exception as e:
        print(f"\n❌ Migration failed: {e}")
        sys.exit(1)
    finally:
        session.close()


if __name__ == "__main__":
    main()
