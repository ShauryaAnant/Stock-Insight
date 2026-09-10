from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime, timedelta
from threading import Lock
from typing import Any

PROGRESS_TTL = timedelta(minutes=10)

STEP_DEFINITIONS: list[tuple[str, str]] = [
    ("fundamental", "Running fundamental analysis"),
    ("technical", "Running technical analysis"),
    ("sentiment", "Running sentiment analysis"),
    ("report_generation", "Generating final report"),
]

_lock = Lock()
_progress_store: dict[str, dict[str, Any]] = {}


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _cleanup_expired() -> None:
    cutoff = _utc_now() - PROGRESS_TTL
    expired_keys = [
        request_id
        for request_id, payload in _progress_store.items()
        if payload.get("_updated_at_dt", cutoff) < cutoff
    ]
    for request_id in expired_keys:
        _progress_store.pop(request_id, None)


def _build_steps(include_report: bool) -> list[dict[str, str]]:
    steps: list[dict[str, str]] = []
    for key, label in STEP_DEFINITIONS:
        if key == "report_generation" and not include_report:
            continue
        steps.append(
            {
                "key": key,
                "label": label,
                "status": "pending",
            }
        )
    return steps


def initialize_progress(request_id: str, ticker: str, include_report: bool) -> None:
    now = _utc_now()
    with _lock:
        _cleanup_expired()
        _progress_store[request_id] = {
            "requestId": request_id,
            "ticker": ticker,
            "status": "queued",
            "message": "Queued for analysis",
            "steps": _build_steps(include_report),
            "currentStep": None,
            "currentStepIndex": 0,
            "totalSteps": 4 if include_report else 3,
            "startedAt": now.isoformat(),
            "updatedAt": now.isoformat(),
            "error": None,
            "_updated_at_dt": now,
        }


def update_progress(request_id: str, step_key: str, message: str) -> None:
    now = _utc_now()
    with _lock:
        payload = _progress_store.get(request_id)
        if payload is None:
            return

        steps = payload["steps"]
        current_index = next(
            (index for index, step in enumerate(steps) if step["key"] == step_key),
            None,
        )
        if current_index is None:
            return

        for index, step in enumerate(steps):
            if index < current_index:
                step["status"] = "completed"
            elif index == current_index:
                step["status"] = "running"
            else:
                step["status"] = "pending"

        payload["status"] = "running"
        payload["message"] = message
        payload["currentStep"] = step_key
        payload["currentStepIndex"] = current_index + 1
        payload["updatedAt"] = now.isoformat()
        payload["_updated_at_dt"] = now


def mark_completed(request_id: str) -> None:
    now = _utc_now()
    with _lock:
        payload = _progress_store.get(request_id)
        if payload is None:
            return

        for step in payload["steps"]:
            step["status"] = "completed"

        payload["status"] = "completed"
        payload["message"] = "Analysis complete"
        payload["currentStep"] = payload["steps"][-1]["key"] if payload["steps"] else None
        payload["currentStepIndex"] = len(payload["steps"])
        payload["updatedAt"] = now.isoformat()
        payload["_updated_at_dt"] = now


def mark_failed(request_id: str, error: str) -> None:
    now = _utc_now()
    with _lock:
        payload = _progress_store.get(request_id)
        if payload is None:
            return

        payload["status"] = "failed"
        payload["message"] = "Analysis failed"
        payload["error"] = error
        payload["updatedAt"] = now.isoformat()
        payload["_updated_at_dt"] = now


def get_progress(request_id: str) -> dict[str, Any] | None:
    with _lock:
        _cleanup_expired()
        payload = _progress_store.get(request_id)
        if payload is None:
            return None

        result = deepcopy(payload)
        result.pop("_updated_at_dt", None)
        return result
