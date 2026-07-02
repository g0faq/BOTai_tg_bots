from __future__ import annotations

from dataclasses import dataclass

from tutor_bot.domain.enums import PlanItemStatus, PrepTopicStatus
from tutor_bot.domain.models import PlanItem, PrepTopic


@dataclass(frozen=True, slots=True)
class PreparationSummary:
    topics_total: int
    topics_done: int
    topics_in_progress: int
    topics_problem: int
    solved_total: int
    average_knowledge_level: float
    plan_total: int
    plan_done: int

    @property
    def progress_percent(self) -> int:
        if self.topics_total == 0:
            return 0
        return round(self.topics_done / self.topics_total * 100)


def summarize_preparation(topics: list[PrepTopic], plan: list[PlanItem]) -> PreparationSummary:
    done_statuses = {PrepTopicStatus.DONE.value, PrepTopicStatus.CONFIDENT.value}
    progress_statuses = {PrepTopicStatus.STARTED.value, PrepTopicStatus.REVIEW.value}
    return PreparationSummary(
        topics_total=len(topics),
        topics_done=sum(1 for topic in topics if topic.status in done_statuses),
        topics_in_progress=sum(1 for topic in topics if topic.status in progress_statuses),
        topics_problem=sum(1 for topic in topics if topic.status == PrepTopicStatus.PROBLEM.value),
        solved_total=sum(topic.solved_count for topic in topics),
        average_knowledge_level=round(sum(topic.knowledge_level for topic in topics) / len(topics), 1)
        if topics
        else 0,
        plan_total=len(plan),
        plan_done=sum(1 for item in plan if item.status == PlanItemStatus.DONE.value),
    )


def exam_task_titles(task_count: int) -> list[str]:
    return [f"Задание {number}" for number in range(1, task_count + 1)]


def knowledge_status(level: int) -> str:
    if level <= 0:
        return PrepTopicStatus.NOT_STARTED.value
    if level <= 3:
        return PrepTopicStatus.PROBLEM.value
    if level <= 6:
        return PrepTopicStatus.STARTED.value
    if level <= 8:
        return PrepTopicStatus.REVIEW.value
    return PrepTopicStatus.CONFIDENT.value


EGE_INFORMATICS_TOPICS = exam_task_titles(27)
