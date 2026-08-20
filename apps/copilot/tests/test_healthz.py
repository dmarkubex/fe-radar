from __future__ import annotations


def test_healthz_without_hmac_is_200(client) -> None:
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json()["ok"] is True
