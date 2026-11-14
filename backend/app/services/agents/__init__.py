"""Stage 7: four cooperating agents (Storm Intelligence, Sensor Investigation, Claims Resolution,
Compliance & Audit) orchestrated with LangGraph.

Agents investigate, explain and recommend. They never set an amount (the claim engine does) and
never move money (a human approves in the claims queue).
"""
from app.services.agents.graph import run_investigation, queue_claims  # noqa: F401
