from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from backend.app.main import app, reset_state


@pytest.fixture(autouse=True)
def _reset_state() -> Iterator[None]:
    reset_state()
    yield
    reset_state()


client = TestClient(app)


def test_create_and_list_tasks() -> None:
    response = client.post(
        "/tasks",
        json={"title": "Write weekly report", "priority": "high", "estimated_minutes": 45},
    )
    assert response.status_code == 201

    created = response.json()
    assert created["title"] == "Write weekly report"
    assert created["priority"] == "high"
    assert created["completed"] is False
    assert created["estimated_minutes"] == 45

    list_response = client.get("/tasks")
    assert list_response.status_code == 200

    tasks = list_response.json()
    assert len(tasks) == 1
    assert tasks[0]["id"] == created["id"]


def test_update_and_delete_task() -> None:
    created = client.post("/tasks", json={"title": "Deep work block"}).json()
    task_id = created["id"]

    update = client.patch(
        f"/tasks/{task_id}", json={"completed": True, "priority": "low", "estimated_minutes": None}
    )
    assert update.status_code == 200

    updated_task = update.json()
    assert updated_task["completed"] is True
    assert updated_task["priority"] == "low"
    assert updated_task["estimated_minutes"] is None

    delete_response = client.delete(f"/tasks/{task_id}")
    assert delete_response.status_code == 204

    list_after_delete = client.get("/tasks")
    assert list_after_delete.json() == []


def test_create_session_and_stats() -> None:
    task = client.post("/tasks", json={"title": "Study algorithms"}).json()

    session_response = client.post(
        "/sessions",
        json={"task_id": task["id"], "seconds": 1_500, "note": "Pomodoro"},
    )
    assert session_response.status_code == 201

    session = session_response.json()
    assert session["seconds"] == 1_500
    assert session["task_id"] == task["id"]
    assert session["note"] == "Pomodoro"

    stats_response = client.get("/stats")
    assert stats_response.status_code == 200

    stats = stats_response.json()
    assert stats["total_sessions"] == 1
    assert stats["total_focus_minutes"] == 25
    assert stats["average_session_minutes"] == pytest.approx(25)
    assert stats["longest_session_minutes"] == pytest.approx(25)
    assert stats["focus_days"] == 1
    assert stats["completed_tasks"] == 0
    assert stats["active_tasks"] == 1


def test_session_requires_existing_task() -> None:
    response = client.post("/sessions", json={"task_id": 99, "seconds": 1_200})
    assert response.status_code == 404
