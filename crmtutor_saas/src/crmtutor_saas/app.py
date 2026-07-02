from __future__ import annotations

import hashlib
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr, Field

from crmtutor_saas.config import Settings, load_settings, resolve_path
from crmtutor_saas.models import Role
from crmtutor_saas.security import (
    create_access_token,
    hash_password,
    make_otp,
    verify_access_token,
    verify_password,
)
from crmtutor_saas.storage import SaaSStorage, dt

STATIC_DIR = Path(__file__).resolve().parent / "web" / "static"


class AppState:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.db = SaaSStorage(resolve_path(settings.database_path))


class TutorRegistration(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    first_name: str = Field(min_length=1)
    last_name: str = ""
    username: str = Field(min_length=3, pattern=r"^[a-zA-Z0-9_][a-zA-Z0-9_-]{2,30}$")
    photo_url: str = ""
    description: str = ""
    timezone: str = "Europe/Moscow"
    subjects: list[str] = Field(default_factory=list)
    directions: list[str] = Field(default_factory=list)
    hourly_price: int = Field(default=0, ge=0)
    experience_years: int = Field(default=0, ge=0)
    plan_code: str = "standart"
    workspace_type: str = "tutor"


class EmailOtpRequest(BaseModel):
    email: EmailStr


class EmailOtpVerify(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6)


class EmailLogin(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    first_name: str = ""
    last_name: str = ""


class TelegramLogin(BaseModel):
    telegram_id: int
    username: str = ""
    first_name: str = ""
    last_name: str = ""
    photo_url: str = ""


class TelegramLinkConfirm(BaseModel):
    token: str
    telegram_id: int
    username: str = ""
    first_name: str = ""
    last_name: str = ""


class NotificationSent(BaseModel):
    error: str = ""


class StudentWrite(BaseModel):
    full_name: str = Field(min_length=1)
    grade: str = ""
    timezone: str = "Europe/Moscow"
    subject: str = ""
    prep_type: str = ""
    goal: str = ""
    current_level: str = ""
    lesson_price: int = Field(default=0, ge=0)
    price_60: int = Field(default=0, ge=0)
    price_90: int = Field(default=0, ge=0)
    price_120: int = Field(default=0, ge=0)
    lesson_duration_minutes: int = Field(default=60, ge=30, le=240)
    balance_lessons: int = Field(default=0, ge=0)
    balance_money: int = Field(default=0, ge=0)
    progress_current: int = Field(default=0, ge=0)
    progress_goal: int = Field(default=0, ge=0)
    prep_plan_text: str = ""
    start_date: str | None = None
    exam_date: str | None = None
    student_telegram: str = ""
    parent_name: str = ""
    parent_telegram: str = ""
    parent_can_edit: bool = False
    board_url: str = ""
    meeting_url: str = ""
    comment: str = ""


class LessonWrite(BaseModel):
    student_id: int
    starts_at: str
    duration_minutes: int = Field(default=60, ge=30, le=240)
    topic: str = ""
    payment_amount: int = Field(default=0, ge=0)
    notes: str = ""


class PaymentWrite(BaseModel):
    student_id: int
    amount: int = Field(default=0, ge=0)
    lessons_count: int = Field(default=0, ge=0)
    comment: str = ""
    status: str = "confirmed"


class StudentUpdate(BaseModel):
    full_name: str | None = None
    grade: str | None = None
    timezone: str | None = None
    subject: str | None = None
    prep_type: str | None = None
    goal: str | None = None
    current_level: str | None = None
    lesson_price: int | None = Field(default=None, ge=0)
    price_60: int | None = Field(default=None, ge=0)
    price_90: int | None = Field(default=None, ge=0)
    price_120: int | None = Field(default=None, ge=0)
    lesson_duration_minutes: int | None = Field(default=None, ge=30, le=240)
    balance_lessons: int | None = Field(default=None, ge=0)
    balance_money: int | None = Field(default=None, ge=0)
    progress_current: int | None = Field(default=None, ge=0)
    progress_goal: int | None = Field(default=None, ge=0)
    prep_plan_text: str | None = None
    start_date: str | None = None
    exam_date: str | None = None
    student_telegram: str | None = None
    parent_name: str | None = None
    parent_telegram: str | None = None
    parent_can_edit: bool | None = None
    board_url: str | None = None
    meeting_url: str | None = None
    comment: str | None = None


class HomeworkWrite(BaseModel):
    student_id: int
    title: str = ""
    text: str = Field(min_length=1)
    deadline: str | None = None
    status: str = "ожидание выполнения"
    attachments: list[str] = Field(default_factory=list)
    links: list[str] = Field(default_factory=list)
    teacher_comment: str = ""


class HomeworkUpdate(BaseModel):
    title: str | None = None
    text: str | None = None
    deadline: str | None = None
    status: str | None = None
    attachments: list[str] | None = None
    links: list[str] | None = None
    teacher_comment: str | None = None


class ProgressWrite(BaseModel):
    task_number: int | None = Field(default=None, ge=1, le=100)
    title: str | None = None
    knowledge_level: int = Field(default=0, ge=0, le=10)
    solved_count: int = Field(default=0, ge=0)
    comment: str = ""


class PlanItemWrite(BaseModel):
    title: str = Field(min_length=1)
    deadline: str | None = None
    comment: str = ""
    status: str = "не начато"


class InviteWrite(BaseModel):
    role: Role


class ApplicationWrite(BaseModel):
    student_name: str = Field(min_length=1)
    contact: str = Field(min_length=1)
    selected_slot: str = ""
    comment: str = ""


class PlanChange(BaseModel):
    plan_code: str


class JoinTutorRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    role: str
    tutor_username: str = Field(min_length=3)
    full_name: str = Field(min_length=1)
    grade: str = ""
    timezone: str = "Europe/Moscow"
    prep_type: str = ""
    subject: str = ""
    goal: str = ""
    parent_name: str = ""
    parent_telegram: str = ""
    child_name: str = ""
    child_telegram: str = ""
    parent_can_edit: bool = False


class TutorProfileUpdate(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    photo_url: str | None = None
    description: str | None = None
    timezone: str | None = None
    experience_years: int | None = Field(default=None, ge=0)
    subjects: list[str] | None = None
    directions: list[str] | None = None
    hourly_price: int | None = Field(default=None, ge=0)
    public_slug: str | None = Field(default=None, min_length=3, pattern=r"^[a-zA-Z0-9_][a-zA-Z0-9_-]{2,30}$")


def code_hash(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


def state_dep(request: Request) -> AppState:
    return request.app.state.crmtutor


def auth_dep(
    state: AppState = Depends(state_dep),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Access token is required")
    payload = verify_access_token(authorization.removeprefix("Bearer ").strip(), state.settings.jwt_secret)
    if payload is None:
        raise HTTPException(status_code=401, detail="Access token is invalid")
    user = state.db.row("SELECT * FROM users WHERE id = ?", (payload.get("sub"),))
    if user is None:
        raise HTTPException(status_code=401, detail="User does not exist")
    return {"user": user, "claims": payload}


def workspace_context(
    workspace_id: int,
    auth: dict[str, Any] = Depends(auth_dep),
    state: AppState = Depends(state_dep),
) -> dict[str, Any]:
    membership = state.db.get_membership(int(auth["user"]["id"]), workspace_id)
    if membership is None:
        raise HTTPException(status_code=403, detail="Workspace is isolated from this user")
    return {"workspace_id": workspace_id, "membership": membership, "user": auth["user"]}


def first_workspace_context(auth: dict[str, Any], state: AppState) -> dict[str, Any]:
    workspaces = state.db.list_user_workspaces(int(auth["user"]["id"]))
    if not workspaces:
        raise HTTPException(status_code=403, detail="Workspace is required")
    workspace_id = int(workspaces[0]["id"])
    membership = state.db.get_membership(int(auth["user"]["id"]), workspace_id)
    if membership is None:
        raise HTTPException(status_code=403, detail="Workspace is isolated from this user")
    return {"workspace_id": workspace_id, "membership": membership, "user": auth["user"]}


def maybe_first_workspace_context(auth: dict[str, Any], state: AppState) -> dict[str, Any] | None:
    workspaces = state.db.list_user_workspaces(int(auth["user"]["id"]))
    if not workspaces:
        return None
    workspace_id = int(workspaces[0]["id"])
    membership = state.db.get_membership(int(auth["user"]["id"]), workspace_id)
    if membership is None:
        return None
    return {"workspace_id": workspace_id, "membership": membership, "user": auth["user"]}


def issue_tokens(state: AppState, user: dict[str, Any]) -> dict[str, Any]:
    workspaces = state.db.list_user_workspaces(int(user["id"]))
    access = create_access_token(
        {"sub": user["id"], "email": user.get("email"), "workspaces": [w["id"] for w in workspaces]},
        state.settings.jwt_secret,
        state.settings.access_token_ttl_minutes,
    )
    refresh = state.db.create_refresh_token(int(user["id"]), state.settings.refresh_token_ttl_days)
    return {"access_token": access, "refresh_token": refresh, "user": user, "workspaces": workspaces}


def parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def iso_dt(value: str | None) -> str | None:
    parsed = parse_dt(value)
    return parsed.isoformat() if parsed else value


def default_progress_goal(prep_type: str, subject: str) -> int:
    value = f"{prep_type} {subject}".lower()
    if "огэ" in value and "информ" in value:
        return 16
    if "огэ" in value and "мат" in value:
        return 19
    if "егэ" in value and "информ" in value:
        return 27
    if "егэ" in value and "мат" in value:
        return 19
    return 0


def topic_number(title: str) -> int | None:
    digits = "".join(ch for ch in str(title) if ch.isdigit())
    return int(digits) if digits else None


def lesson_end(row: dict[str, Any]) -> str | None:
    start = parse_dt(row.get("starts_at"))
    if start is None:
        return row.get("starts_at")
    return (start + timedelta(minutes=int(row.get("duration_minutes") or 60))).isoformat()


def student_view(row: dict[str, Any]) -> dict[str, Any]:
    data = dict(row)
    data["name"] = row["full_name"]
    data["timezoneLabel"] = row.get("timezone") or "Europe/Moscow"
    data["defaultProgressGoal"] = default_progress_goal(row.get("prep_type", ""), row.get("subject", ""))
    data["hourlyRate"] = row.get("price_60") or row.get("lesson_price") or 0
    data["preparationType"] = row.get("prep_type", "")
    data["contacts"] = row.get("student_telegram", "")
    data["parentContacts"] = " ".join(
        part for part in [row.get("parent_name", ""), row.get("parent_telegram", "")] if part
    )
    data["parentCanEdit"] = bool(row.get("parent_can_edit"))
    data["links"] = {"board": row.get("board_url", ""), "meeting": row.get("meeting_url", "")}
    data["notes"] = row.get("comment", "")
    return data


def lesson_view(row: dict[str, Any], student: dict[str, Any] | None = None) -> dict[str, Any]:
    price = row.get("payment_amount") or (student or {}).get("lesson_price") or 0
    return {
        "id": row["id"],
        "student_id": row["student_id"],
        "student_name": (student or {}).get("full_name", ""),
        "starts_at": iso_dt(row.get("starts_at")),
        "ends_at": lesson_end(row),
        "teacher_starts_at": iso_dt(row.get("starts_at")),
        "teacher_ends_at": lesson_end(row),
        "student_starts_at": iso_dt(row.get("starts_at")),
        "student_ends_at": lesson_end(row),
        "duration_minutes": row.get("duration_minutes", 60),
        "status": row.get("status", "запланировано"),
        "payment_status": row.get("payment_status", "не отмечено"),
        "payment_label": row.get("payment_status", "не отмечено"),
        "payment_marked_by": row.get("payment_marked_by", ""),
        "payment_confirmed_at": row.get("payment_confirmed_at"),
        "price": price,
        "payment_amount": price,
        "topic": row.get("topic", ""),
        "next_plan": row.get("next_plan", ""),
        "notes": row.get("notes", ""),
        "recurrenceId": row.get("stable_series_id", ""),
    }


def homework_view(row: dict[str, Any], student: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "id": row["id"],
        "student_id": row["student_id"],
        "student_name": (student or {}).get("full_name", ""),
        "title": row.get("title") or str(row.get("text", ""))[:44],
        "text": row.get("text", ""),
        "description": row.get("text", ""),
        "estimated_minutes": row.get("estimated_minutes", 0),
        "links": loads_json(row.get("links_json"), []),
        "attachments": loads_json(row.get("materials_json"), []),
        "deadline": row.get("deadline"),
        "status": row.get("status", "ожидание выполнения"),
        "teacher_comment": row.get("teacher_comment", ""),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def payment_view(row: dict[str, Any], student: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "id": row["id"],
        "lesson_id": row.get("lesson_id"),
        "student_id": row["student_id"],
        "student_name": (student or {}).get("full_name", ""),
        "amount": row.get("amount", 0),
        "lessons_count": row.get("lessons_count", 0),
        "status": row.get("status", ""),
        "comment": row.get("comment", ""),
        "markedBy": "student",
        "created_at": row.get("created_at"),
        "confirmed_at": row.get("confirmed_at"),
    }


def topic_view(row: dict[str, Any]) -> dict[str, Any]:
    data = dict(row)
    data["task_number"] = topic_number(row.get("title", ""))
    return data


def loads_json(value: str | None, fallback: Any) -> Any:
    import json

    if not value:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def student_bundle(state: AppState, workspace_id: int, student_id: int) -> dict[str, Any]:
    student = state.db.get_student(workspace_id, student_id)
    if student is None:
        raise HTTPException(status_code=404, detail="Ученик не найден")
    lessons = state.db.list_lessons(workspace_id, student_id, limit=300)
    homeworks = state.db.list_homeworks(workspace_id, student_id, limit=200)
    payments = state.db.list_payments(workspace_id, student_id, limit=200)
    topics = state.db.list_prep_topics(workspace_id, student_id)
    plan = state.db.list_plan_items(workspace_id, student_id)
    now = datetime.now()
    next_lesson = next(
        (lesson for lesson in lessons if parse_dt(lesson.get("starts_at")) and parse_dt(lesson["starts_at"]) >= now),
        None,
    )
    return {
        "student": student_view(student),
        "summary": {
            "next_lesson": lesson_view(next_lesson, student) if next_lesson else None,
            "open_homework": len([item for item in homeworks if item.get("status") not in {"выполнено", "checked", "отменено"}]),
            "unpaid_lessons": len([item for item in lessons if item.get("status") in {"проведено", "conducted"} and item.get("payment_status") not in {"подтверждено репетитором", "paid_by_prepayment"}]),
            "progress_percent": round(student.get("progress_current", 0) / student.get("progress_goal", 1) * 100)
            if student.get("progress_goal")
            else None,
        },
        "lessons": [lesson_view(item, student) for item in lessons],
        "lesson_archive": [],
        "homeworks": [homework_view(item, student) for item in homeworks],
        "payments": [payment_view(item, student) for item in payments],
        "topics": sorted([topic_view(item) for item in topics], key=lambda item: item["task_number"] or 10000),
        "plan": [dict(item) for item in plan],
        "schedule_rules": state.db.rows(
            "SELECT * FROM schedule_rules WHERE workspace_id = ? AND student_id = ? ORDER BY id",
            (workspace_id, student_id),
        ),
    }


def admin_bundle(state: AppState, workspace_id: int) -> dict[str, Any]:
    students = state.db.list_students(workspace_id)
    student_by_id = {item["id"]: item for item in students}
    lessons = state.db.list_lessons(workspace_id, limit=1000)
    homeworks = state.db.list_homeworks(workspace_id, limit=500)
    payments = state.db.list_payments(workspace_id, limit=500)
    now = datetime.now()
    week_end = now + timedelta(days=7)
    month_end = now + timedelta(days=30)
    upcoming = [item for item in lessons if parse_dt(item.get("starts_at")) and parse_dt(item["starts_at"]) >= now]
    week_lessons = [item for item in upcoming if parse_dt(item["starts_at"]) < week_end]
    month_lessons = [item for item in upcoming if parse_dt(item["starts_at"]) < month_end]
    conducted_paid = [
        item
        for item in lessons
        if item.get("status") in {"проведено", "conducted"}
        and item.get("payment_status") in {"подтверждено репетитором", "paid_by_prepayment"}
    ]
    topics_by_student = {
        student["id"]: sorted(
            [topic_view(item) for item in state.db.list_prep_topics(workspace_id, student["id"])],
            key=lambda item: item["task_number"] or 10000,
        )
        for student in students
    }
    plan_by_student = {
        student["id"]: state.db.list_plan_items(workspace_id, student["id"])
        for student in students
    }
    unpaid_lessons = [
        item
        for item in lessons
        if item.get("status") in {"проведено", "conducted"}
        and item.get("payment_status") not in {"подтверждено репетитором", "paid_by_prepayment"}
    ]
    next_lesson = sorted(upcoming, key=lambda item: item["starts_at"])[0] if upcoming else None
    month_income = sum(int(item.get("payment_amount") or 0) for item in conducted_paid)
    week_expected = sum(int(item.get("payment_amount") or student_by_id.get(item["student_id"], {}).get("lesson_price") or 0) for item in week_lessons)
    month_expected = sum(int(item.get("payment_amount") or student_by_id.get(item["student_id"], {}).get("lesson_price") or 0) for item in month_lessons)
    return {
        "summary": {
            "students": len(students),
            "pending_payments": len([item for item in payments if item.get("status") in {"ожидает подтверждения", "pending"}]),
            "pending_lessons": len([item for item in lessons if item.get("status") in {"ожидает подтверждения", "pending_confirmation"}]),
            "month_income": month_income,
            "week_income": 0,
            "today_income": 0,
            "expected_income": sum(int(item.get("payment_amount") or 0) for item in unpaid_lessons),
            "expected_week": week_expected,
            "expected_month": month_expected,
            "week_lessons": len(week_lessons),
            "next_lesson": lesson_view(next_lesson, student_by_id.get(next_lesson["student_id"])) if next_lesson else None,
            "problem_students": [],
        },
        "students": [student_view(item) for item in students],
        "topics_by_student": topics_by_student,
        "plan_by_student": plan_by_student,
        "calendar": [lesson_view(item, student_by_id.get(item["student_id"])) for item in lessons],
        "calendar_archive": [],
        "closed_slots": [],
        "closed_slots_archive": [],
        "pending_lessons": [
            lesson_view(item, student_by_id.get(item["student_id"]))
            for item in lessons
            if item.get("status") in {"ожидает подтверждения", "pending_confirmation"}
        ],
        "homeworks": [homework_view(item, student_by_id.get(item["student_id"])) for item in homeworks],
        "finances": {
            "month_income": month_income,
            "week_income": 0,
            "today_income": 0,
            "expected_income": sum(int(item.get("payment_amount") or 0) for item in unpaid_lessons),
            "expected_week": week_expected,
            "expected_month": month_expected,
            "pending": [payment_view(item, student_by_id.get(item["student_id"])) for item in payments if item.get("status") in {"ожидает подтверждения", "pending"}],
            "unpaid_lessons": [lesson_view(item, student_by_id.get(item["student_id"])) for item in unpaid_lessons],
            "payments": [payment_view(item, student_by_id.get(item["student_id"])) for item in payments],
            "income_events": [
                {
                    "amount": item.get("amount", 0),
                    "confirmed_at": item.get("confirmed_at"),
                    "student_name": student_by_id.get(item["student_id"], {}).get("full_name", ""),
                    "source": "payment",
                }
                for item in payments
            ],
        },
    }


def attach_user_to_tutor_workspace(
    state: AppState,
    payload: JoinTutorRequest,
    user: dict[str, Any],
) -> dict[str, Any]:
    profile = state.db.public_profile(payload.tutor_username.strip())
    if profile is None:
        raise HTTPException(status_code=404, detail="Репетитор или школа не найдены")
    workspace_id = int(profile["workspace_id"])
    role = Role.PARENT.value if payload.role == Role.PARENT.value else Role.STUDENT.value
    full_name = payload.child_name.strip() if role == Role.PARENT.value and payload.child_name.strip() else payload.full_name.strip()
    student = state.db.create_student(
        workspace_id,
        {
            "full_name": full_name,
            "grade": payload.grade,
            "timezone": payload.timezone,
            "prep_type": payload.prep_type,
            "subject": payload.subject,
            "goal": payload.goal,
            "parent_name": payload.full_name if role == Role.PARENT.value else payload.parent_name,
            "parent_telegram": payload.parent_telegram,
            "student_telegram": payload.child_telegram if role == Role.PARENT.value else "",
            "parent_can_edit": payload.parent_can_edit,
            "status": "анкета",
        },
    )
    state.db.conn.execute(
        "UPDATE students SET user_id = ? WHERE id = ? AND workspace_id = ?",
        (user["id"], student["id"], workspace_id),
    )
    state.db.conn.execute(
        """
        INSERT INTO workspace_memberships(workspace_id, user_id, role, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(workspace_id, user_id, role) DO NOTHING
        """,
        (workspace_id, user["id"], role, dt()),
    )
    if role == Role.PARENT.value:
        state.db.conn.execute(
            """
            INSERT INTO parents(workspace_id, user_id, student_id, full_name, contact, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (workspace_id, user["id"], student["id"], payload.full_name, payload.parent_telegram, dt()),
        )
    owner = state.db.row(
        """
        SELECT u.* FROM workspaces w
        JOIN users u ON u.id = w.owner_user_id
        WHERE w.id = ?
        """,
        (workspace_id,),
    )
    if owner:
        body = (
            f"Новый {'родитель' if role == Role.PARENT.value else 'ученик'} прикрепился к вашему кабинету: "
            f"{full_name}"
        )
        state.db.enqueue_notification(
            workspace_id=workspace_id,
            user_id=int(owner["id"]),
            telegram_id=owner.get("telegram_id"),
            channel="telegram",
            kind="new_student_joined",
            title="Новая заявка в CRM",
            body=body,
            payload={"student_id": student["id"], "role": role},
        )
        state.db.enqueue_notification(
            workspace_id=workspace_id,
            user_id=int(owner["id"]),
            telegram_id=None,
            channel="email",
            kind="new_student_joined",
            title="Новая заявка в CRM",
            body=body,
            payload={"student_id": student["id"], "role": role},
        )
    state.db.conn.commit()
    student_row = state.db.get_student(workspace_id, int(student["id"])) or student
    return {"student": student_view(student_row), "auth": issue_tokens(state, user)}


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        state = AppState(settings)
        state.db.import_legacy(
            resolve_path(settings.legacy_database_path),
            owner_email=settings.default_tutor_email,
            first_name=settings.default_tutor_first_name,
            last_name=settings.default_tutor_last_name,
            slug=settings.default_workspace_slug,
        )
        app.state.crmtutor = state
        try:
            yield
        finally:
            state.db.close()

    app = FastAPI(
        title="CRM Tutor SaaS",
        description="Commercial multi-tenant SaaS for tutors on crmtutor.ru. SMS auth is intentionally unsupported.",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    app.mount("/assets", StaticFiles(directory=STATIC_DIR.parent / "assets"), name="assets")

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/tutor/{username}")
    def tutor_page(username: str) -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/{username}")
    def short_tutor_page(username: str) -> FileResponse:
        reserved = {"api", "static", "assets", "docs", "redoc", "openapi.json", "favicon.ico"}
        if username in reserved or username.startswith(".") or "." in username:
            raise HTTPException(status_code=404, detail="Not found")
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "domain": settings.public_base_url, "sms": "disabled"}

    @app.get("/api/plans")
    def plans(state: AppState = Depends(state_dep)) -> dict[str, Any]:
        return {"plans": state.db.list_plans()}

    @app.get("/api/config")
    def public_config() -> dict[str, str]:
        return {
            "public_base_url": settings.public_base_url,
            "telegram_bot_username": settings.telegram_bot_username or "crmtutor_bot",
            "sms": "disabled",
        }

    @app.post("/api/auth/email/request")
    def request_email_otp(payload: EmailOtpRequest, state: AppState = Depends(state_dep)) -> dict[str, Any]:
        code = make_otp()
        state.db.conn.execute(
            """
            INSERT INTO email_otps(email, code_hash, expires_at, created_at)
            VALUES (?, ?, datetime('now', '+10 minutes'), ?)
            """,
            (payload.email.lower(), code_hash(code), dt()),
        )
        state.db.conn.commit()
        return {
            "delivery": "email",
            "message": "Одноразовый код отправляется только на email. SMS в системе не используется.",
            "dev_code": code,
        }

    @app.post("/api/auth/email/verify")
    def verify_email_otp(payload: EmailOtpVerify, state: AppState = Depends(state_dep)) -> dict[str, Any]:
        row = state.db.row(
            """
            SELECT * FROM email_otps
            WHERE email = ? AND consumed_at IS NULL AND expires_at > datetime('now')
            ORDER BY created_at DESC LIMIT 1
            """,
            (payload.email.lower(),),
        )
        if row is None or row["code_hash"] != code_hash(payload.code):
            raise HTTPException(status_code=401, detail="Email code is invalid")
        state.db.conn.execute("UPDATE email_otps SET consumed_at = ? WHERE id = ?", (dt(), row["id"]))
        user = state.db.create_or_get_user(email=payload.email)
        return issue_tokens(state, user)

    @app.post("/api/auth/email/login")
    def login_email(payload: EmailLogin, state: AppState = Depends(state_dep)) -> dict[str, Any]:
        user = state.db.row("SELECT * FROM users WHERE email = ?", (payload.email.lower(),))
        if user is None or not user.get("password_hash") or not verify_password(payload.password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Email или пароль неверны")
        return issue_tokens(state, user)

    @app.post("/api/auth/telegram")
    def telegram_login(payload: TelegramLogin, state: AppState = Depends(state_dep)) -> dict[str, Any]:
        user = state.db.create_or_get_user(
            telegram_id=payload.telegram_id,
            telegram_username=payload.username,
            first_name=payload.first_name,
            last_name=payload.last_name,
            photo_url=payload.photo_url,
        )
        return issue_tokens(state, user)

    @app.post("/api/telegram/link")
    def create_telegram_link(
        auth: dict[str, Any] = Depends(auth_dep),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        token = state.db.create_telegram_link_token(int(auth["user"]["id"]))
        bot_username = state.settings.telegram_bot_username or "crmtutor_bot"
        return {
            "token": token,
            "deep_link": f"https://t.me/{bot_username}?start=link_{token}",
            "message": "Открой ссылку в Telegram, бот привяжет аккаунт к этому профилю.",
        }

    @app.post("/api/telegram/link/confirm")
    def confirm_telegram_link(payload: TelegramLinkConfirm, state: AppState = Depends(state_dep)) -> dict[str, Any]:
        try:
            user = state.db.consume_telegram_link_token(
                payload.token,
                telegram_id=payload.telegram_id,
                telegram_username=payload.username,
                first_name=payload.first_name,
                last_name=payload.last_name,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        state.db.enqueue_notification(
            workspace_id=None,
            user_id=int(user["id"]),
            telegram_id=payload.telegram_id,
            channel="telegram",
            kind="telegram_linked",
            title="Telegram подключен",
            body="Аккаунт CRM Tutor успешно связан с Telegram.",
        )
        return {"user": user, "auth": issue_tokens(state, user)}

    @app.get("/api/bot/telegram/outbox")
    def telegram_outbox(limit: int = 50, state: AppState = Depends(state_dep)) -> dict[str, Any]:
        return {"messages": state.db.list_pending_notifications("telegram", limit)}

    @app.post("/api/bot/telegram/outbox/{message_id}/sent")
    def telegram_outbox_sent(
        message_id: int,
        payload: NotificationSent,
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        return {"message": state.db.mark_notification_sent(message_id, error=payload.error)}

    @app.post("/api/tutors/register")
    def register_tutor(payload: TutorRegistration, state: AppState = Depends(state_dep)) -> dict[str, Any]:
        if state.db.row("SELECT id FROM workspaces WHERE public_slug = ? OR slug = ?", (payload.username, payload.username)):
            raise HTTPException(status_code=409, detail="Username is already taken")
        existing_user = state.db.row("SELECT id, password_hash FROM users WHERE email = ?", (payload.email.lower(),))
        if existing_user and existing_user.get("password_hash"):
            raise HTTPException(status_code=409, detail="Email уже зарегистрирован. Войдите по email и паролю.")
        user = state.db.create_or_get_user(
            email=str(payload.email) if payload.email else None,
            password_hash=hash_password(payload.password),
            first_name=payload.first_name,
            last_name=payload.last_name,
            photo_url=payload.photo_url,
        )
        workspace = state.db.create_workspace(
            owner_user_id=int(user["id"]),
            slug=payload.username,
            name=f"{payload.first_name} {payload.last_name}".strip(),
            public_slug=payload.username,
            first_name=payload.first_name,
            last_name=payload.last_name,
            photo_url=payload.photo_url,
            description=payload.description,
            subjects=payload.subjects,
            directions=payload.directions,
            hourly_price=payload.hourly_price,
            experience_years=payload.experience_years,
            timezone=payload.timezone,
            plan_code=payload.plan_code,
        )
        return {"auth": issue_tokens(state, user), "workspace": workspace, "public_url": f"{settings.public_base_url}/{payload.username}"}

    @app.post("/api/onboarding/workspace")
    def create_workspace_onboarding(
        payload: TutorRegistration,
        auth: dict[str, Any] = Depends(auth_dep),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        if state.db.row("SELECT id FROM workspaces WHERE public_slug = ? OR slug = ?", (payload.username, payload.username)):
            raise HTTPException(status_code=409, detail="Username is already taken")
        user = auth["user"]
        if not user.get("email") and payload.email:
            user = state.db.create_or_get_user(
                email=str(payload.email),
                password_hash=hash_password(payload.password),
                first_name=payload.first_name,
                last_name=payload.last_name,
            )
        elif payload.password:
            user = state.db.create_or_get_user(
                email=str(payload.email),
                password_hash=hash_password(payload.password),
                first_name=payload.first_name,
                last_name=payload.last_name,
            )
        workspace_name = (
            f"Школа {payload.first_name}".strip()
            if payload.workspace_type == "school"
            else f"{payload.first_name} {payload.last_name}".strip()
        )
        workspace = state.db.create_workspace(
            owner_user_id=int(user["id"]),
            slug=payload.username,
            name=workspace_name,
            public_slug=payload.username,
            first_name=payload.first_name,
            last_name=payload.last_name,
            photo_url=payload.photo_url,
            description=payload.description,
            subjects=payload.subjects,
            directions=payload.directions,
            hourly_price=payload.hourly_price,
            experience_years=payload.experience_years,
            timezone=payload.timezone,
            plan_code="school" if payload.workspace_type == "school" else payload.plan_code,
        )
        return {"workspace": workspace, "profile": state.db.get_tutor_profile_by_workspace(int(workspace["id"])), "auth": issue_tokens(state, user)}

    @app.get("/api/me")
    def me(auth: dict[str, Any] = Depends(auth_dep), state: AppState = Depends(state_dep)) -> dict[str, Any]:
        ctx = maybe_first_workspace_context(auth, state)
        if ctx is None:
            return {
                "account": auth["user"],
                "role": "guest",
                "workspaces": [],
                "server_time": datetime.now().isoformat(),
                "registration": {
                    "email": auth["user"].get("email", ""),
                    "telegram_name": " ".join(
                        part for part in [auth["user"].get("first_name", ""), auth["user"].get("last_name", "")] if part
                    ),
                    "timezone_options": [],
                },
            }
        role = ctx["membership"]["role"]
        payload: dict[str, Any] = {
            "account": ctx["user"],
            "role": "tutor" if role in {Role.TUTOR.value, Role.TEACHER.value} else role,
            "workspaces": state.db.list_user_workspaces(int(auth["user"]["id"])),
            "server_time": datetime.now().isoformat(),
        }
        if role in {Role.TUTOR.value, Role.TEACHER.value}:
            payload["admin"] = admin_bundle(state, int(ctx["workspace_id"]))
            payload["tutor_profile"] = state.db.get_tutor_profile_by_workspace(int(ctx["workspace_id"]))
        else:
            student = state.db.row(
                "SELECT * FROM students WHERE workspace_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1",
                (ctx["workspace_id"], auth["user"]["id"]),
            )
            if student:
                payload["dashboard"] = student_bundle(state, int(ctx["workspace_id"]), int(student["id"]))
            else:
                payload["role"] = "guest"
        return payload

    @app.post("/api/register")
    def join_tutor_workspace(
        payload: JoinTutorRequest,
        auth: dict[str, Any] = Depends(auth_dep),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        return attach_user_to_tutor_workspace(state, payload, auth["user"])

    @app.post("/api/public/register")
    def public_join_tutor_workspace(payload: JoinTutorRequest, state: AppState = Depends(state_dep)) -> dict[str, Any]:
        existing_user = state.db.row("SELECT id, password_hash FROM users WHERE email = ?", (payload.email.lower(),))
        if existing_user and existing_user.get("password_hash"):
            raise HTTPException(status_code=409, detail="Email уже зарегистрирован. Войдите по email и паролю.")
        name = payload.full_name if payload.role != Role.PARENT.value else payload.child_name or payload.full_name
        first_name = name.split(" ", 1)[0] if name else ""
        user = state.db.create_or_get_user(
            email=str(payload.email),
            password_hash=hash_password(payload.password),
            first_name=first_name,
        )
        return attach_user_to_tutor_workspace(state, payload, user)

    @app.get("/api/tutor/profile")
    def get_my_tutor_profile(
        auth: dict[str, Any] = Depends(auth_dep),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        ctx = first_workspace_context(auth, state)
        if ctx["membership"]["role"] not in {Role.TUTOR.value, Role.TEACHER.value}:
            raise HTTPException(status_code=403, detail="Нужен доступ репетитора")
        return {"profile": state.db.get_tutor_profile_by_workspace(int(ctx["workspace_id"]))}

    @app.patch("/api/tutor/profile")
    def update_my_tutor_profile(
        payload: TutorProfileUpdate,
        auth: dict[str, Any] = Depends(auth_dep),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        ctx = first_workspace_context(auth, state)
        if ctx["membership"]["role"] not in {Role.TUTOR.value, Role.TEACHER.value}:
            raise HTTPException(status_code=403, detail="Нужен доступ репетитора")
        return {"profile": state.db.update_tutor_profile(int(ctx["workspace_id"]), payload.model_dump(exclude_unset=True))}

    @app.get("/api/workspaces/{workspace_id}/dashboard")
    def dashboard(ctx: dict[str, Any] = Depends(workspace_context), state: AppState = Depends(state_dep)) -> dict[str, Any]:
        return state.db.dashboard(int(ctx["workspace_id"]))

    @app.get("/api/workspaces/{workspace_id}/miniapp")
    def miniapp_payload(ctx: dict[str, Any] = Depends(workspace_context), state: AppState = Depends(state_dep)) -> dict[str, Any]:
        role = ctx["membership"]["role"]
        payload: dict[str, Any] = {
            "account": ctx["user"],
            "role": "tutor" if role in {Role.TUTOR.value, Role.TEACHER.value} else role,
            "server_time": datetime.now().isoformat(),
        }
        if role in {Role.TUTOR.value, Role.TEACHER.value}:
            payload["admin"] = admin_bundle(state, int(ctx["workspace_id"]))
        else:
            student = state.db.row(
                """
                SELECT s.* FROM students s
                JOIN workspace_memberships m ON m.workspace_id = s.workspace_id
                WHERE s.workspace_id = ? AND s.user_id = ?
                LIMIT 1
                """,
                (ctx["workspace_id"], ctx["user"]["id"]),
            )
            if student:
                payload["dashboard"] = student_bundle(state, int(ctx["workspace_id"]), int(student["id"]))
            else:
                payload["role"] = "guest"
        return payload

    @app.post("/api/workspaces/{workspace_id}/students")
    def create_student(
        payload: StudentWrite,
        ctx: dict[str, Any] = Depends(workspace_context),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        if ctx["membership"]["role"] not in {Role.TUTOR.value, Role.TEACHER.value}:
            raise HTTPException(status_code=403, detail="Only tutor or teacher can create students")
        try:
            return {"student": state.db.create_student(int(ctx["workspace_id"]), payload.model_dump())}
        except PermissionError as exc:
            raise HTTPException(status_code=402, detail=str(exc)) from exc

    @app.get("/api/workspaces/{workspace_id}/students")
    def students(ctx: dict[str, Any] = Depends(workspace_context), state: AppState = Depends(state_dep)) -> dict[str, Any]:
        return {"students": state.db.list_students(int(ctx["workspace_id"]))}

    @app.get("/api/workspaces/{workspace_id}/students/{student_id}")
    def student_detail(
        student_id: int,
        ctx: dict[str, Any] = Depends(workspace_context),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        return student_bundle(state, int(ctx["workspace_id"]), student_id)

    @app.patch("/api/workspaces/{workspace_id}/students/{student_id}")
    def update_student(
        student_id: int,
        payload: StudentUpdate,
        ctx: dict[str, Any] = Depends(workspace_context),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        if ctx["membership"]["role"] not in {Role.TUTOR.value, Role.TEACHER.value}:
            raise HTTPException(status_code=403, detail="Only tutor or teacher can update students")
        try:
            state.db.update_student(int(ctx["workspace_id"]), student_id, payload.model_dump(exclude_unset=True))
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return student_bundle(state, int(ctx["workspace_id"]), student_id)

    @app.post("/api/workspaces/{workspace_id}/lessons")
    def create_lesson(
        payload: LessonWrite,
        ctx: dict[str, Any] = Depends(workspace_context),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        try:
            return {"lesson": state.db.add_lesson(int(ctx["workspace_id"]), payload.model_dump())}
        except PermissionError as exc:
            raise HTTPException(status_code=402, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.post("/api/workspaces/{workspace_id}/lessons/{lesson_id}/conducted")
    def conducted(
        lesson_id: int,
        ctx: dict[str, Any] = Depends(workspace_context),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        try:
            return {"lesson": state.db.mark_lesson_conducted(int(ctx["workspace_id"]), lesson_id)}
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.post("/api/workspaces/{workspace_id}/payments")
    def payment(
        payload: PaymentWrite,
        ctx: dict[str, Any] = Depends(workspace_context),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        try:
            return {"payment": state.db.add_payment(int(ctx["workspace_id"]), payload.model_dump())}
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.post("/api/workspaces/{workspace_id}/homeworks")
    def create_homework(
        payload: HomeworkWrite,
        ctx: dict[str, Any] = Depends(workspace_context),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        try:
            return {"homework": homework_view(state.db.add_homework(int(ctx["workspace_id"]), payload.model_dump()))}
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.patch("/api/workspaces/{workspace_id}/homeworks/{homework_id}")
    def update_homework(
        homework_id: int,
        payload: HomeworkUpdate,
        ctx: dict[str, Any] = Depends(workspace_context),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        try:
            return {
                "homework": homework_view(
                    state.db.update_homework(
                        int(ctx["workspace_id"]),
                        homework_id,
                        payload.model_dump(exclude_unset=True),
                    )
                )
            }
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.patch("/api/workspaces/{workspace_id}/students/{student_id}/progress")
    def update_progress(
        student_id: int,
        payload: ProgressWrite,
        ctx: dict[str, Any] = Depends(workspace_context),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        title = payload.title or (f"Задание {payload.task_number}" if payload.task_number else "")
        if not title:
            raise HTTPException(status_code=400, detail="Укажи задание или тему")
        topic = state.db.upsert_prep_topic(
            int(ctx["workspace_id"]),
            student_id,
            {**payload.model_dump(), "title": title},
        )
        topics = state.db.list_prep_topics(int(ctx["workspace_id"]), student_id)
        confident = len([item for item in topics if int(item.get("knowledge_level") or 0) >= 7])
        student = state.db.get_student(int(ctx["workspace_id"]), student_id)
        if student:
            goal = student.get("progress_goal") or default_progress_goal(student.get("prep_type", ""), student.get("subject", "")) or len(topics)
            state.db.update_student(
                int(ctx["workspace_id"]),
                student_id,
                {"progress_current": confident, "progress_goal": goal},
            )
        return {"topic": topic_view(topic), "topics": [topic_view(item) for item in topics]}

    @app.post("/api/workspaces/{workspace_id}/students/{student_id}/plan")
    def create_plan_item(
        student_id: int,
        payload: PlanItemWrite,
        ctx: dict[str, Any] = Depends(workspace_context),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        item = state.db.add_plan_item(int(ctx["workspace_id"]), student_id, payload.model_dump())
        return {
            "item": item,
            "plan": state.db.list_plan_items(int(ctx["workspace_id"]), student_id),
        }

    @app.post("/api/workspaces/{workspace_id}/invites")
    def invite(
        payload: InviteWrite,
        ctx: dict[str, Any] = Depends(workspace_context),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        if ctx["membership"]["role"] != Role.TUTOR.value:
            raise HTTPException(status_code=403, detail="Only workspace owner can invite members")
        invite_row = state.db.add_invite(int(ctx["workspace_id"]), payload.role.value, int(ctx["user"]["id"]))
        return {"invite": invite_row, "url": f"{settings.public_base_url}/invite/{invite_row['token']}"}

    @app.post("/api/workspaces/{workspace_id}/billing/plan")
    def change_plan(
        payload: PlanChange,
        ctx: dict[str, Any] = Depends(workspace_context),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        if ctx["membership"]["role"] != Role.TUTOR.value:
            raise HTTPException(status_code=403, detail="Only workspace owner can change plan")
        try:
            return {"workspace": state.db.set_workspace_plan(int(ctx["workspace_id"]), payload.plan_code)}
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    def compat_ctx(auth: dict[str, Any], state: AppState) -> dict[str, Any]:
        ctx = first_workspace_context(auth, state)
        if ctx["membership"]["role"] not in {Role.TUTOR.value, Role.TEACHER.value}:
            raise HTTPException(status_code=403, detail="Нужен доступ репетитора")
        return ctx

    @app.get("/api/admin/students/{student_id}")
    def compat_student_detail(
        student_id: int,
        auth: dict[str, Any] = Depends(auth_dep),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        ctx = compat_ctx(auth, state)
        return student_bundle(state, int(ctx["workspace_id"]), student_id)

    @app.post("/api/admin/students")
    def compat_create_student(
        payload: StudentWrite,
        auth: dict[str, Any] = Depends(auth_dep),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        ctx = compat_ctx(auth, state)
        student = state.db.create_student(int(ctx["workspace_id"]), payload.model_dump())
        return {"student": student_view(student)}

    @app.patch("/api/admin/students/{student_id}")
    def compat_update_student(
        student_id: int,
        payload: StudentUpdate,
        auth: dict[str, Any] = Depends(auth_dep),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        ctx = compat_ctx(auth, state)
        try:
            state.db.update_student(int(ctx["workspace_id"]), student_id, payload.model_dump(exclude_unset=True))
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return student_bundle(state, int(ctx["workspace_id"]), student_id)

    @app.delete("/api/admin/students/{student_id}")
    def compat_delete_student(
        student_id: int,
        auth: dict[str, Any] = Depends(auth_dep),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        ctx = compat_ctx(auth, state)
        state.db.delete_student(int(ctx["workspace_id"]), student_id)
        return {"deleted": True, "student_id": student_id}

    @app.post("/api/admin/lessons")
    def compat_create_lesson(
        payload: LessonWrite,
        auth: dict[str, Any] = Depends(auth_dep),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        ctx = compat_ctx(auth, state)
        try:
            lesson = state.db.add_lesson(int(ctx["workspace_id"]), payload.model_dump())
        except (ValueError, PermissionError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        student = state.db.get_student(int(ctx["workspace_id"]), int(lesson["student_id"]))
        return {"lesson": lesson_view(lesson, student)}

    @app.patch("/api/admin/lessons/{lesson_id}")
    def compat_update_lesson(
        lesson_id: int,
        payload: dict[str, Any],
        auth: dict[str, Any] = Depends(auth_dep),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        ctx = compat_ctx(auth, state)
        if payload.get("payment_status") == "подтверждено репетитором" and not payload.get("payment_confirmed_at"):
            payload["payment_confirmed_at"] = datetime.now().isoformat()
        try:
            lesson = state.db.update_lesson(int(ctx["workspace_id"]), lesson_id, payload)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        student = state.db.get_student(int(ctx["workspace_id"]), int(lesson["student_id"]))
        return {"lesson": lesson_view(lesson, student)}

    @app.post("/api/admin/lessons/{lesson_id}/confirm")
    def compat_confirm_lesson(
        lesson_id: int,
        auth: dict[str, Any] = Depends(auth_dep),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        ctx = compat_ctx(auth, state)
        lesson = state.db.update_lesson(int(ctx["workspace_id"]), lesson_id, {"status": "запланировано"})
        return {"lesson": lesson_view(lesson, state.db.get_student(int(ctx["workspace_id"]), int(lesson["student_id"])))}

    @app.post("/api/admin/lessons/{lesson_id}/reject")
    def compat_reject_lesson(
        lesson_id: int,
        auth: dict[str, Any] = Depends(auth_dep),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        ctx = compat_ctx(auth, state)
        lesson = state.db.update_lesson(
            int(ctx["workspace_id"]),
            lesson_id,
            {"status": "отменено преподавателем", "cancelled_by": "tutor"},
        )
        return {"lesson": lesson_view(lesson, state.db.get_student(int(ctx["workspace_id"]), int(lesson["student_id"])))}

    @app.delete("/api/admin/lessons/{lesson_id}")
    def compat_delete_lesson(
        lesson_id: int,
        auth: dict[str, Any] = Depends(auth_dep),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        ctx = compat_ctx(auth, state)
        state.db.delete_lesson(int(ctx["workspace_id"]), lesson_id)
        return {"deleted": True, "lesson_id": lesson_id}

    @app.post("/api/lessons/{lesson_id}/cancel")
    def compat_cancel_lesson(
        lesson_id: int,
        auth: dict[str, Any] = Depends(auth_dep),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        ctx = compat_ctx(auth, state)
        lesson = state.db.update_lesson(
            int(ctx["workspace_id"]),
            lesson_id,
            {"status": "отменено преподавателем", "cancelled_by": "tutor"},
        )
        return {"lesson": lesson_view(lesson, state.db.get_student(int(ctx["workspace_id"]), int(lesson["student_id"])))}

    @app.post("/api/lessons/{lesson_id}/move")
    def compat_move_lesson(
        lesson_id: int,
        payload: dict[str, Any],
        auth: dict[str, Any] = Depends(auth_dep),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        ctx = compat_ctx(auth, state)
        lesson = state.db.update_lesson(
            int(ctx["workspace_id"]),
            lesson_id,
            {
                "starts_at": payload.get("starts_at"),
                "duration_minutes": payload.get("duration_minutes"),
                "status": "ожидает подтверждения",
            },
        )
        return {"lesson": lesson_view(lesson, state.db.get_student(int(ctx["workspace_id"]), int(lesson["student_id"])))}

    @app.post("/api/lessons/{lesson_id}/mark-paid")
    def compat_mark_paid(
        lesson_id: int,
        auth: dict[str, Any] = Depends(auth_dep),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        ctx = compat_ctx(auth, state)
        lesson = state.db.update_lesson(
            int(ctx["workspace_id"]),
            lesson_id,
            {
                "payment_status": "подтверждено репетитором",
                "payment_marked_by": "tutor",
                "payment_confirmed_at": datetime.now().isoformat(),
            },
        )
        return {"lesson": lesson_view(lesson, state.db.get_student(int(ctx["workspace_id"]), int(lesson["student_id"])))}

    @app.post("/api/admin/homework")
    def compat_create_homework(
        payload: HomeworkWrite,
        auth: dict[str, Any] = Depends(auth_dep),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        ctx = compat_ctx(auth, state)
        homework = state.db.add_homework(int(ctx["workspace_id"]), payload.model_dump())
        return {"homework": homework_view(homework, state.db.get_student(int(ctx["workspace_id"]), int(homework["student_id"])))}

    @app.patch("/api/admin/homework/{homework_id}")
    def compat_update_homework(
        homework_id: int,
        payload: HomeworkUpdate,
        auth: dict[str, Any] = Depends(auth_dep),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        ctx = compat_ctx(auth, state)
        homework = state.db.update_homework(int(ctx["workspace_id"]), homework_id, payload.model_dump(exclude_unset=True))
        return {"homework": homework_view(homework, state.db.get_student(int(ctx["workspace_id"]), int(homework["student_id"])))}

    @app.delete("/api/admin/homework/{homework_id}")
    def compat_delete_homework(
        homework_id: int,
        auth: dict[str, Any] = Depends(auth_dep),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        ctx = compat_ctx(auth, state)
        state.db.delete_homework(int(ctx["workspace_id"]), homework_id)
        return {"deleted": True, "homework_id": homework_id}

    @app.post("/api/admin/payments")
    def compat_admin_payment(
        payload: PaymentWrite,
        auth: dict[str, Any] = Depends(auth_dep),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        ctx = compat_ctx(auth, state)
        payment = state.db.add_payment(int(ctx["workspace_id"]), payload.model_dump())
        return {"payment": payment_view(payment, state.db.get_student(int(ctx["workspace_id"]), int(payment["student_id"])))}

    @app.post("/api/admin/payments/{payment_id}")
    def compat_payment_decision(
        payment_id: int,
        payload: dict[str, Any],
        auth: dict[str, Any] = Depends(auth_dep),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        ctx = compat_ctx(auth, state)
        status = "подтверждено" if payload.get("action") == "confirm" else "отклонено"
        state.db.conn.execute(
            "UPDATE payments SET status = ?, confirmed_at = ? WHERE workspace_id = ? AND id = ?",
            (status, datetime.now().isoformat() if status == "подтверждено" else None, ctx["workspace_id"], payment_id),
        )
        state.db.conn.commit()
        payment = state.db.row("SELECT * FROM payments WHERE workspace_id = ? AND id = ?", (ctx["workspace_id"], payment_id))
        if payment is None:
            raise HTTPException(status_code=404, detail="Платеж не найден")
        return {"payment": payment_view(payment, state.db.get_student(int(ctx["workspace_id"]), int(payment["student_id"])))}

    @app.patch("/api/students/{student_id}/progress")
    def compat_progress(
        student_id: int,
        payload: ProgressWrite,
        auth: dict[str, Any] = Depends(auth_dep),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        ctx = compat_ctx(auth, state)
        title = payload.title or (f"Задание {payload.task_number}" if payload.task_number else "")
        topic = state.db.upsert_prep_topic(int(ctx["workspace_id"]), student_id, {**payload.model_dump(), "title": title})
        topics = state.db.list_prep_topics(int(ctx["workspace_id"]), student_id)
        return {"topic": topic_view(topic), "topics": [topic_view(item) for item in topics]}

    @app.delete("/api/students/{student_id}/progress/{topic_id}/note")
    def compat_delete_progress_note(
        student_id: int,
        topic_id: int,
        auth: dict[str, Any] = Depends(auth_dep),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        ctx = compat_ctx(auth, state)
        state.db.delete_progress_note(int(ctx["workspace_id"]), student_id, topic_id)
        return {"topics": [topic_view(item) for item in state.db.list_prep_topics(int(ctx["workspace_id"]), student_id)]}

    @app.post("/api/students/{student_id}/plan")
    def compat_create_plan(
        student_id: int,
        payload: PlanItemWrite,
        auth: dict[str, Any] = Depends(auth_dep),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        ctx = compat_ctx(auth, state)
        item = state.db.add_plan_item(int(ctx["workspace_id"]), student_id, payload.model_dump())
        return {"item": item, "plan": state.db.list_plan_items(int(ctx["workspace_id"]), student_id)}

    @app.patch("/api/students/{student_id}/plan/{item_id}")
    def compat_update_plan(
        student_id: int,
        item_id: int,
        payload: dict[str, Any],
        auth: dict[str, Any] = Depends(auth_dep),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        ctx = compat_ctx(auth, state)
        item = state.db.update_plan_item(int(ctx["workspace_id"]), student_id, item_id, payload)
        return {"item": item, "plan": state.db.list_plan_items(int(ctx["workspace_id"]), student_id)}

    @app.get("/api/available-slots")
    def compat_available_slots(
        duration_minutes: int = 60,
        days: int = 14,
        auth: dict[str, Any] = Depends(auth_dep),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        compat_ctx(auth, state)
        start = datetime.now().replace(hour=10, minute=0, second=0, microsecond=0)
        slots = []
        for day in range(days):
            base = start + timedelta(days=day)
            for hour in range(10, 21):
                for minute in (0, 30):
                    value = base.replace(hour=hour, minute=minute)
                    if value > datetime.now():
                        slots.append({"starts_at": value.isoformat(), "teacher_starts_at": value.isoformat(), "student_starts_at": value.isoformat(), "duration_minutes": duration_minutes})
        return {"duration_minutes": duration_minutes, "days": days, "slots": slots[:80]}

    @app.post("/api/schedule-rules")
    def compat_schedule_rule(
        payload: dict[str, Any],
        auth: dict[str, Any] = Depends(auth_dep),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        ctx = compat_ctx(auth, state)
        state.db.conn.execute(
            """
            INSERT INTO schedule_rules(workspace_id, student_id, weekdays_json, lesson_time, duration_minutes, starts_at, ends_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                ctx["workspace_id"],
                payload.get("student_id"),
                "[]",
                payload.get("lesson_time", "18:00"),
                payload.get("duration_minutes", 60),
                payload.get("starts_at"),
                payload.get("ends_at"),
                datetime.now().isoformat(),
            ),
        )
        state.db.conn.commit()
        return {"rules": [], "created": [], "skipped": []}

    @app.post("/api/admin/closed-slots")
    def compat_closed_slot(
        payload: dict[str, Any],
        auth: dict[str, Any] = Depends(auth_dep),
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        compat_ctx(auth, state)
        return {"slot": {"id": 0, **payload, "created_at": datetime.now().isoformat()}}

    @app.delete("/api/admin/closed-slots/{slot_id}")
    def compat_delete_closed_slot(slot_id: int, auth: dict[str, Any] = Depends(auth_dep), state: AppState = Depends(state_dep)) -> dict[str, Any]:
        compat_ctx(auth, state)
        return {"ok": True, "slot_id": slot_id}

    @app.get("/api/public/tutors/{username}")
    def public_tutor(username: str, state: AppState = Depends(state_dep)) -> dict[str, Any]:
        profile = state.db.public_profile(username)
        if profile is None:
            raise HTTPException(status_code=404, detail="Tutor not found")
        return {"profile": profile}

    @app.post("/api/public/tutors/{username}/applications")
    def application(
        username: str,
        payload: ApplicationWrite,
        state: AppState = Depends(state_dep),
    ) -> dict[str, Any]:
        try:
            return {"application": state.db.add_application(username, payload.model_dump())}
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    return app


app = create_app()
