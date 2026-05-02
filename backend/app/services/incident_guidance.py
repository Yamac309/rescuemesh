import json
import os
import re

import httpx

from ..schemas import IncidentGuidanceRequest


DEFAULT_MODEL = "gemini-2.5-flash-lite"
GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


def local_guidance(report: IncidentGuidanceRequest, reason: str | None = None) -> dict:
    return {
        "should_do": [],
        "avoid": [],
        "safety_note": reason or "Gemini guidance is unavailable right now.",
        "source": "local-fallback",
        "model": None,
        "unavailable_reason": reason,
    }


async def generate_incident_guidance(report: IncidentGuidanceRequest) -> dict:
    api_key = os.getenv("GOOGLE_AI_API_KEY")
    model = os.getenv("GOOGLE_AI_MODEL", DEFAULT_MODEL)
    timeout_seconds = float(os.getenv("GOOGLE_AI_TIMEOUT_SECONDS", "30"))

    if not api_key:
        return local_guidance(report)

    prompt = _build_prompt(report)
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 700,
            "responseMimeType": "application/json",
            "thinkingConfig": {
                "thinkingBudget": int(os.getenv("GOOGLE_AI_THINKING_BUDGET", "0")),
            },
        },
    }

    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.post(
                GEMINI_ENDPOINT.format(model=model),
                params={"key": api_key},
                json=payload,
            )
            response.raise_for_status()
        guidance = _parse_gemini_response(response.json())
        return {
            "should_do": _unique_limited(guidance.get("should_do", []), 5),
            "avoid": _unique_limited(guidance.get("avoid", []), 5),
            "safety_note": str(
                guidance.get(
                    "safety_note",
                    "Use this as general emergency guidance only. Follow official responder instructions and call emergency services when possible.",
                )
            )[:280],
            "source": "google-ai",
            "model": model,
            "unavailable_reason": None,
        }
    except httpx.HTTPStatusError as error:
        return local_guidance(report, _guidance_error_message(error.response))
    except (httpx.HTTPError, KeyError, TypeError, ValueError, json.JSONDecodeError):
        # Keep RescueMesh useful during demos even if the AI key, quota, or network is unavailable.
        return local_guidance(report)


def _build_prompt(report: IncidentGuidanceRequest) -> str:
    return f"""
You are helping an emergency communication app named RescueMesh.
Generate short, practical, safety-first guidance for this incident report.

Incident:
- Title: {report.title}
- Category: {report.category}
- Description: {report.description or "No description provided"}
- Urgency: {report.urgency}
- Status: {report.status}
- Age label: {report.aging_label or "Unknown"}
- Verification label: {report.verification_label or "Unknown"}
- Confidence score: {report.confidence_score if report.confidence_score is not None else "Unknown"}

Rules:
- Be specific to the incident title and category.
- Do not claim official certainty.
- Do not ask users to enter dangerous areas.
- Do not include private personal details.
- Include emergency-services language when the situation may be life-threatening.
- Return JSON only with exactly these keys:
  "should_do": array of 3 to 5 short strings,
  "avoid": array of 3 to 5 short strings,
  "safety_note": one short string.
""".strip()


def _parse_gemini_response(body: dict) -> dict:
    text = body["candidates"][0]["content"]["parts"][0]["text"].strip()
    if text.startswith("```"):
        text = text.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    if not text.startswith("{"):
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            text = match.group(0)
    parsed = json.loads(text)
    if not isinstance(parsed, dict):
        raise ValueError("Gemini guidance response must be a JSON object")
    return parsed


def _unique_limited(items: list[str], limit: int) -> list[str]:
    result: list[str] = []
    for item in items:
        clean = str(item).strip()
        if clean and clean not in result:
            result.append(clean[:180])
        if len(result) >= limit:
            break
    return result


def _guidance_error_message(response: httpx.Response) -> str:
    if response.status_code == 429:
        return "Gemini quota or rate limit was reached. Try again later or use a Google AI key with more quota."
    if response.status_code in {401, 403}:
        return "Gemini rejected the API key or project permissions. Check the backend Google AI key."
    return "Gemini guidance is unavailable right now."
