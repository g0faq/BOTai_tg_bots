# AUDIT_QA.md — аудит бизнес-логики @g0_faq_bot

**SESSION_ID:** G0BOT-QA-001
**Ветка:** main, HEAD `37ff194` (по содержимому идентичен `a70134c`)
**Режим:** только чтение. Ни один файл в `src/` не изменён.
**Артефакты:** этот файл + `tests/test_qa_findings.py` (21 падающий тест, 1 проходящий).

> **Про состояние дерева.** Во время аудита параллельная сессия правила
> `main.py`, `storage/sqlite.py`, `webapp.py` и добавляла
> `services/heartbeat.py` (в один из моментов `main.py` лежал с
> `NameError: write_heartbeat`), а затем откатила это коммитом
> `37ff194 Revert "Keep the reminder loop alive and observable"`.
> **Все номера строк ниже перепроверены на итоговом дереве `37ff194`**
> (`git status` по `src/` чистый). На нём `pytest -q` без моего файла —
> **91 passed** (откат заодно унёс `tests/test_reminders.py`, который
> добавляла та же сессия). Если heartbeat вернут — строки в `main.py` уедут, ищите по
> именам функций, они указаны рядом с каждой ссылкой.

---

## 0. Сводка

| Домен | Находок | Худший приоритет |
|---|---|---|
| 1. Расписание | 6 | P1 |
| 2. Оплаты и баланс | 10 | P0 |
| 3. Домашние задания | 5 | P1 |
| 4. Подготовка ОГЭ/ЕГЭ | 4 | P2 |
| 5. Права доступа | 7 | P0 |
| **Итого** | **32** | **P0** |

По приоритетам: **P0 — 3** (один из них — F-07 — спорный, зависит от прокси),
**P1 — 10**, **P2 — 16**, **P3 — 3**.

### Три вещи, которые я бы чинил сегодня

1. **F-27** — любой человек, знающий `@username` ученика, регистрируется его
   «родителем» и получает всю карточку: занятия, оплаты, ДЗ, прогресс.
2. **F-12/F-13** — два независимых механизма баланса (`services/payments.py` и
   `advance_ledger` в webapp) пишут в одни и те же поля и затирают друг друга;
   денежный режим баланса уничтожается при первом открытии Mini App.
3. **F-16** — выручка за занятие считается дважды, если ученик отметил оплату
   чеком, а репетитор ещё и подтвердил оплату в карточке занятия.

---

## 1. Расписание

### F-01 (P2) — `WORKING_END=00:00` обнуляет весь рабочий день
`src/tutor_bot/services/scheduling.py:39-45` (`WorkHours.contains`)

`contains()` требует `ends_at.time() <= self.ends_at`. При `working_end = 00:00`
(что человек читает как «до полуночи») условие ложно для любого слота, потому
что `time(0,0)` — минимальное время суток, а не конец. Плюс отдельная проверка
`starts_at.date() != ends_at.date()` уже запрещает переход через полночь.

**Воспроизведение:** `tests/test_qa_findings.py::test_f06_...`. `WORKING_END=0:00`
в `.env` → `validate_slot` на любое время даёт «Время вне рабочих часов
преподавателя».

**Что ломается:** репетитор ставит «работаю до полуночи» и не может записать
ни одного занятия; `/api/available-slots` возвращает пустой список весь день.

**Фикс:** трактовать `ends_at == time(0,0)` как `time.max` (конец суток) при
сравнении, либо валидировать в `load_settings`, что `working_end > working_start`.

---

### F-02 (P1) — занятие, которое уже прошло, можно отменить задним числом
`src/tutor_bot/services/scheduling.py:327-348` (`cancel_lesson`)

Единственная защита — флаг `charged`. Но `charged` ставится только в
`mark_lesson_conducted`. Если `auto_complete_lessons` не сработал (см. F-03),
занятие вчерашнего дня остаётся `PLANNED` и `charged=False` — и ученик спокойно
отменяет его через `POST /api/lessons/{id}/cancel`.

Отмена без штрафа — заявленное поведение продукта (`PKG-INFO`: «отмены без
штрафов»), поэтому отсутствие штрафа за позднюю отмену я НЕ считаю дефектом.
Дефект — отсутствие любой временной границы вообще.

**Воспроизведение:** `test_f22_past_lesson_must_not_be_cancellable`.

**Что ломается:** проведённое занятие исчезает из выручки; репетитор работал
бесплатно.

**Фикс:** запретить отмену, если `lesson.ends_at < now` (и отдельно решить,
нужна ли граница «за N часов до начала»).

---

### F-03 (P1) — автопроведение видит только последние 12 часов
`src/tutor_bot/main.py:141` (`auto_complete_lessons`), тот же паттерн на `:106`
(пост-урочные напоминания об оплате)

`recent_start = now - timedelta(hours=12)`. Всё, что закончилось раньше, не
проводится никогда — цикл вперёд не оглядывается.

**Воспроизведение:** `test_f08_autocomplete_must_charge_lessons_older_than_12_hours`
— занятие 20-часовой давности остаётся `запланировано`.

**Что ломается:** любой простой бота дольше 12 часов (деплой, падение процесса,
перезапуск Amvera) = занятия за этот период навсегда не проведены, баланс не
списан, счёт ученику не выставлен, в выручку не попали. Восстанавливать руками.

**Фикс:** брать окно «от последнего успешного тика» (уже есть heartbeat в
`services/heartbeat.py`) или просто искать все `PLANNED` с `ends_at < now` без
нижней границы.

---

### F-04 (P2) — напоминание «через 5 минут» прилетает по идущему занятию
`src/tutor_bot/storage/sqlite.py:901-921` (`list_lessons_between`),
использование — `src/tutor_bot/main.py:39-43` (`reminder_loop`)

