from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime
from itertools import count
from typing import Literal

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


app = FastAPI(title="FocusPad API")

# Allow local development from both localhost and 127.0.0.1 on any port.
# Browsers treat these hosts differently for CORS, so we use a regular
# expression that accepts either host with an optional port. This lets the
# React dev server (`npm run dev` on 5173) as well as Vite preview (4173) work
# without triggering CORS errors.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["*"],
    allow_headers=["*"],
)


class TaskBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1_000)
    priority: Literal["low", "medium", "high"] = "medium"
    estimated_minutes: int | None = Field(
        default=None,
        ge=1,
        le=720,
        description="Estimated focus time for the task in minutes.",
    )


class Task(TaskBase):
    id: int
    completed: bool = False
    created_at: datetime


class TaskCreate(TaskBase):
    pass


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1_000)
    priority: Literal["low", "medium", "high"] | None = None
    estimated_minutes: int | None = Field(default=None, ge=1, le=720)
    completed: bool | None = None


class FocusSession(BaseModel):
    id: int
    task_id: int | None = None
    seconds: int = Field(ge=60, le=12 * 60 * 60)
    note: str | None = Field(default=None, max_length=240)
    created_at: datetime


class FocusSessionCreate(BaseModel):
    task_id: int | None = None
    seconds: int = Field(ge=60, le=12 * 60 * 60)
    note: str | None = Field(default=None, max_length=240)


class StatsResponse(BaseModel):
    total_sessions: int
    total_focus_minutes: int
    average_session_minutes: float
    longest_session_minutes: float
    focus_days: int
    completed_tasks: int
    active_tasks: int


_task_store: dict[int, Task] = {}
_session_store: dict[int, FocusSession] = {}
_task_id_counter = count(start=1)
_session_id_counter = count(start=1)


def _now() -> datetime:
    return datetime.now(UTC)


def reset_state() -> None:
    """Reset the in-memory data stores.

    The tests call this helper to make sure each test runs with a predictable
    set of data. While the production app never invokes it, keeping it part of
    the public module API makes it straightforward for other modules (such as
    tests) to import and call it.
    """

    _task_store.clear()
    _session_store.clear()

    global _task_id_counter, _session_id_counter

    _task_id_counter = count(start=1)
    _session_id_counter = count(start=1)


@app.get("/ping")
async def ping() -> dict[str, str]:
    return {"msg": "pong"}


@app.get("/tasks", response_model=list[Task])
async def list_tasks() -> list[Task]:
    tasks = sorted(
        _task_store.values(),
        key=lambda task: (task.completed, -task.created_at.timestamp()),
    )
    return [task.model_copy() for task in tasks]


@app.post("/tasks", response_model=Task, status_code=201)
async def create_task(payload: TaskCreate) -> Task:
    task_id = next(_task_id_counter)
    task = Task(
        id=task_id,
        completed=False,
        created_at=_now(),
        **payload.model_dump(),
    )
    _task_store[task_id] = task
    return task.model_copy()


@app.patch("/tasks/{task_id}", response_model=Task)
async def update_task(task_id: int, payload: TaskUpdate) -> Task:
    try:
        stored_task = _task_store[task_id]
    except KeyError as exc:  # pragma: no cover - defensive, but tested indirectly
        raise HTTPException(status_code=404, detail="Task not found") from exc

    updated = stored_task.model_copy(update=payload.model_dump(exclude_unset=True))
    _task_store[task_id] = updated
    return updated.model_copy()


@app.delete("/tasks/{task_id}", status_code=204, response_class=Response)
async def delete_task(task_id: int) -> Response:
    if task_id not in _task_store:
        raise HTTPException(status_code=404, detail="Task not found")

    _task_store.pop(task_id)
    return Response(status_code=204)


@app.get("/sessions", response_model=list[FocusSession])
async def list_sessions() -> list[FocusSession]:
    sessions = sorted(
        _session_store.values(),
        key=lambda session: session.created_at,
        reverse=True,
    )
    return [session.model_copy() for session in sessions]


@app.post("/sessions", response_model=FocusSession, status_code=201)
async def create_session(payload: FocusSessionCreate) -> FocusSession:
    if payload.task_id is not None and payload.task_id not in _task_store:
        raise HTTPException(status_code=404, detail="Task not found")

    session_id = next(_session_id_counter)
    session = FocusSession(
        id=session_id,
        created_at=_now(),
        **payload.model_dump(),
    )
    _session_store[session_id] = session
    return session.model_copy()


def _calculate_focus_days(sessions: Iterable[FocusSession]) -> int:
    return len({session.created_at.date() for session in sessions})


def _calculate_longest_session_minutes(sessions: Iterable[FocusSession]) -> float:
    try:
        longest_seconds = max(session.seconds for session in sessions)
    except ValueError:
        return 0.0
    return round(longest_seconds / 60, 1)


@app.get("/stats", response_model=StatsResponse)
async def get_stats() -> StatsResponse:
    sessions = list(_session_store.values())
    total_sessions = len(sessions)
    total_focus_seconds = sum(session.seconds for session in sessions)
    total_minutes = total_focus_seconds // 60
    average_minutes = round(
        (total_focus_seconds / 60) / total_sessions, 1
    ) if total_sessions else 0.0

    return StatsResponse(
        total_sessions=total_sessions,
        total_focus_minutes=total_minutes,
        average_session_minutes=average_minutes,
        longest_session_minutes=_calculate_longest_session_minutes(sessions),
        focus_days=_calculate_focus_days(sessions),
        completed_tasks=sum(task.completed for task in _task_store.values()),
        active_tasks=sum(not task.completed for task in _task_store.values()),
    )
