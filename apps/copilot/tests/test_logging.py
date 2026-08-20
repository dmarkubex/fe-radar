from __future__ import annotations

import json
import logging

import main  # noqa: F401  # configure_logging before other modules


def test_healthz_stdout_lines_are_json(client, capsys) -> None:
    client.get("/healthz")
    out = capsys.readouterr().out
    assert "Uvicorn running" not in out
    parsed = 0
    for line in out.splitlines():
        if not line.strip():
            continue
        payload = json.loads(line)
        assert isinstance(payload["level"], str)
        assert payload["level"] == payload["level"].lower()
        assert isinstance(payload["time"], int)
        assert isinstance(payload["msg"], str)
        parsed += 1
    assert parsed >= 1


def test_redact_authorization(capsys) -> None:
    logging.getLogger("test_redact").info(
        "probe",
        extra={"authorization": "Bearer super-secret"},
    )
    out = capsys.readouterr().out
    found = False
    for line in out.splitlines():
        if not line.strip():
            continue
        payload = json.loads(line)
        assert "super-secret" not in line
        if payload.get("authorization") == "***":
            found = True
    assert found