`list_lessons_between` возвращает занятия, **пересекающиеся** с окном
(`starts_at < ends AND ends_at > starts`), а reminder-циклу нужны занятия,
**начинающиеся** в окне.

**Воспроизведение:** `test_f07_reminder_must_not_fire_for_a_lesson_already_in_progress`
— занятие 18:00–20:00 попадает в окно 18:35–18:36.

**Что ломается:** занятие, добавленное «на ходу» (`reminder_sent_at is None`),
получает «🔔 Скоро занятие, начало через 5 минут» посреди самого занятия.
Тот же вызов в `auto_complete_lessons` подхватывает идущее занятие в выборку
(там спасает отдельная проверка `ends_at + 10 мин > now`).

**Фикс:** для напоминаний использовать отдельный запрос по `starts_at BETWEEN ?
AND ?`, а `list_lessons_between` оставить для проверки пересечений слотов.

---

### F-05 (P2) — повторная отмена переписывает историю
`src/tutor_bot/services/scheduling.py:332-347`

`cancel_lesson` не смотрит на текущий статус. Занятие, отменённое
преподавателем, ученик может «отменить» ещё раз — статус станет «отменено
учеником», `cancelled_by` и `cancellation_reason` перезапишутся.

**Воспроизведение:** `test_f05_cancelling_an_already_cancelled_lesson_must_fail`.

**Что ломается:** спор «кто отменил» решается не в пользу репетитора; аудита
отмен фактически нет.

**Фикс:** `if is_cancelled(lesson.status): raise ValueError(...)`.

---

### F-06 (P2) — `МСК±N` разворачивается в `Etc/GMT`, где нет перехода на летнее время
`src/tutor_bot/services/timezones.py:31-50`

`timezone_from_msk_offset` отдаёт `Etc/GMT±N` — зону с фиксированным смещением.
Для России это правильно (перехода нет). Для ученика из зоны с DST (Европа,
Казахстан в прошлом, США) выбор «МСК−2» через UI-пикер
(`timezone_options()` предлагает только `МСК−2…МСК+9`) означает, что полгода
время занятия у него будет смещено на час.

**Оговорка:** это спорная находка. Ученик может ввести IANA-имя вручную
(`normalize_timezone` его принимает), и тогда всё считается корректно —
`create_recurring_lessons_for_local_slots` (`scheduling.py:284-285`) и `convert_timezone`
конвертируют подату, то есть DST обрабатывается верно. Проблема только в том,
что UI предлагает исключительно фиксированные смещения.

**Что ломается:** ученик из зоны с DST приходит на час раньше или позже.

**Фикс:** в `timezone_options()` добавить реальные IANA-зоны, а не только
`МСК±N`.

---

## 2. Оплаты и баланс

### F-07 (P0, спорно) — dev-аутентификация включается заголовком `Host`
`src/tutor_bot/webapp.py:323-325` (`allow_local_dev_auth`), использование `:496-502`

`request.url.hostname` берётся из заголовка `Host`, которым управляет клиент.
`Host: localhost` + `X-Dev-Telegram-Id: <admin_id>` = полная роль репетитора без
Telegram initData.

**Воспроизведение:** `test_f21_dev_auth_must_not_be_reachable_via_host_header`
— проверено, возвращает 200 и `role: admin`.

**Оговорка:** эксплуатируемость зависит от того, пробрасывает ли ingress Amvera
клиентский `Host` до uvicorn. На голом uvicorn — пробрасывает. Не проверял на
продакшене. Возможно, уже покрыто инфраструктурным аудитом — тогда игнорируйте.

**Что ломается:** чтение и запись всех данных всех учеников, все финансы.

**Фикс:** включать dev-auth только по явному env-флагу (`ALLOW_DEV_AUTH=1`), а не
по имени хоста.

---

### F-08 (P1) — подтверждение оплаты может начислить ноль и промолчать
`src/tutor_bot/services/payments.py:49-56` (`confirm_payment`)

```python
lessons_to_add = payment.lessons_count
base_price = student.price_60 or student.lesson_price
if lessons_to_add <= 0 and base_price > 0:
    lessons_to_add = round(payment.amount / base_price, 2)
student.balance_lessons += lessons_to_add
```

Если у ученика не заполнена цена (`price_60 == 0 and lesson_price == 0` — это
дефолт для статуса «анкета») и в чеке не указано число занятий, `lessons_to_add`
остаётся 0. Платёж помечается «подтверждено», баланс не меняется, никакой ошибки.

**Воспроизведение:** `test_f09_confirm_payment_must_not_credit_nothing` — чек на
8000 ₽ подтверждён, баланс 0.

**Что ломается:** ученик заплатил, репетитор нажал «подтвердить», денег на
балансе нет. Обнаруживается через недели.

**Фикс:** бросать `ValueError`, если не удаётся вывести ни `lessons_count`, ни
цену — и показывать репетитору «сначала заполни цену занятия».

---

### F-09 (P1) — `confirm_payment` не атомарен и не защищён от гонки
`src/tutor_bot/services/payments.py:37-65`

Идемпотентность обеспечена только чтением `payment.status` в начале
(строка 44). Между `get_payment` и `update_payment` нет транзакции:
`update_student` (строка 63) и `update_payment` (строка 64) — два отдельных
коммита. Бот и Mini App работают с одной SQLite-базой из разных процессов.

**Воспроизведение:** не покрыто тестом (гонка). Два одновременных нажатия
«Подтвердить» — из бота (`handlers.py:3024`) и из Mini App
(`webapp.py:3206`) — оба видят `PENDING` и оба начисляют.

