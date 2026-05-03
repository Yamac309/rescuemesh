import json
import os
import re

import httpx

from ..schemas import IncidentGuidanceRequest


DEFAULT_MODEL = "gemini-2.5-flash-lite"
DEFAULT_TIMEOUT_SECONDS = 6
MAX_TIMEOUT_SECONDS = 8
GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


def local_guidance(report: IncidentGuidanceRequest, reason: str | None = None) -> dict:
    should_do, avoid = _local_safety_guidance(report)
    return {
        "should_do": should_do,
        "avoid": avoid,
        "safety_note": _local_safety_note(reason),
        "source": "local-fallback",
        "model": None,
        "unavailable_reason": reason,
    }


async def generate_incident_guidance(report: IncidentGuidanceRequest) -> dict:
    api_key = os.getenv("GOOGLE_AI_API_KEY")
    model = os.getenv("GOOGLE_AI_MODEL", DEFAULT_MODEL)
    timeout_seconds = _timeout_seconds()

    if not api_key:
        return local_guidance(report, "Gemini is not configured on this backend.")

    prompt = _build_prompt(report)
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 420,
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
        return local_guidance(report, _guidance_status_error_message(error.response, model))
    except httpx.TimeoutException:
        return local_guidance(report, "Gemini request timed out. Try again in a moment or increase GOOGLE_AI_TIMEOUT_SECONDS.")
    except httpx.RequestError:
        return local_guidance(report, "The backend could not reach Gemini. Check internet access from the server.")
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        # Keep RescueMesh useful during demos even if the AI key, quota, or network is unavailable.
        return local_guidance(report, "Gemini returned a response this app could not read. Try again or check the backend logs.")


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


def _timeout_seconds() -> float:
    try:
        configured = float(os.getenv("GOOGLE_AI_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS)))
    except ValueError:
        configured = DEFAULT_TIMEOUT_SECONDS
    return min(max(configured, 3), MAX_TIMEOUT_SECONDS)


def _local_safety_guidance(report: IncidentGuidanceRequest) -> tuple[list[str], list[str]]:
    category_guidance = {
        "Need Help": (
            [
                "Move to the safest nearby place and share your location with responders.",
                "Ask nearby trusted people for help while keeping a clear exit route.",
                "Keep your phone available for calls or messages from emergency services.",
            ],
            [
                "Do not enter unstable buildings or flooded areas to reach someone.",
                "Do not separate from your group unless a responder directs you.",
                "Do not share private personal details in public updates.",
            ],
        ),
        "Food": (
            [
                "Direct people to the safest pickup point and note any access limits.",
                "Prioritize children, older adults, and people with medical needs.",
                "Keep food distribution lines away from traffic and hazards.",
            ],
            [
                "Do not distribute food that may be spoiled or contaminated.",
                "Do not block emergency vehicle routes around the pickup point.",
                "Do not promise supply levels that have not been confirmed.",
            ],
        ),
        "Water": (
            [
                "Use sealed water first and share the exact pickup location.",
                "Boil or treat uncertain water when official guidance recommends it.",
                "Reserve water for drinking, first aid, and essential hygiene.",
            ],
            [
                "Do not drink floodwater or water near damaged infrastructure.",
                "Do not crowd around a water point if there are safer waiting areas.",
                "Do not report water as safe unless it has been confirmed.",
            ],
        ),
        "Shelter": (
            [
                "Move people toward a stable shelter away from windows and flood paths.",
                "Share capacity limits, accessibility notes, and entry instructions.",
                "Keep families and groups together when possible.",
            ],
            [
                "Do not use damaged buildings as shelter.",
                "Do not block entrances, exits, or responder access points.",
                "Do not send people into areas with downed power lines or gas smells.",
            ],
        ),
        "First Aid": (
            [
                "Call emergency services for severe bleeding, breathing trouble, chest pain, or unconsciousness.",
                "Keep the injured person still, warm, and away from hazards.",
                "Use trained first aid help if available and update responders with the location.",
            ],
            [
                "Do not move someone with a possible neck or spine injury unless they are in immediate danger.",
                "Do not give food or drink to an unconscious or severely injured person.",
                "Do not attempt advanced care without training.",
            ],
        ),
        "Charging": (
            [
                "Use dry, supervised charging areas with clear walking paths.",
                "Prioritize medical devices and emergency communication devices.",
                "Limit charging time so more people can use the station.",
            ],
            [
                "Do not use wet outlets, damaged cords, or overloaded power strips.",
                "Do not leave devices unattended in crowded areas.",
                "Do not run cords across emergency paths.",
            ],
        ),
        "Blocked Road": (
            [
                "Report the exact blockage location and safest alternate route.",
                "Keep people and vehicles back from debris, wires, and unstable trees.",
                "Leave room for emergency vehicles and road crews.",
            ],
            [
                "Do not drive around barricades or through debris fields.",
                "Do not touch downed wires or objects touching them.",
                "Do not move heavy debris without proper equipment.",
            ],
        ),
        "Dangerous Area": (
            [
                "Warn people away from the area and share a safer route.",
                "Move uphill or upwind if flooding, smoke, gas, or chemicals may be involved.",
                "Mark the report as confirmed only when a trusted source verifies it.",
            ],
            [
                "Do not enter the area to take photos or check conditions.",
                "Do not cross floodwater, unstable ground, or taped-off zones.",
                "Do not spread unconfirmed hazard details as fact.",
            ],
        ),
        "General Update": (
            [
                "Keep the update short, specific, and tied to a location.",
                "Include what changed and when it was observed.",
                "Refresh the report if conditions change.",
            ],
            [
                "Do not include rumors, private details, or unclear secondhand claims.",
                "Do not mark the update confirmed without a trusted source.",
                "Do not duplicate older reports when an update would be clearer.",
            ],
        ),
    }
    should_do, avoid = category_guidance.get(report.category, category_guidance["General Update"])
    if report.urgency in {"High", "Critical"}:
        should_do = [
            "If anyone is in immediate danger, call emergency services first.",
            *should_do,
        ]
    return _unique_limited(should_do, 5), _unique_limited(avoid, 5)


def _local_safety_note(reason: str | None) -> str:
    if reason:
        return f"{reason} RescueMesh is showing local safety guidance. Follow official responder instructions when available."
    return "RescueMesh is showing local safety guidance. Follow official responder instructions when available."


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


def _guidance_status_error_message(response: httpx.Response, model: str) -> str:
    if response.status_code == 429:
        return "Gemini quota or rate limit was reached. Try again later or use a Google AI key with more quota."
    if response.status_code in {401, 403}:
        return "Gemini rejected the API key or project permissions. Check the backend Google AI key."
    if response.status_code == 404:
        return f"Gemini model '{model}' was not found for this API key. Check GOOGLE_AI_MODEL in the backend environment."
    if response.status_code == 400:
        message = _google_error_message(response)
        if message:
            return f"Gemini rejected the request: {message[:180]}"
        return "Gemini rejected the request. Check the model and request settings."
    return f"Gemini guidance is unavailable right now. Google AI returned HTTP {response.status_code}."


def _google_error_message(response: httpx.Response) -> str | None:
    try:
        body = response.json()
    except json.JSONDecodeError:
        return None

    error = body.get("error")
    if isinstance(error, dict) and isinstance(error.get("message"), str):
        return error["message"]
    return None
