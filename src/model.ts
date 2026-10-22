export type Obj = {
  id: string;
  name: string;
  kind: "shop" | "apartment";
  archived: boolean;
};
export type Category = {
  id: string;
  name: string;
  scope: "shop" | "apartment" | "business";
};
export type Employee = {
  id: string;
  full_name: string;
  position: string;
  object_id: string | null;
  salary: number;
  advance: number;
  day_advance: number | null;
  day_final: number | null;
  active: boolean;
};
export type Template = {
  id: string;
  title: string;
  kind: Kind;
  object_id: string | null;
  category_id: string | null;
  employee_id: string | null;
  planned_amount: number;
  start_date: string;
  end_date: string | null;
  recurrence: string;
  days: number[];
  custom_dates: string[];
  payment_method: string;
  notes: string;
  period_label: string;
  reminder_days: number[];
  active: boolean;
};
export type Kind = "payment" | "salary" | "tax" | "report";
export type Obligation = {
  deleted_at?: string | null;
  id: string;
  template_id: string | null;
  kind: Kind;
  title: string;
  object_id: string | null;
  category_id: string | null;
  employee_id: string | null;
  due_date: string;
  planned_amount: number;
  status: "planned" | "cancelled" | "prepared" | "sent" | "accepted";
  period_label: string;
  payment_method: string;
  notes: string;
  reminder_days: number[];
};
export type Payment = {
  id: string;
  obligation_id: string;
  amount: number;
  paid_on: string;
  comment: string;
  created_at: string;
};
export type Reminder = {
  id: string;
  obligation_id: string;
  channel: string;
  offset_days: number;
  scheduled_for: string;
  sent_at: string;
};
export type Data = {
  objects: Obj[];
  categories: Category[];
  employees: Employee[];
  templates: Template[];
  obligations: Obligation[];
  payments: Payment[];
  reminders: Reminder[];
};
export const empty: Data = {
  objects: [],
  categories: [],
  employees: [],
  templates: [],
  obligations: [],
  payments: [],
  reminders: [],
};
export const money = (n: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 2,
  }).format(n);
export const dateRU = (s: string) =>
  s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : "—";
export const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const today = () => {
  const zone =
    typeof localStorage !== "undefined"
      ? localStorage.getItem("finance_timezone") || "Europe/Moscow"
      : "Europe/Moscow";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return iso(new Date());
  }
};
export const plusDays = (s: string, n: number) => {
  const d = new Date(`${s}T12:00:00`);
  d.setDate(d.getDate() + n);
  return iso(d);
};
export const monthRange = (s: string) => ({
  from: s.slice(0, 7) + "-01",
  to: iso(new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)), 0)),
});
export const paid = (o: Obligation, ps: Payment[]) =>
  ps
    .filter((p) => p.obligation_id === o.id)
    .reduce((a, p) => a + Number(p.amount), 0);
export const remaining = (o: Obligation, ps: Payment[]) =>
  Math.max(0, Number(o.planned_amount) - paid(o, ps));
export function state(o: Obligation, ps: Payment[], now = today()) {
  if (o.status === "cancelled") return "cancelled";
  if (o.kind === "report")
    return o.status === "accepted"
      ? "done"
      : o.due_date < now
        ? "late"
        : o.due_date <= plusDays(now, 7)
          ? "soon"
          : o.status;
  const left = remaining(o, ps);
  if (left <= 0) return "done";
  if (o.due_date < now) return "late";
  if (paid(o, ps) > 0) return "partial";
  if (o.due_date <= plusDays(now, 7)) return "soon";
  return "planned";
}
export const labels: Record<string, string> = {
  planned: "Запланировано",
  soon: "Скоро срок",
  partial: "Частично оплачено",
  done: "Оплачено",
  late: "Просрочено",
  cancelled: "Отменено",
  prepared: "Подготовлено",
  sent: "Отправлено",
  accepted: "Принято",
};
export function metrics(d: Data, from: string, to: string, now = today()) {
  const actual = d.payments
    .filter((p) => p.paid_on >= from && p.paid_on <= to)
    .reduce((a, p) => a + Number(p.amount), 0);
  const items = d.obligations.filter(
    (o) =>
      o.due_date >= from &&
      o.due_date <= to &&
      o.kind !== "report" &&
      o.status !== "cancelled",
  );
  const outstanding = items.reduce((a, o) => a + remaining(o, d.payments), 0);
  const overdue = items.filter(
    (o) => o.due_date < now && remaining(o, d.payments) > 0,
  );
  const upcoming = d.obligations.filter(
    (o) =>
      o.due_date >= now &&
      o.due_date <= plusDays(now, 7) &&
      o.status !== "cancelled" &&
      (o.kind === "report"
        ? o.status !== "accepted"
        : remaining(o, d.payments) > 0),
  );
  return {
    actual,
    outstanding,
    overdue: overdue.reduce((a, o) => a + remaining(o, d.payments), 0),
    overdueCount: overdue.length,
    upcoming: upcoming.length,
    plan: items.reduce((a, o) => a + Number(o.planned_amount), 0),
  };
}

// Keep removed obligations and their payments out of every financial view.
export function activeFinance(d: Data): Data {
  const obligations = d.obligations.filter((o) => !o.deleted_at);
  const ids = new Set(obligations.map((o) => o.id));
  return {
    ...d,
    obligations,
    payments: d.payments.filter((p) => ids.has(p.obligation_id)),
    reminders: d.reminders.filter((r) => ids.has(r.obligation_id)),
  };
}
