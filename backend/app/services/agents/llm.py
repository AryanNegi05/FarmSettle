"""Minimal OpenAI-compatible chat client (works with Groq, Gemini's OpenAI endpoint, OpenRouter, Ollama).

Returns None on any problem so callers fall back to deterministic text. The model only writes
short explanations from facts it is given; it never produces a number that is used downstream.
"""
import json
import logging
import re
from typing import Any, Optional

import httpx

from app.core.config import settings

log = logging.getLogger(__name__)


def configured() -> bool:
    k = (settings.llm_api_key or "").strip().lower()
    return bool(k) and k not in ("dummy", "changeme", "your-key-here") and not k.startswith("your")


def status() -> dict[str, Any]:
    return {"configured": configured(), "model": settings.llm_model, "base_url": settings.llm_base_url}


def chat_json(system: str, user: str) -> Optional[dict[str, Any]]:
    """Ask for a JSON object. None when unconfigured, rate-limited, offline or malformed."""
    if not configured():
        return None
    try:
        r = httpx.post(
            f"{settings.llm_base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {settings.llm_api_key}"},
            json={"model": settings.llm_model, "temperature": 0.2, "max_tokens": 400,
                  "response_format": {"type": "json_object"},
                  "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]},
            timeout=settings.llm_timeout_s)
        r.raise_for_status()
        data = json.loads(r.json()["choices"][0]["message"]["content"])
        return data if isinstance(data, dict) else None
    except Exception as e:  # noqa: BLE001
        log.warning("LLM call failed (%s); using deterministic text", type(e).__name__)
        return None


SYSTEM = (
    "You are one agent in a parametric crop-insurance claims pipeline. Use ONLY the facts in the user "
    "message. Never invent, change or recompute any number, farm or sensor. Reply with a JSON object "
    '{"summary": "<=70 words plain English", "concerns": ["short items, may be empty"]}.'
)


_NUM = re.compile(r"\d[\d,]*\.?\d*")


def _numbers(text: str) -> list[float]:
    out = []
    for m in _NUM.findall(text):
        try:
            out.append(float(m.replace(",", "").rstrip(".")))
        except ValueError:
            pass
    return out


def unsupported_numbers(text: str, facts_json: str) -> list[float]:
    """Numbers in the model's text that do not appear in the facts it was given (small counts excepted)."""
    known = _numbers(facts_json)
    bad = []
    for n in _numbers(text):
        if n <= 10 and n == int(n):
            continue
        if not any(abs(n - k) <= max(0.06, 0.005 * abs(k)) for k in known):
            bad.append(n)
    return bad


def narrate(role: str, facts: dict[str, Any]) -> Optional[dict[str, Any]]:
    facts_json = json.dumps(facts, default=str)[:6000]
    out = chat_json(f"{SYSTEM} Your role: {role}.", facts_json)
    if not out or not isinstance(out.get("summary"), str):
        return None
    text = out["summary"] + " " + " ".join(str(c) for c in (out.get("concerns") or []) if isinstance(out.get("concerns"), list))
    bad = unsupported_numbers(text, facts_json)
    if bad:
        log.warning("LLM text rejected: numbers not in the facts: %s", bad[:5])
        return None
    concerns = out.get("concerns")
    return {"summary": out["summary"].strip()[:600],
            "concerns": [str(c)[:200] for c in concerns][:5] if isinstance(concerns, list) else []}


LANGS = {"hi": "Hindi", "mr": "Marathi"}
_cache: dict[tuple[str, str], str] = {}
_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")      # Devanagari digits → 0-9, to match the rest of the page


def translate(text: str, lang: str) -> Optional[str]:
    """Translate free text into Hindi or Marathi. None means "show the original".

    Digits are normalised to 0-9, then numbers, rupee amounts, ids and dates must match the source:
    any number that is not in the source text makes the translation be thrown away. Real results and
    rejected ones are cached per (text, language); a failed call (rate limit, outage) is not, so it is retried.
    """
    if lang not in LANGS or not text or not text.strip():
        return None
    key = (lang, text)
    if key in _cache:
        return _cache[key] or None
    out = chat_json(
        f"Translate the user's text into simple, natural {LANGS[lang]} that a farmer can understand. Keep every number, "
        "rupee amount, id, date and unit exactly as written, and write digits as 0-9. Do not add or remove information. "
        'Reply with JSON {"text": "<translation>"}.', text[:1500])
    if out is None:                       # unavailable right now: show the original, try again next time
        return None
    result = out.get("text") if isinstance(out, dict) else None
    result = result.translate(_DIGITS).strip() if isinstance(result, str) else ""
    if not result or unsupported_numbers(result, text):
        _cache[key] = ""
        return None
    _cache[key] = result[:2000]
    return _cache[key]