**Что ломается:** двойное начисление баланса. Либо — если упадёт второй апдейт —
баланс начислен, платёж остался `PENDING`, повторное подтверждение начислит ещё раз.

**Фикс:** обернуть в одну транзакцию и обновлять статус условно
(`UPDATE payments SET status='подтверждено' WHERE id=? AND status='ожидает подтверждения'`),
начислять только если `rowcount == 1`.

---

### F-10 (P2) — подтверждение оплаты в боте и в Mini App делают разное
`src/tutor_bot/bot/handlers.py:3024` vs `src/tutor_bot/webapp.py:3201-3203` (`admin_payment_decision`)

Mini App после `confirm_payment` зовёт `apply_prepaid_lessons` →
`sync_student_advances`, который проставляет «оплачено» на покрытые авансом
занятия. Бот — не зовёт.

**Воспроизведение:** подтвердить один и тот же чек кнопкой в боте, затем открыть
Mini App: список «неоплаченных» занятий меняется сам собой.

**Что ломается:** до открытия Mini App репетитор видит занятия как неоплаченные
и шлёт ученику напоминания об уже оплаченном.

**Фикс:** вынести «подтвердить + пересчитать авансы» в одну функцию сервиса и
звать её из обоих мест.

---

### F-11 (P3) — `confirm_payment` на отклонённом чеке роняет обработчик
`src/tutor_bot/bot/handlers.py:3015-3028`

`confirm_payment` бросает `ValueError("rejected payment cannot be confirmed")`,
а вокруг вызова нет `try/except` (в отличие от `confirm_payment_command` (`handlers.py:3184`)).

**Что ломается:** репетитор жмёт «Подтвердить» на старом сообщении с уже
отклонённым чеком — кнопка молча ничего не делает, в логе трейс.

**Фикс:** обернуть в `try/except ValueError` и ответить текстом.

---

### F-12 (P1) — два независимых механизма баланса пишут в одни поля
`src/tutor_bot/services/payments.py:54,121` vs `src/tutor_bot/webapp.py:888-889`
(`sync_student_advances`)

* Бот: `confirm_payment` делает `balance_lessons += N`, `mark_lesson_conducted`
  делает `balance_lessons -= N` под флагом `charged`.
* Mini App: `sync_student_advances` **перезаписывает** `balance_lessons`
  значением, пересчитанным из `advance_ledger`, и вызывается почти на каждый
  чих (`admin_bundle`, `webapp.py:1283` → `sync_all_student_advances`, на каждое
  открытие кабинета репетитором).

Инкремент/декремент и полный пересчёт — несовместимые модели. Плюс
`PATCH /api/admin/students/{id}` принимает `balance_lessons` напрямую
(`webapp.py:110` в `StudentUpdate`), и это значение стирается при следующем
открытии Mini App.

**Воспроизведение:** выставить баланс руками через API, открыть `/api/me`
репетитором, перечитать ученика — значение другое.

**Что ломается:** баланс «прыгает», ручные корректировки не держатся,
`charged`-декремент теряется.

**Фикс:** выбрать один источник истины. Скорее всего — ledger; тогда убрать
мутации `balance_lessons` из `services/payments.py` и поле из `StudentUpdate`.

---

### F-13 (P1) — `sync_student_advances` насильно переводит ученика в режим «занятия»
`src/tutor_bot/webapp.py:888-889` (`sync_student_advances`)

```python
student.balance_mode = "lessons"
student.balance_lessons = ledger["remaining_lessons"]
```

Безусловно, без оглядки на `student.balance_mode`.

**Воспроизведение:** `test_f10_advance_sync_must_not_overwrite_money_balance_mode`
— ученик с `balance_mode='money'` и `balance_money=6000` после синхронизации
становится `lessons`.

**Что ломается:** `balance_money` остаётся в базе, но перестаёт отображаться и
учитываться (`is_debtor`, `student_debt_amount`, `auto_complete_lessons`, `main.py:148-152`
все смотрят на `balance_mode`). Денежный баланс ученика фактически пропадает.

**Фикс:** синхронизировать авансы только для `balance_mode == 'lessons'`, либо
считать денежный эквивалент и писать в `balance_money`.

---

### F-14 (P2) — занятие нулевой стоимости считается покрытым авансом
`src/tutor_bot/webapp.py:846-850` (`advance_ledger`)

```python
covered_lesson_ids = {
    lesson_id for lesson_id, total_cost in total_cost_by_lesson.items()
    if covered_cost_by_lesson.get(lesson_id, 0) >= total_cost
}
```

При `total_cost == 0` условие `0 >= 0` истинно. `lesson_advance_cost` даёт 0,
когда `payment_amount == 0` и у ученика не заполнены цены.

**Воспроизведение:** `test_f13_free_lesson_must_not_be_marked_paid_by_advance`
— аванс на 1 занятие закрывает 2 занятия нулевой стоимости (и закроет любое
количество).

**Что ломается:** у ученика без заполненной цены (типичная «анкета») все
проведённые занятия автоматически помечаются «оплачено» и выпадают из долгов.

**Фикс:** `if total_cost > 0 and covered >= total_cost`.

---

### F-15 (P2) — `payment_confirmed_at` пишется в двух разных часовых конвенциях
`src/tutor_bot/main.py:161` (`settings.local_now()`, наивное МСК) vs
`src/tutor_bot/webapp.py:2571` и `:878` (`now_utc()`, aware UTC)

Одна и та же колонка `lessons.payment_confirmed_at` заполняется то наивным
местным временем, то UTC со смещением. То же и с `payments.confirmed_at`:
`confirm_payment` пишет aware UTC (`payments.py:59`), а
`update_admin_advance` — наивное (`webapp.py:2820`).

