import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent, JSX } from "react";
import "./App.css";

type TaskPriority = "low" | "medium" | "high";

type Task = {
  id: number;
  title: string;
  description: string | null;
  priority: TaskPriority;
  estimated_minutes: number | null;
  completed: boolean;
  created_at: string;
};

type FocusSession = {
  id: number;
  task_id: number | null;
  seconds: number;
  note: string | null;
  created_at: string;
};

type Stats = {
  total_sessions: number;
  total_focus_minutes: number;
  average_session_minutes: number;
  longest_session_minutes: number;
  focus_days: number;
  completed_tasks: number;
  active_tasks: number;
};

type TaskFormState = {
  title: string;
  description: string;
  estimatedMinutes: string;
  priority: TaskPriority;
};

type TimerState = {
  taskId: number | null;
  label: string;
  durationSeconds: number;
  remainingSeconds: number;
  running: boolean;
};

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8000";
const DEFAULT_TASK_FORM: TaskFormState = {
  title: "",
  description: "",
  estimatedMinutes: "",
  priority: "medium",
};
const MIN_SESSION_MINUTES = 5;
const MAX_SESSION_MINUTES = 240;

const formatTimer = (totalSeconds: number): string => {
  const clamped = Math.max(0, totalSeconds);
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours > 0) {
    return `${hours}:${remainingMinutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }

  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
};

const formatMinutesLabel = (minutes: number): string => {
  if (minutes <= 0) {
    return "0 min";
  }
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (remaining === 0) {
    return `${hours} hr${hours > 1 ? "s" : ""}`;
  }
  return `${hours}h ${remaining}m`;
};

const formatSessionTimestamp = (iso: string): string => {
  const timestamp = new Date(iso);
  return timestamp.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

export default function App(): JSX.Element {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSessionMessage, setLastSessionMessage] = useState<string | null>(null);
  const [taskForm, setTaskForm] = useState<TaskFormState>(() => ({ ...DEFAULT_TASK_FORM }));
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [customMinutes, setCustomMinutes] = useState<string>("25");
  const [timerState, setTimerState] = useState<TimerState | null>(null);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, tasks],
  );

  const orderedTasks = useMemo(() => {
    return tasks.slice().sort((a, b) => {
      if (a.completed !== b.completed) {
        return Number(a.completed) - Number(b.completed);
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [tasks]);

  const recentSessions = useMemo(() => {
    return sessions
      .slice()
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 6);
  }, [sessions]);

  const request = useCallback(async (path: string, init?: RequestInit) => {
    const requestConfig: RequestInit = {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    };

    const response = await fetch(`${API_BASE_URL}${path}`, requestConfig);
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw new Error(detail?.detail ?? `Request failed with status ${response.status}`);
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();
  }, []);

  const loadEverything = useCallback(async () => {
    setLoading(true);
    try {
      const [tasksResponse, sessionsResponse, statsResponse] = await Promise.all([
        request("/tasks"),
        request("/sessions"),
        request("/stats"),
      ]);
      setTasks(tasksResponse as Task[]);
      setSessions(sessionsResponse as FocusSession[]);
      setStats(statsResponse as Stats);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to reach the FocusPad API.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    void loadEverything();
  }, [loadEverything]);

  useEffect(() => {
    if (selectedTaskId && !tasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(null);
    }
  }, [selectedTaskId, tasks]);

  const handleTaskFieldChange = (
    field: keyof TaskFormState,
  ) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setTaskForm((prev) => ({ ...prev, [field]: event.target.value }));
    };

  const handleTaskSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedTitle = taskForm.title.trim();

    if (!trimmedTitle) {
      setError("Please provide a task title.");
      return;
    }

    const estimated = Number(taskForm.estimatedMinutes);
    const payload = {
      title: trimmedTitle,
      description: taskForm.description.trim() || null,
      priority: taskForm.priority,
      estimated_minutes: Number.isFinite(estimated) && estimated > 0 ? Math.round(estimated) : null,
    };

    try {
      await request("/tasks", { method: "POST", body: JSON.stringify(payload) });
      setTaskForm(() => ({ ...DEFAULT_TASK_FORM }));
      setError(null);
      await loadEverything();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save the task.");
    }
  };

  const handleToggleTask = async (task: Task) => {
    try {
      await request(`/tasks/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ completed: !task.completed }),
      });
      await loadEverything();
      setLastSessionMessage(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update the task.");
    }
  };

  const handleDeleteTask = async (taskId: number) => {
    try {
      await request(`/tasks/${taskId}`, { method: "DELETE" });
      await loadEverything();
      setLastSessionMessage(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete the task.");
    }
  };

  const handleSelectTask = (taskId: number) => {
    setSelectedTaskId((previous) => (previous === taskId ? null : taskId));
    const chosen = tasks.find((task) => task.id === taskId);
    if (chosen?.estimated_minutes) {
      setCustomMinutes(String(chosen.estimated_minutes));
    }
    setLastSessionMessage(null);
  };

  const logSession = useCallback(
    async (seconds: number, taskId: number | null, note: string) => {
      try {
        await request("/sessions", {
          method: "POST",
          body: JSON.stringify({ seconds, task_id: taskId, note }),
        });
        await loadEverything();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to record the focus session.");
      }
    },
    [loadEverything, request],
  );

  const handleStartTimer = () => {
    const parsedMinutes = Number(customMinutes);
    if (!Number.isFinite(parsedMinutes) || parsedMinutes <= 0) {
      setError("Enter a focus duration greater than zero.");
      return;
    }

    const clampedMinutes = Math.min(Math.max(Math.round(parsedMinutes), MIN_SESSION_MINUTES), MAX_SESSION_MINUTES);
    const durationSeconds = clampedMinutes * 60;
    const label = selectedTask?.title ?? "Custom focus";

    setTimerState({
      taskId: selectedTask?.id ?? null,
      label,
      durationSeconds,
      remainingSeconds: durationSeconds,
      running: true,
    });
    setCustomMinutes(String(clampedMinutes));
    setLastSessionMessage(null);
    setError(null);
  };

  const handleToggleTimer = () => {
    setTimerState((previous) => (previous ? { ...previous, running: !previous.running } : previous));
  };

  const handleStopTimer = () => {
    if (!timerState) {
      return;
    }

    const snapshot = timerState;
    setTimerState(null);

    const elapsedSeconds = snapshot.durationSeconds - snapshot.remainingSeconds;
    if (elapsedSeconds < 60) {
      setLastSessionMessage("Sessions shorter than a minute aren't saved. Try a slightly longer block.");
      return;
    }

    void (async () => {
      await logSession(elapsedSeconds, snapshot.taskId, "Ended focus session early");
      const minutes = Math.round(elapsedSeconds / 60);
      setLastSessionMessage(
        `Logged ${minutes} minute${minutes === 1 ? "" : "s"} of focus${
          snapshot.taskId ? ` on "${snapshot.label}"` : ""
        }.`,
      );
    })();
  };

  useEffect(() => {
    if (!timerState?.running) {
      return;
    }

    if (timerState.remainingSeconds <= 0) {
      const finished = timerState;
      setTimerState(null);
      void (async () => {
        await logSession(finished.durationSeconds, finished.taskId, "Completed focus session");
        const minutes = Math.round(finished.durationSeconds / 60);
        setLastSessionMessage(
          `Completed a ${minutes}-minute session${finished.taskId ? ` on "${finished.label}"` : ""}. Nice work!`,
        );
      })();
      return;
    }

    const timeout = window.setTimeout(() => {
      setTimerState((previous) =>
        previous && previous.running
          ? { ...previous, remainingSeconds: Math.max(previous.remainingSeconds - 1, 0) }
          : previous,
      );
    }, 1_000);

    return () => window.clearTimeout(timeout);
  }, [logSession, timerState]);

  const resolveTaskTitle = useCallback(
    (taskId: number | null) => {
      if (taskId === null) {
        return "Unassigned focus";
      }
      return tasks.find((task) => task.id === taskId)?.title ?? "Completed task";
    },
    [tasks],
  );

  const timerProgress = useMemo(() => {
    if (!timerState) {
      return 0;
    }
    const elapsed = timerState.durationSeconds - timerState.remainingSeconds;
    return Math.min(100, Math.max(0, Math.round((elapsed / timerState.durationSeconds) * 100)));
  }, [timerState]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>FocusPad</h1>
          <p>Organise tasks, run focused sessions, and keep track of meaningful progress.</p>
        </div>
        <button className="button ghost" type="button" onClick={() => loadEverything()} disabled={loading}>
          Refresh data
        </button>
      </header>

      {error ? (
        <div className="banner error">{error}</div>
      ) : null}

      {lastSessionMessage ? <div className="banner success">{lastSessionMessage}</div> : null}

      <div className="panels-grid">
        <section className="panel tasks-panel">
          <div className="panel-header">
            <div>
              <h2>Tasks</h2>
              <p className="panel-subtitle">
                {stats ? `${stats.active_tasks} active • ${stats.completed_tasks} completed` : "Plan your day"}
              </p>
            </div>
          </div>

          <form className="task-form" onSubmit={handleTaskSubmit}>
            <div className="field">
              <label htmlFor="task-title">Task title</label>
              <input
                id="task-title"
                name="title"
                placeholder="Write next blog post"
                value={taskForm.title}
                onChange={handleTaskFieldChange("title")}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="task-description">Notes</label>
              <textarea
                id="task-description"
                name="description"
                placeholder="Optional context to make getting started easier"
                value={taskForm.description}
                onChange={handleTaskFieldChange("description")}
                rows={3}
              />
            </div>

            <div className="task-form-footer">
              <div className="field compact">
                <label htmlFor="task-estimate">Est. minutes</label>
                <input
                  id="task-estimate"
                  name="estimatedMinutes"
                  type="number"
                  min={5}
                  max={720}
                  placeholder="45"
                  value={taskForm.estimatedMinutes}
                  onChange={handleTaskFieldChange("estimatedMinutes")}
                />
              </div>

              <div className="field compact">
                <label htmlFor="task-priority">Priority</label>
                <select
                  id="task-priority"
                  name="priority"
                  value={taskForm.priority}
                  onChange={handleTaskFieldChange("priority")}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>

              <button className="button primary" type="submit">
                Add task
              </button>
            </div>
          </form>

          <div className="task-list">
            {loading ? (
              <p className="empty">Loading tasks…</p>
            ) : orderedTasks.length === 0 ? (
              <p className="empty">Add your first task to start planning.</p>
            ) : (
              orderedTasks.map((task) => (
                <article
                  key={task.id}
                  className={`task-card${task.completed ? " completed" : ""}${
                    selectedTaskId === task.id ? " active" : ""
                  }`}
                >
                  <button
                    type="button"
                    className="task-check"
                    onClick={() => handleToggleTask(task)}
                    aria-label={task.completed ? "Mark task as incomplete" : "Mark task as complete"}
                  />

                  <div className="task-content" onClick={() => handleSelectTask(task.id)}>
                    <div className="task-title-row">
                      <h3>{task.title}</h3>
                      <span className={`badge ${task.priority}`}>{task.priority}</span>
                    </div>
                    {task.description ? <p className="task-notes">{task.description}</p> : null}
                    <div className="task-meta">
                      {task.estimated_minutes ? (
                        <span>{formatMinutesLabel(task.estimated_minutes)}</span>
                      ) : (
                        <span>No estimate</span>
                      )}
                      <button
                        className="button ghost small"
                        type="button"
                        onClick={() => handleDeleteTask(task.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="panel timer-panel">
          <div className="panel-header">
            <div>
              <h2>Focus timer</h2>
              <p className="panel-subtitle">
                {timerState ? `In session • ${timerProgress}% complete` : "Select a task or run a custom block"}
              </p>
            </div>
          </div>

          {timerState ? (
            <div className="timer-active">
              <h3>{timerState.label}</h3>
              <div className="timer-display">{formatTimer(timerState.remainingSeconds)}</div>
              <div className="progress-track" aria-hidden>
                <div className="progress-fill" style={{ width: `${timerProgress}%` }} />
              </div>
              <div className="timer-actions">
                <button className="button primary" type="button" onClick={handleToggleTimer}>
                  {timerState.running ? "Pause" : "Resume"}
                </button>
                <button className="button secondary" type="button" onClick={handleStopTimer}>
                  Finish early
                </button>
              </div>
            </div>
          ) : (
            <div className="timer-setup">
              <div className="field">
                <label htmlFor="timer-task">Task</label>
                <select
                  id="timer-task"
                  value={selectedTaskId ?? ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (!value) {
                      setSelectedTaskId(null);
                      return;
                    }
                    const taskId = Number(value);
                    setSelectedTaskId(taskId);
                    const chosenTask = tasks.find((task) => task.id === taskId);
                    if (chosenTask?.estimated_minutes) {
                      setCustomMinutes(String(chosenTask.estimated_minutes));
                    }
                  }}
                >
                  <option value="">No task (just focus)</option>
                  {tasks.map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="timer-minutes">Duration (minutes)</label>
                <div className="timer-duration">
                  <input
                    id="timer-minutes"
                    type="number"
                    min={MIN_SESSION_MINUTES}
                    max={MAX_SESSION_MINUTES}
                    value={customMinutes}
                    onChange={(event) => setCustomMinutes(event.target.value)}
                  />
                  <div className="duration-buttons">
                    {[15, 25, 50].map((value) => (
                      <button
                        key={value}
                        type="button"
                        className="button ghost small"
                        onClick={() => setCustomMinutes(String(value))}
                      >
                        {value}m
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <button className="button primary" type="button" onClick={handleStartTimer}>
                Start focus session
              </button>
              <p className="timer-hint">
                Sessions shorter than {MIN_SESSION_MINUTES} minutes are rounded up so your tracking stays meaningful.
              </p>
            </div>
          )}
        </section>

        <section className="panel insights-panel">
          <div className="panel-header">
            <div>
              <h2>Insights</h2>
              <p className="panel-subtitle">Celebrate progress and keep your streak alive.</p>
            </div>
          </div>

          {stats ? (
            <div className="stats-grid">
              <article className="stat">
                <span className="stat-label">Focus minutes</span>
                <strong className="stat-value">{stats.total_focus_minutes}</strong>
                <span className="stat-hint">from {stats.total_sessions} sessions</span>
              </article>
              <article className="stat">
                <span className="stat-label">Average session</span>
                <strong className="stat-value">{stats.average_session_minutes.toFixed(1)}m</strong>
                <span className="stat-hint">Longest {formatMinutesLabel(Math.round(stats.longest_session_minutes))}</span>
              </article>
              <article className="stat">
                <span className="stat-label">Focus days</span>
                <strong className="stat-value">{stats.focus_days}</strong>
                <span className="stat-hint">Keep the streak growing</span>
              </article>
            </div>
          ) : (
            <p className="empty">Focus stats will appear once you've logged a session.</p>
          )}

          <div className="session-list">
            <h3>Recent sessions</h3>
            {recentSessions.length === 0 ? (
              <p className="empty">No sessions yet — start one to fill this feed.</p>
            ) : (
              <ul>
                {recentSessions.map((session) => {
                  const minutes = Math.round(session.seconds / 60);
                  return (
                    <li key={session.id}>
                      <div>
                        <span className="session-duration">{minutes}m</span>
                        <span className="session-task">{resolveTaskTitle(session.task_id)}</span>
                      </div>
                      <span className="session-time">{formatSessionTimestamp(session.created_at)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
