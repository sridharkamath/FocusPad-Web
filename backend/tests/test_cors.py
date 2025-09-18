import pytest
from fastapi.testclient import TestClient

from backend.app.main import app

client = TestClient(app)


def _request_with_origin(origin: str):
    return client.options(
        "/ping",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
        },
    )


LOCAL_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    "https://localhost",
    "https://127.0.0.1",
)


@pytest.mark.parametrize("origin", LOCAL_ORIGINS)
def test_local_origins_are_allowed(origin: str) -> None:
    response = _request_with_origin(origin)

    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == origin