**Воспроизведение:** `test_f12_payment_confirmed_at_must_use_one_timezone_convention`
— бот пишет `2026-08-06 17:11`, Mini App `2026-08-06 14:11+00:00`.

**Что ломается:** в `admin_bundle` (`webapp.py:1293-1313`, `:1329-1343`) границы месяца/недели/дня
считаются от **локальной** даты, а к ним применяется `.replace(tzinfo=None)` к
значениям, часть из которых в UTC. Выручка за 00:00–03:00 МСК первого числа
уезжает в предыдущий месяц; «доход за сегодня» врёт на трёхчасовом окне.

**Фикс:** одна конвенция для всей базы (я бы взял наивное местное, как у
`lessons.starts_at`) + миграция существующих значений.

---

### F-16 (P1) — выручка за одно занятие считается дважды
`src/tutor_bot/webapp.py:1349` (`month_income`), `:951-956` (`lesson_counts_as_income`)

`month_income = сумма цен занятий, помеченных «оплачено» + сумма всех
подтверждённых платежей за месяц`. Дедупликации между ними нет:
`lesson_counts_as_income` исключает только `payment_marked_by in {'auto','advance'}`,
но не случай «ученик прислал чек на конкретное занятие, репетитор подтвердил
чек И отметил занятие оплаченным».

**Воспроизведение:** `test_f11_income_must_not_be_counted_twice` — одно занятие
за 2000 ₽ даёт `month_income = 4000`.

**Сценарий:** ученик в Mini App жмёт «оплатил» на занятии →
`POST /api/payment {amount, lesson_id}` (`webapp.py:2721-2735`). Репетитор
подтверждает чек → +2000. Репетитор же открывает занятие и жмёт «оплачено»
(`mark-paid`, `payment_marked_by='admin'`) → ещё +2000.

**Что ломается:** отчёт по доходам завышен; репетитор принимает решения по
неверным цифрам.

**Фикс:** при `payment.lesson_id is not None` исключать это занятие из
`income_lessons` (или наоборот) — как уже сделано для `advance`/`auto`.

---

## 3. Домашние задания

### F-17 (P1) — дедлайн сравнивается в UTC, хотя хранится в местном времени
`src/tutor_bot/services/homework.py:57-65`

```python
now = datetime.now(UTC)
deadline = homework.deadline
if deadline and deadline.tzinfo is None:
    deadline = deadline.replace(tzinfo=UTC)
```

Дедлайн приходит из `HomeworkWrite.deadline` (наивный datetime из Mini App,
в системе везде местное МСК) и трактуется как UTC. МСК = UTC+3.

**Воспроизведение:** `test_f14_deadline_must_be_compared_in_teacher_local_time`
— ДЗ, сданное через час ПОСЛЕ дедлайна, получает статус «сдано», а не «сдано с
опозданием».

**Что ломается:** трёхчасовое окно безнаказанного опоздания; статистика
дисциплины врёт.

**Фикс:** `attach_timezone(deadline, settings.timezone)` и сравнение в одной
зоне (или единая наивно-местная конвенция по всей базе, см. F-15).

---

### F-18 (P2) — повторная сдача стирает проверку преподавателя
`src/tutor_bot/services/homework.py:61-66`

`submit_homework` безусловно ставит `SUBMITTED`/`SUBMITTED_LATE`, не глядя на
текущий статус. `teacher_comment` остаётся, но статус «проверено» откатывается.

**Воспроизведение:** `test_f15_resubmission_must_not_erase_teacher_review`.

**Что ломается:** проверенное ДЗ снова висит у репетитора в очереди; оценка
теряется. Также ДЗ в статусе «отменено» принимает сдачу.

**Фикс:** запретить сдачу для терминальных статусов (`CHECKED`, `CANCELLED`) или
завести отдельный статус «пересдача».

---

### F-19 (P2) — ДЗ, сданное с опозданием, выпадает из «текущего»
`src/tutor_bot/storage/sqlite.py:1215-1231` (`get_current_homework`)

Выборка идёт по `status IN (выдано, ожидание выполнения, сдано, нужно
исправить)`. Статуса `сдано с опозданием` в списке нет.

**Воспроизведение:** `test_f16_late_homework_must_stay_the_current_one`.

**Что ломается:** после опоздавшей сдачи кнопка «Домашнее задание» в боте
показывает более старое ДЗ или «Текущего ДЗ нет»; напоминание в
`main.py:74` пишет «нет активного ДЗ».

**Фикс:** добавить `SUBMITTED_LATE` в список.

---

### F-20 (P2) — статус «просрочено» не проставляется никогда
`src/tutor_bot/domain/enums.py:54` (`HomeworkStatus.OVERDUE`)

