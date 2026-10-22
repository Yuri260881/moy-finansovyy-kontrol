import test from "node:test";
import assert from "node:assert/strict";
import {
  empty,
  activeFinance,
  metrics,
  remaining,
  state,
  type Obligation,
  type Payment,
} from "./model.ts";
const o: Obligation = {
  id: "1",
  template_id: "t",
  kind: "payment",
  title: "Аренда",
  object_id: null,
  category_id: null,
  employee_id: null,
  due_date: "2026-10-20",
  planned_amount: 1000,
  status: "planned",
  period_label: "",
  payment_method: "",
  notes: "",
  reminder_days: [],
};
const p: Payment = {
  id: "p",
  obligation_id: "1",
  amount: 400,
  paid_on: "2026-10-21",
  comment: "",
  created_at: "",
};
test("partial payment counts on actual date only and leaves a balance", () => {
  const d = { ...empty, obligations: [o], payments: [p] };
  assert.equal(remaining(o, [p]), 600);
  assert.equal(metrics(d, "2026-10-01", "2026-10-20", "2026-10-21").actual, 0);
  const m = metrics(d, "2026-10-01", "2026-10-31", "2026-10-21");
  assert.deepEqual(
    { actual: m.actual, outstanding: m.outstanding, overdue: m.overdue },
    { actual: 400, outstanding: 600, overdue: 600 },
  );
  assert.equal(state(o, [p], "2026-10-21"), "late");
});
test("cancelled and reporting tasks do not enter payment plan", () => {
  assert.equal(
    metrics(
      {
        ...empty,
        obligations: [
          { ...o, status: "cancelled" },
          { ...o, id: "2", kind: "report" },
        ],
      },
      "2026-10-01",
      "2026-10-31",
    ).plan,
    0,
  );
});

test("trash removes obligations and their actual payments, restoration restores both", () => {
  const deleted = { ...o, deleted_at: "2026-10-22T09:00:00Z" };
  const source = { ...empty, obligations: [deleted], payments: [p] };
  const visible = activeFinance(source);
  assert.equal(visible.obligations.length, 0);
  assert.equal(visible.payments.length, 0);
  assert.equal(metrics(visible, "2026-10-01", "2026-10-31").actual, 0);
  const restored = activeFinance({
    ...source,
    obligations: [{ ...deleted, deleted_at: null }],
  });
  assert.equal(restored.payments.length, 1);
  assert.equal(metrics(restored, "2026-10-01", "2026-10-31").actual, 400);
  assert.equal(source.payments.length, 1);
});
