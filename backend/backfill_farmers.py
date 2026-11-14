"""One-off: create the `farmers` collection from existing farmer_profiles/farms.

Run from backend/:  .venv/bin/python backfill_farmers.py
"""
from app.services.firestore_service import firestore_service

print("Backfilled farmers:", firestore_service.backfill_farmers())
