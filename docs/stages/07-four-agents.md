# Stage 07: four agents

Status: built (free-LLM explanations + deterministic fallback). See ../ROADMAP.md for the plan.

## What exists
- `backend/app/services/agents/graph.py`: LangGraph chain **Storm Intelligence → Sensor Investigation →
  Claims Resolution → Compliance & Audit**, shared state, per-run trace, human pause.
- `backend/app/services/agents/llm.py`: OpenAI-compatible client (default Groq free tier). A missing or
  `dummy` key switches every agent to templated, deterministic explanations.
- `backend/app/api/agents.py`: `POST /api/agents/run`, `GET /api/agents/runs[/id]`,
  `POST /api/agents/runs/{id}/queue-claims`, `GET /api/agents/status`. Runs are stored in `agent_runs`.
- Command Centre: **Run agent investigation** uses the current sliders/preset as the (simulated) weather and shows
  agent summaries, per-farm outcomes with compliance flags, the full tool-call/hand-off trace and a
  "send to review queue" button.
- Tests: `backend/tests/test_agents.py` (handoffs, human pause, no-LLM fallback, duplicates, limits, budget,
  agent failure blocks, same storm = same event id, idempotent queueing).

## Rules enforced
- Amounts come only from `claims.calculate_claim`; a hostile model reply cannot change them (tested).
- Compliance checks duplicates (idempotency key), policy limit/prior payments, run budget, evidence completeness.
- The run ends at `awaiting_human`. Queueing creates claims in AWAITING_APPROVAL / UNDER_INVESTIGATION only;
  approval and payment stay with a person on the Claims page.
- Any agent failure sets the run to `blocked`; nothing is queued.
- Same storm → same `event_id`, so re-running can never create a second claim.

## Setup
Put a free key in `backend/.env`: `LLM_API_KEY=...` (Groq: https://console.groq.com). Optional `LLM_BASE_URL`, `LLM_MODEL`
(works with Gemini's OpenAI endpoint, OpenRouter or local Ollama). `AGENT_PAYOUT_BUDGET`, `AGENT_LARGE_CLAIM` tune Compliance.

## Not done / honest limits
- Agents are tool-calling pipelines with fixed tool order; the LLM only writes explanations (no free-form tool choice).
- Evidence still comes from simulated weather and sensors.
- Satellite evidence (roadmap Agent 2) is not available yet.