Значение объявлено, но ни одна строка в `src/` его не присваивает (проверено
grep'ом). Фонового джоба, который переводил бы ДЗ в «просрочено» по дедлайну,
нет.

**Что ломается:** ДЗ с прошедшим дедлайном вечно висит в «ожидание выполнения»;
`homework_status_label` (`webapp.py:620-627`) схлопывает его в «ожидание», и
репетитор не видит просрочек списком.

**Фикс:** либо вычислять «просрочено» на лету при сериализации
(`deadline < now and status in {ASSIGNED, WAITING}`), либо проставлять в
reminder-цикле.

---

### F-21 (P2) — `review_homework` — мёртвый код, `checked_at` не заполняется
`src/tutor_bot/services/homework.py:70-85`

Функция с валидацией статуса и проставлением `checked_at` не вызывается
ниоткуда. Единственный путь проверки ДЗ — `PATCH /api/admin/homework/{id}`
(`webapp.py:2632`, `update_homework`), который принимает **любую строку** в `status` без валидации
и не трогает `checked_at`.

**Воспроизведение:** `PATCH /api/admin/homework/1 {"status": "абракадабра"}` →
200, статус сохранён; `homework_status_label` отдаст «ожидание выполнения».

**Что ломается:** мусор в статусах, `checked_at` всегда `NULL`, нельзя
построить отчёт «сколько ДЗ проверено и когда».

**Фикс:** валидировать `status` по `HomeworkStatus` в `HomeworkUpdate` и
использовать `review_homework` для перехода в «проверено»/«нужно исправить».

---

## 4. Подготовка ОГЭ/ЕГЭ

Границы оценок 0–10 сами по себе валидируются корректно:
`ProgressUpdate.knowledge_level = Field(ge=0, le=10)` (`webapp.py:279`),
`task_number = Field(ge=1, le=100)` (`:277`), плюс проверка
`task_number > exam_goal` (`webapp.py:3057-3062`). Здесь дефектов нет.
Проблемы — в пересчёте прогресса.

### F-22 (P2) — авторская тема с цифрой засчитывается как экзаменационное задание
`src/tutor_bot/webapp.py:1153-1155` (`topic_number`), `:1173-1180`
(`progress_relevant_topics`)

`topic_number` склеивает **все** цифры заголовка:
`"Тема 5 про массивы"` → `5`, `"Задание 1 (2024)"` → `12024`.
`progress_relevant_topics` при `exam_goal > 0` берёт всё, у чего номер попадает
в `1..exam_goal`.

**Воспроизведение:** `test_f18_custom_topic_must_not_inflate_exam_progress` —
3 экзаменационных задания + 1 авторская тема «Тема 5 про массивы» дают
`progress_current = 4` при 3 реальных.

**Что ломается:** прогресс может превысить цель (`28/27`); `progress_percent` в
`student_bundle` (`webapp.py:1243-1247`) уходит выше 100 %. Симметрично, легитимное «Задание 1
(2024)» из подсчёта выпадает.

**Фикс:** парсить номер регуляркой `^задание\s+(\d+)` вместо склейки цифр —
`is_exam_task_title` (`webapp.py:1158-1166`) уже делает почти это, но его
результат в фильтре не используется.

---

### F-23 (P2) — «пройдено» в боте и в Mini App — это разные вещи
`src/tutor_bot/services/preparation.py:48-57` (`knowledge_status`) vs
`src/tutor_bot/webapp.py:1188` и `:3082`

* `knowledge_status`: 7–8 → «нужно повторить», 9–10 → «уверенно решает».
* `summarize_preparation.topics_done` (бот) считает `{прошли, уверенно решает}`,
  то есть уровень ≥ 9.
* `progress_current` (Mini App) считает `knowledge_level >= 7`.

**Воспроизведение:** `test_f19_knowledge_level_thresholds_must_agree` — тема с
уровнем 7 даёт `topics_done=0` в боте и `+1` к прогрессу в Mini App.

**Что ломается:** ученик открывает бота и Mini App и видит разные цифры по одним
и тем же темам.

**Фикс:** одна константа порога, используемая обоими местами.

---

### F-24 (P3) — `progress_goal` растёт и не откатывается
`src/tutor_bot/webapp.py:3084` (`update_task_progress`)

```python
student.progress_goal = max(student.progress_goal, request_data.task_number, len(relevant_topics))
```

Только `max`, вниз шкала не едет.

**Воспроизведение:** `test_f20_progress_goal_must_not_ratchet_up_forever` —
опечатка «задание 100» у ученика без экзамена навсегда фиксирует цель 100,
последующее «задание 3» её не чинит.

**Что ломается:** шкала прогресса «3 из 100», починить можно только через
`PATCH /api/admin/students`.

**Фикс:** пересчитывать цель от фактического набора тем, а не через `max` с
предыдущим значением.

---

### F-25 (P3, спорно) — числа заданий в `default_progress_goal` стоит перепроверить
`src/tutor_bot/webapp.py:570-580`

ОГЭ информатика → 16, ОГЭ математика → 19, ЕГЭ информатика → 27,
ЕГЭ математика → 19.

**Оговорка:** я не проверял актуальные КИМ и не берусь утверждать, что цифры
неверны. Отмечаю только то, что это захардкоженные константы без указания года
и без разделения профильной/базовой математики — одно значение `19` на «ЕГЭ мат»
и «ОГЭ мат» выглядит подозрительно, но это надо сверять с ФИПИ, а не со мной.

**Фикс:** вынести в конфиг с явным годом и разделением по уровню экзамена.

---

## 5. Права доступа — проход по всем роутам

В приложении **45 маршрутов** (`GET /`, `/healthz`, `/api/version`, 2 логин-роута
и 40 API-роутов; плюс 4 авто-роута FastAPI `/docs`, `/redoc`, `/openapi.json`,
`/docs/oauth2-redirect`). В задании упомянуто 36 — вероятно, счёт от более
ранней версии. Ниже — все, кроме авто-роутов FastAPI.

Легенда: **✅** — проверка есть и корректна; **⚠️** — проверка есть, но с дырой;
**❌** — проверки нет или она неверна.

| # | Метод и путь | Кто должен иметь доступ | Что реально проверяется | |
|---|---|---|---|---|
| 1 | `GET /` | все | ничего (статика) | ✅ |
| 2 | `GET /healthz` | все | ничего | ✅ |
| 3 | `GET /api/version` | все | ничего | ✅ |
| 4 | `GET /login/{token}` | владелец одноразовой ссылки | срок + роль инвайта; **ссылка не гасится** | ⚠️ F-26 |
| 5 | `GET /login/tutor/{token}` | репетитор | срок инвайта; **ссылка не гасится** | ⚠️ F-26 |
| 6 | `GET /api/me` | любой аутентифицированный | `current_account`; данные по своей роли | ✅ |
| 7 | `POST /api/register` | гость | роль ∈ {student, parent}; **привязка к чужому ученику по `child_telegram`** | ❌ F-27 |
| 8 | `GET /api/admin/students/{id}` | репетитор | `require_admin` | ✅ |
| 9 | `POST /api/admin/students/{id}/browser-invites` | репетитор | `require_admin` | ✅ |
| 10 | `POST /api/admin/browser-invites` | репетитор | `require_admin` | ✅ |
| 11 | `PATCH /api/admin/profile` | репетитор | `require_admin` | ✅ |
| 12 | `POST /api/admin/students` | репетитор | `require_admin` | ✅ |
| 13 | `PATCH /api/admin/students/{id}` | репетитор | `require_admin` | ✅ |
| 14 | `DELETE /api/admin/students/{id}` | репетитор | `require_admin` | ✅ |
| 15 | `PATCH /api/me/student` | ученик; родитель — только при `parent_can_edit` | роль + `parent_can_edit` + белый список полей | ✅ |
| 16 | `DELETE /api/me/student` | **никто из учеников/родителей** | только `account.student_id` | ❌ F-28 |
| 17 | `POST /api/admin/lessons` | репетитор | `require_admin` | ✅ |
| 18 | `PATCH /api/admin/lessons/{id}` | репетитор | `require_admin` | ⚠️ F-30 |
| 19 | `POST /api/admin/lessons/{id}/confirm` | репетитор | `require_admin` | ✅ |
| 20 | `POST /api/admin/lessons/{id}/reject` | репетитор | `require_admin` | ✅ |
| 21 | `DELETE /api/admin/lessons/{id}` | репетитор | `require_admin` | ✅ |
| 22 | `POST /api/lessons/{id}/confirm` | ученик этого занятия | `account.student_id == lesson.student_id` | ✅ |
| 23 | `POST /api/lessons/{id}/cancel` | ученик/родитель c `parent_can_edit`/репетитор | `can_manage_student_calendar` | ✅ |
| 24 | `POST /api/lessons/{id}/move` | то же | `can_manage_student_calendar` | ✅ |
| 25 | `POST /api/lessons/{id}/mark-paid` | ученик/родитель/репетитор | `can_access_student`; **`actor` берётся из тела** | ⚠️ F-29 |
| 26 | `POST /api/admin/homework` | репетитор | `require_admin` | ✅ |
| 27 | `PATCH /api/admin/homework/{id}` | репетитор | `require_admin`; статус не валидируется (F-21) | ⚠️ |
| 28 | `DELETE /api/admin/homework/{id}` | репетитор | `require_admin` | ✅ |
| 29 | `POST /api/homework/{id}/submit` | ученик | `homework.student_id == account.student_id`; **родитель тоже проходит** | ⚠️ F-29 |
| 30 | `POST /api/payment` | ученик/родитель | `student_id` берётся с сервера, `lesson_id` проверяется | ✅ |
| 31 | `POST /api/admin/payments` | репетитор | `require_admin` | ✅ |
| 32 | `POST /api/admin/payments/{id}` | репетитор | `require_admin` | ✅ |
| 33 | `PATCH /api/admin/advances/{id}` | репетитор | `require_admin` | ⚠️ F-31 |
| 34 | `PATCH /api/me/timezone` | ученик; родитель — при `parent_can_edit` | только `account.student_id` | ❌ F-32 |
| 35 | `GET /api/available-slots` | ученик/родитель/репетитор | `student_id` из query читает только админ | ✅ |
| 36 | `POST /api/book` | ученик | `student_id` берётся с сервера | ✅ |
| 37 | `POST /api/schedule-rules` | ученик/родитель c `parent_can_edit`/репетитор | `can_manage_student_calendar` | ✅ |
| 38 | `POST /api/admin/closed-slots` | репетитор | `require_admin` | ✅ |
| 39 | `DELETE /api/admin/closed-slots/{id}` | репетитор | `require_admin` | ✅ |
| 40 | `PATCH /api/students/{id}/progress` | ученик (свой) / репетитор | родитель отсечён, `account.student_id == student_id` | ✅ |
| 41 | `DELETE /api/students/{id}/progress/{tid}/note` | то же | + `topic.student_id == student_id` | ✅ |
| 42 | `DELETE /api/students/{id}/progress/{tid}` | то же | + запрет удаления экзаменационных заданий | ✅ |
| 43 | `POST /api/students/{id}/plan` | то же | ✅ | ✅ |
| 44 | `PATCH /api/students/{id}/plan/{iid}` | то же | + `item.student_id == student_id` | ✅ |
| 45 | `DELETE /api/students/{id}/plan/{iid}` | то же | + `item.student_id == student_id` | ✅ |

**Главный вывод по домену:** прямого горизонтального IDOR (ученик читает чужого
ученика по подстановке `student_id`) я не нашёл — все роуты с `{student_id}` в
пути сверяют его с `account.student_id`, а `student_bundle` доступен только через
`/api/me`. Дыры лежат не в проверке id, а в том, **как аккаунт получает
`student_id`** (F-27) и в двух роутах `/api/me/*`, где роль вообще не смотрят
(F-28, F-32).

---

### F-26 (P1) — инвайт-ссылка одноразовой не является
`src/tutor_bot/webapp.py:1818-1849` (`accept_browser_invite`) и
`:1852-1874` (`accept_tutor_browser_invite`)

`state.db.mark_browser_invite_used` / `mark_tutor_browser_invite_used`
(`sqlite.py:502`, `:574`) реализованы, но не вызываются. Срок жизни инвайта по
умолчанию `BROWSER_INVITE_DAYS = 3650` (10 лет, `webapp.py:63`).

**Воспроизведение:** `test_f04_browser_invite_link_must_be_single_use` — второй
`GET /login/{token}` снова отдаёт 303 и ставит новую сессию-куку.

**Что ломается:** ссылка, один раз пересланная в чате/скриншоте, даёт доступ к
кабинету ученика (или репетитора — для `/login/tutor/`) следующие 10 лет.

**Фикс:** звать `mark_browser_invite_used` и отвергать инвайт с непустым
`used_at`; заодно урезать дефолт `invite_days` до суток.

---

### F-27 (P0) — самопровозглашённый родитель захватывает чужого ученика
`src/tutor_bot/webapp.py:1907-1936` (`register`)

```python
child_contact = request_data.child_telegram.strip()
student = state.db.find_student_by_contact(child_contact)
...
state.db.upsert_user(UserAccount(..., role=PARENT, student_id=student.id, ...))
```

Никакого подтверждения со стороны репетитора или самого ученика.
`find_student_by_contact` (`sqlite.py:956-971`) ищет и по `student_telegram`, и
по `parent_telegram`, в любом из вариантов с `@` и без.

**Воспроизведение:** `test_f01_registration_as_parent_must_not_hijack_existing_student`.

**Что ломается:** посторонний получает `GET /api/me` → `student_bundle` со всей
карточкой: ФИО, класс, контакты родителя, расписание, все занятия, все платежи
и суммы, ДЗ, прогресс по заданиям. И может писать: отмечать оплаты, отменять
занятия (при `parent_can_edit`), удалить карточку (F-28).

Усугубляется тем, что `PATCH /api/me/student` (`webapp.py:2186-2215`, белый список `allowed_fields`) держит
`parent_telegram` в белом списке полей: ученик может сам вписать туда
произвольный `@username`, после чего тот человек тоже подходит под
`find_student_by_contact`.

**Фикс:** родительская привязка — только через инвайт от репетитора
(механизм `browser_invites` уже есть) или через подтверждение учеником.

---

### F-28 (P0) — `DELETE /api/me/student` не смотрит на роль
`src/tutor_bot/webapp.py:2246-2263` (`delete_my_student`)

Единственная проверка — `if not account.student_id`. Дальше
`state.db.delete_student` (`sqlite.py:778-781`), а схема (`sqlite.py:161`, `:194`,
`:212`, `:229-230`, `:238`, `:248`, `:258`) держит `ON DELETE CASCADE` на занятиях, платежах, ДЗ,
сабмитах, темах, плане и правилах расписания.

**Воспроизведение:** `test_f02_parent_must_not_delete_student_profile`.

**Что ломается:** родитель (в том числе самопровозглашённый по F-27) одним
запросом безвозвратно сносит всю финансовую и учебную историю ученика.
Бэкапов на уровне приложения нет, undo нет; репетитор узнаёт по факту.

**Фикс:** минимум — `parent_can_edit` + подтверждение; лучше — заменить на
архивирование (`archive_student` уже есть, `sqlite.py:759`), а физическое
удаление оставить репетитору.

---

### F-29 (P2) — родитель приравнен к ученику там, где `parent_can_edit` не спрашивают
`src/tutor_bot/webapp.py:2564` (`mark-paid`, `can_access_student`),
`:2705` (`submit`), `src/tutor_bot/bot/handlers.py:2266-2290`
(`self_clear_regular_schedule`), `:3903` (сдача ДЗ в боте)

`can_manage_student_calendar` (`webapp.py:1579-1585`) — единственное место, где
`parent_can_edit` реально проверяется. Остальные пишущие операции обходятся
`can_access_student`, который на роль не смотрит вовсе:

```python
def can_access_student(account, student_id):
    return account.role == Role.ADMIN.value or account.student_id == student_id
```

Отдельно: в боте `self_clear_regular_schedule` зовёт
`clear_future_stable_lessons` для любой роли, без `parent_can_edit` — то есть
через бота родитель сносит всё стабильное расписание, хотя через Mini App
(`POST /api/schedule-rules`) ему это запрещено.

**Что ломается:** родитель без права редактирования отмечает оплаты от имени
ученика, сдаёт за него ДЗ и чистит расписание через бота.

**Фикс:** ввести `can_write_for_student(account, student_id)` с проверкой
`parent_can_edit` и использовать её во всех пишущих роутах и хендлерах бота.

Мелочь там же: `MarkLessonPaymentRequest.actor` (`webapp.py:205`) берётся из
тела запроса, и ученик может проставить себе `payment_marked_by = 'parent'`
(`webapp.py:2572-2577`). Косметика, но поле перестаёт быть достоверным. **P3.**

---

### F-30 (P2) — `PATCH /api/admin/lessons/{id}` ставит статус «проведено» мимо биллинга
`src/tutor_bot/webapp.py:2334-2342` (`update_lesson`)

Статус пишется напрямую `setattr(lesson, 'status', ...)`, `mark_lesson_conducted`
не вызывается: `charged` остаётся `False`, баланс не списывается. Валидации
допустимых значений `status` тоже нет (`LessonUpdate.status: str | None`).

**Что ломается:** занятие «проведено», баланс не тронут; после этого его ещё и
можно отменить (F-02, проверка идёт по `charged`). Плюс в поле статуса можно
записать произвольную строку — `is_cancelled` и `lesson_counts_as_income` её не
узнают, занятие выпадает из всех отчётов.

**Фикс:** валидировать `status` по `LessonStatus` и переводить в «проведено»
только через `mark_lesson_conducted`.

---

### F-31 (P2) — `PATCH /api/admin/advances/{id}` подтверждает платёж мимо `confirm_payment`
`src/tutor_bot/webapp.py:2819-2831` (`update_admin_advance`)

```python
payment.status = PaymentStatus.CONFIRMED.value
state.db.update_payment(payment)
sync_student_advances(state, student.id)
```

Платёж в статусе «ожидает подтверждения» (или даже «отклонено») переводится в
«подтверждено» напрямую. `confirm_payment` с его правилом «отклонённый нельзя
подтвердить» (`payments.py:46-47`) обходится.

**Что ломается:** отклонённый чек воскрешается редактированием аванса; баланс
пересчитывается из ledger, а `balance_after_*` в платеже становится
недостоверным.

**Фикс:** отдельно валидировать переход статуса или звать `confirm_payment`.

---

### F-32 (P1) — `PATCH /api/me/timezone` игнорирует роль и `parent_can_edit`
`src/tutor_bot/webapp.py:2834-2843` (`update_my_timezone`)

Проверяется только `account.student_id`. При этом соседний
`PATCH /api/me/student` (`webapp.py:2179-2182`) для той же операции (`timezone` есть в
его белом списке) родителя без `parent_can_edit` отсекает — то есть запрет
задуман, но обходится другим роутом.

**Воспроизведение:** `test_f03_parent_must_not_change_student_timezone`.

**Что ломается:** `student.timezone` участвует в `to_teacher_time`
(`webapp.py:525`) и `to_student_time` — все отображаемые ученику времена
занятий и все создаваемые им записи сдвигаются. Родитель может незаметно
сдвинуть расписание ребёнка на часы.

**Фикс:** применить те же проверки, что в `PATCH /api/me/student`, либо убрать
роут и оставить один способ редактирования профиля.

---

## 6. Покрытие тестами

Замерить покрытие не удалось:

```
$ .venv/bin/python -m pytest --cov=src -q
ERROR: unrecognized arguments: --cov=src
```

`pytest-cov` в `.venv` не установлен; пакета `coverage` там тоже нет.
По условиям задачи я ничего не устанавливал.

Чтобы замерить (команда для владельца проекта):

```bash
.venv/bin/pip install pytest-cov && .venv/bin/python -m pytest --cov=src --cov-report=term-missing -q
```

Что можно сказать без инструмента, по составу тестов:

| Модуль | Строк | Тестовый файл | Наблюдение |
|---|---:|---|---|
| `bot/handlers.py` | 3978 | `tests/test_handlers.py` (166) | самый большой модуль, тестов на него меньше всего |
| `webapp.py` | 3233 | `tests/test_webapp.py` (1310) | покрыт заметно лучше, но 40 роутов на 1310 строк тестов |
| `storage/sqlite.py` | 1717 | — | отдельного файла нет, покрывается косвенно |
| `services/payments.py` | 148 | — | **отдельного `tests/test_payments.py` нет**, хотя в `bot_sales_kit/template/tests/` и `bot_sales_kit/clients/*/tests/` он есть. Похоже, файл потеряли при синхронизации шаблона |
| `services/scheduling.py` | 386 | `tests/test_scheduling.py` (328) | покрыт хорошо |
| `services/homework.py` | 85 | `tests/test_homework.py` (34) | покрыт поверхностно — все находки F-17…F-19 мимо тестов |
| `services/preparation.py` | 60 | — | тестов нет |
| `hub/*` | 1372 | — | тестов нет вовсе |

Отдельно: `pytest -q --ignore=tests/test_qa_findings.py` на чистом дереве —
**91 passed**. Вместе с моим файлом — **92 passed, 21 failed**. То есть все
существующие тесты зелёные, и ни одна из 32 находок ими не ловится.

---

## 7. Что я НЕ считаю дефектом (проверил, всё в порядке)

* **Отмена без штрафа** — заявленное поведение продукта (`PKG-INFO`).
* **Занятие ровно на границе окна записи** — `WorkHours.contains` и
  `available_slots` согласованы: слот, заканчивающийся ровно в `working_end`,
  допускается в обоих местах.
* **Переход через полночь** — запрещён явно
  (`scheduling.py:41-42`), это осознанное решение, а не баг (баг только в
  частном случае `working_end = 00:00`, F-01).
* **DST при регулярном расписании** — `create_recurring_lessons_for_local_slots`
  конвертирует каждую дату отдельно через `convert_timezone`, поэтому переход на
  летнее время обрабатывается корректно. Проблема только в наборе зон в UI (F-06).
* **Пересечения занятий и закрытые слоты** — `validate_slot` +
  `list_lessons_between` + `list_closed_slots_between` покрывают все четыре
  случая пересечения (внутри, снаружи, слева, справа); `overlaps` написан верно,
  границы касания (`end == start`) корректно не считаются пересечением.
* **Идемпотентность списания при проведении занятия** — флаг `charged`
  (`payments.py:118-125`) корректно защищает от двойного списания при повторном
  вызове `mark_lesson_conducted`.
* **Горизонтальный доступ по `{student_id}` в пути** — все 6 таких роутов
  сверяют путь с `account.student_id`, дыр нет.
* **Каскадное удаление** — `PRAGMA foreign_keys = ON` включён (`sqlite.py:54`),
  сабмиты ДЗ и всё остальное корректно уходят вместе с учеником
  (`test_f17_homework_of_deleted_student_must_not_survive` — единственный
  проходящий тест в моём файле).
* **Границы оценок 0–10** — валидируются pydantic'ом, обойти нельзя.

---

## 8. Как запустить находки

```bash
.venv/bin/python -m pytest tests/test_qa_findings.py -q
```

Ожидаемо: **21 failed, 1 passed**. Каждый упавший тест соответствует находке
(идентификатор `F-xx` в его docstring), проходящий — раздел 7.
