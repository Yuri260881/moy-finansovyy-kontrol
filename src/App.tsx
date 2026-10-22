import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  Bell,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  LayoutDashboard,
  Menu,
  Plus,
  Search,
  Settings,
  Users,
  Wallet,
  Upload,
  Trash2,
} from "lucide-react";
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { toXlsx, parseXlsx, parseCsv, rowsToObjects } from "./spreadsheet";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase, configured, invoke, loginEmail } from "./supabase";
import {
  empty,
  activeFinance,
  dailyObligations,
  type Data,
  type Obligation,
  type Obj,
  type Category,
  type Employee,
  type Kind,
  paid,
  remaining,
  state,
  labels,
  money,
  dateRU,
  today,
  iso,
  plusDays,
  monthRange,
  metrics,
} from "./model";
import type { Session } from "@supabase/supabase-js";
type Page =
  | "dashboard"
  | "calendar"
  | "payments"
  | "employees"
  | "taxes"
  | "analytics"
  | "objects"
  | "settings";
const nav: [Page, string, typeof LayoutDashboard][] = [
  ["dashboard", "Обзор", LayoutDashboard],
  ["calendar", "Календарь", CalendarDays],
  ["payments", "Платежи", Wallet],
  ["employees", "Сотрудники", Users],
  ["taxes", "Налоги и отчетность", FileText],
  ["analytics", "Аналитика", Activity],
  ["objects", "Объекты", Menu],
  ["settings", "Настройки", Settings],
];
const err = (e: unknown) => (e instanceof Error ? e.message : String(e));
const amount = (s: string) => Number(s.replace(",", "."));
async function fetchAll(table: string) {
  let rows: Record<string, unknown>[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order(table === "user_settings" ? "user_id" : "id")
      .range(start, start + 999);
    if (error) throw error;
    rows = rows.concat(data || []);
    if ((data || []).length < 1000) return rows;
  }
}
function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function csv(rows: (string | number)[][]) {
  return (
    "\uFEFF" +
    rows
      .map((r) =>
        r
          .map((x) => '"' + String(x ?? "").replaceAll('"', '""') + '"')
          .join(";"),
      )
      .join("\r\n")
  );
}
function Auth() {
  const [password, setPassword] = useState(""),
    [msg, setMsg] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await supabase.auth.signInWithPassword({
      email: loginEmail!,
      password,
    });
    setMsg(
      r.error ? "Не удалось войти. Проверьте пароль и повторите попытку." : "",
    );
    setBusy(false);
  }
  return (
    <div className="auth">
      <div className="auth-card">
        <div className="mark">₽</div>
        <h1>Мой финансовый контроль</h1>
        <p>Обязательства и расходы бизнеса в одном месте.</p>
        {!configured ? (
          <div className="notice">
            Для запуска укажите VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY и
            VITE_LOGIN_EMAIL в .env. Инструкция есть в README.md.
          </div>
        ) : (
          <form onSubmit={submit}>
            <label>
              Пароль
              <input
                type="password"
                minLength={6}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
            <button className="primary" disabled={busy}>
              Войти
            </button>
            {msg && <p role="alert">{msg}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
export default function App() {
  const [session, setSession] = useState<Session | null>(null),
    [loading, setLoading] = useState(true),
    [d, setD] = useState<Data>(empty),
    [deleted, setDeleted] = useState<Obligation[]>([]),
    [page, setPage] = useState<Page>("dashboard"),
    [selected, setSelected] = useState<Obligation | null>(null),
    [form, setForm] = useState<"payment" | "tax" | "report" | null>(null),
    [flash, setFlash] = useState(""),
    [search, setSearch] = useState(""),
    [filterObject, setFilterObject] = useState(""),
    [day, setDay] = useState(today()),
    [period, setPeriod] = useState<"today" | "current" | "previous" | "custom">(
      new URLSearchParams(location.search).has("today") ? "today" : "current",
    ),
    [customFrom, setCustomFrom] = useState(today().slice(0, 7) + "-01"),
    [customTo, setCustomTo] = useState(today()),
    [theme, setTheme] = useState(localStorage.getItem("theme") || "light"),
    [setup, setSetup] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);
  async function reload() {
    if (!session) return;
    try {
      const tables = [
        "objects",
        "categories",
        "employees",
        "templates",
        "obligations",
        "payments",
        "reminder_log",
      ] as const;
      const results = await Promise.all(tables.map(fetchAll));
      const loaded: Data = {
        objects: results[0] as Obj[],
        categories: results[1] as Category[],
        employees: results[2] as Employee[],
        templates: results[3] as Data["templates"],
        obligations: results[4] as Obligation[],
        payments: results[5] as Data["payments"],
        reminders: results[6] as Data["reminders"],
      };
      setDeleted(loaded.obligations.filter((o) => o.deleted_at));
      setD(activeFinance(loaded));
      const { data: profile } = await supabase
        .from("profiles")
        .select("setup_done")
        .eq("id", session.user.id)
        .single();
      setSetup(!profile?.setup_done);
    } catch (e) {
      setFlash(err(e));
    }
  }
  useEffect(() => {
    if (session) {
      reload();
      supabase
        .rpc("generate_occurrences", { p_user: session.user.id })
        .then(() => reload());
    }
  }, [session?.user.id]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);
  async function mutate(table: string, body: object, id?: string) {
    const q = id
      ? supabase.from(table).update(body).eq("id", id)
      : supabase.from(table).insert({ ...body, user_id: session!.user.id });
    const { error } = await q;
    if (error) throw error;
    await reload();
  }
  async function run(fn: () => Promise<unknown>, success = "Сохранено") {
    try {
      await fn();
      let calendarWarning = "";
      try {
        await invoke("calendar-sync", { action: "sync-if-connected" });
      } catch {
        calendarWarning =
          " Данные сохранены, но Google Календарь не обновился. Повторите синхронизацию в настройках.";
      }
      setFlash(success + calendarWarning);
      setTimeout(() => setFlash(""), 5000);
    } catch (e) {
      setFlash(err(e));
    }
  }
  useEffect(() => {
    const timer = setInterval(() => setDay(today()), 60000);
    return () => clearInterval(timer);
  }, []);
  const daily = dailyObligations(d, day);
  const dueTotal = daily.due
    .filter((o) => o.kind !== "report")
    .reduce((sum, o) => sum + remaining(o, d.payments), 0);
  const range = useMemo(() => {
    if (period === "today") return { from: day, to: day };
    if (period === "custom") return { from: customFrom, to: customTo };
    let dt = new Date();
    if (period === "previous")
      dt = new Date(dt.getFullYear(), dt.getMonth() - 1, 1);
    return monthRange(iso(dt));
  }, [period, customFrom, customTo, day]);
  const m = metrics(d, range.from, range.to);
  const names = (o: Obligation) =>
    d.objects.find((x) => x.id === o.object_id)?.name ||
    "Общие расходы бизнеса";
  const items = d.obligations
    .filter(
      (o) =>
        (!filterObject || o.object_id === filterObject) &&
        (!search ||
          `${o.title} ${names(o)}`
            .toLowerCase()
            .includes(search.toLowerCase())),
    )
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  function exportIcs() {
    const esc = (v: string) =>
      v
        .replaceAll("\\", "\\\\")
        .replaceAll(",", "\\,")
        .replaceAll(";", "\\;")
        .replaceAll("\n", "\\n");
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Moy Finansovyy Kontrol//RU",
    ];
    d.obligations
      .filter((o) => o.status !== "cancelled")
      .forEach((o) => {
        const done = state(o, d.payments) === "done";
        lines.push(
          "BEGIN:VEVENT",
          `UID:${o.id}@finance.local`,
          `DTSTAMP:${new Date()
            .toISOString()
            .replace(/[-:]/g, "")
            .replace(/\.\d{3}/, "")}`,
          `DTSTART;VALUE=DATE:${o.due_date.replaceAll("-", "")}`,
          `DTEND;VALUE=DATE:${plusDays(o.due_date, 1).replaceAll("-", "")}`,
          `SUMMARY:${esc((done ? "✓ " : "") + o.title)}`,
          `DESCRIPTION:${esc(names(o) + " • " + money(o.planned_amount) + " • " + labels[state(o, d.payments)])}`,
          "END:VEVENT",
        );
      });
    lines.push("END:VCALENDAR");
    download(
      new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" }),
      "finansovyy-kalendar.ics",
    );
  }
  async function exportTable(type: "csv" | "xlsx" | "pdf") {
    const rows = d.payments
      .filter((p) => p.paid_on >= range.from && p.paid_on <= range.to)
      .map((p) => {
        const o = d.obligations.find((x) => x.id === p.obligation_id);
        return [
          dateRU(p.paid_on),
          o?.title || "Удаленное обязательство",
          o ? names(o) : "",
          Number(p.amount),
          p.comment,
        ];
      });
    const head = ["Дата", "Платеж", "Объект", "Оплачено, ₽", "Комментарий"];
    if (type === "csv")
      download(
        new Blob([csv([head, ...rows])], { type: "text/csv;charset=utf-8" }),
        "oplati.csv",
      );
    if (type === "xlsx") {
      download(
        new Blob([new Uint8Array(toXlsx([head, ...rows]))], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        "oplati.xlsx",
      );
    }
    if (type === "pdf") {
      const pdf = new jsPDF();
      const font = await (
        await fetch(import.meta.env.BASE_URL + "DejaVuSans.ttf")
      ).arrayBuffer();
      const bytes = new Uint8Array(font);
      let binary = "";
      for (let i = 0; i < bytes.length; i++)
        binary += String.fromCharCode(bytes[i]);
      pdf.addFileToVFS("DejaVuSans.ttf", btoa(binary));
      pdf.addFont("DejaVuSans.ttf", "DejaVu", "normal");
      pdf.setFont("DejaVu");
      pdf.setFontSize(13);
      pdf.text(`Отчет ${range.from} — ${range.to}`, 14, 18);
      autoTable(pdf, {
        head: [head],
        body: rows.map((r) => r.map(String)),
        startY: 24,
        styles: { font: "DejaVu", fontSize: 8 },
      });
      pdf.save("otchet.pdf");
    }
  }
  if (loading) return <div className="center">Загрузка…</div>;
  if (!session) return <Auth />;
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="mark">₽</span>
          <span>
            Мой финансовый
            <br />
            контроль
          </span>
        </div>
        <nav>
          {nav.map(([key, title, Icon]) => (
            <button
              key={key}
              className={page === key ? "active" : ""}
              onClick={() => setPage(key)}
            >
              <Icon size={19} />
              {title}
            </button>
          ))}
        </nav>
        <div className="side-bottom">
          <div className="avatar">
            {session.user.email?.slice(0, 1).toUpperCase()}
          </div>
          <span>{session.user.email}</span>
        </div>
      </aside>
      <div className="main">
        <header>
          <div>
            <small>ЛИЧНЫЙ ФИНАНСОВЫЙ ПОМОЩНИК</small>
            <h1>{nav.find((n) => n[0] === page)?.[1]}</h1>
          </div>
          <div className="header-actions">
            <label className="search">
              <Search size={17} />
              <input
                placeholder="Поиск платежей"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <button
              className="icon-btn"
              title="Уведомления"
              onClick={() => setPage("calendar")}
            >
              <Bell size={19} />
              {d.reminders.length > 0 && <i />}
            </button>
            <button className="primary add" onClick={() => setForm("payment")}>
              <Plus size={18} />
              Добавить платеж
            </button>
          </div>
        </header>
        {flash && (
          <div className="toast" role="status" onClick={() => setFlash("")}>
            {flash} ×
          </div>
        )}
        {setup && (
          <div className="setup">
            <div>
              <strong>Начните с регулярных обязательств</strong>
              <p>
                Пять объектов и три карточки сотрудников уже созданы. Укажите
                аренду, коммунальные услуги, зарплаты и налоги; суммы и сроки
                вводите сами.
              </p>
            </div>
            <div className="row">
              <button
                onClick={() => {
                  setPage("payments");
                  setForm("payment");
                }}
              >
                Добавить аренду
              </button>
              <button onClick={() => setPage("employees")}>
                Настроить зарплату
              </button>
              <button onClick={() => setPage("taxes")}>Добавить налог</button>
              <button
                className="ghost"
                onClick={() =>
                  run(async () => {
                    await supabase
                      .from("profiles")
                      .update({ setup_done: true })
                      .eq("id", session.user.id);
                    setSetup(false);
                  })
                }
              >
                Готово
              </button>
            </div>
          </div>
        )}
        {(page === "dashboard" || page === "analytics") && (
          <div className="period">
            <button
              className={period === "today" ? "selected" : ""}
              onClick={() => setPeriod("today")}
            >
              Сегодня
            </button>
            <button
              className={period === "current" ? "selected" : ""}
              onClick={() => setPeriod("current")}
            >
              Этот месяц
            </button>
            <button
              className={period === "previous" ? "selected" : ""}
              onClick={() => setPeriod("previous")}
            >
              Прошлый месяц
            </button>
            <button
              className={period === "custom" ? "selected" : ""}
              onClick={() => setPeriod("custom")}
            >
              Свой период
            </button>
            {period === "custom" && (
              <>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                />
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                />
              </>
            )}
          </div>
        )}
        {page === "dashboard" && (
          <>
            <section className="panel">
              <div className="section-head">
                <h2>Сегодня, {dateRU(day)}</h2>
                <strong>К оплате: {money(dueTotal)}</strong>
              </div>
              {daily.due.length ? (
                <Rows items={daily.due} d={d} select={setSelected} />
              ) : (
                <p className="muted">
                  На сегодня неоплаченных обязательств нет.
                </p>
              )}
              {daily.overdue.length > 0 && (
                <details className="box">
                  <summary>
                    Просроченные обязательства: {daily.overdue.length} ·{" "}
                    {money(
                      daily.overdue
                        .filter((o) => o.kind !== "report")
                        .reduce((sum, o) => sum + remaining(o, d.payments), 0),
                    )}
                  </summary>
                  <Rows items={daily.overdue} d={d} select={setSelected} />
                </details>
              )}
            </section>
            <div className="cards">
              <Stat
                label="Оплачено за период"
                value={money(m.actual)}
                accent="green"
              />
              <Stat
                label="Осталось оплатить"
                value={money(m.outstanding)}
                accent="blue"
              />
              <Stat
                label="Просрочено"
                value={money(m.overdue)}
                subtitle={`${m.overdueCount} обязательств`}
                accent="red"
              />
              <Stat
                label="Ближайшие 7 дней"
                value={String(m.upcoming)}
                subtitle="обязательств"
                accent="orange"
              />
              <Stat
                label="План расходов"
                value={money(m.plan)}
                accent="violet"
              />
            </div>
            <div className="grid-two">
              <section className="panel">
                <h2>
                  Календарь платежей{" "}
                  <button className="link" onClick={() => setPage("calendar")}>
                    Открыть →
                  </button>
                </h2>
                <MiniCalendar
                  items={d.obligations}
                  payments={d.payments}
                  onSelect={setSelected}
                />
              </section>
              <section className="panel">
                <h2>Ближайшие обязательства</h2>
                <Rows
                  items={items
                    .filter(
                      (o) =>
                        o.due_date >= today() &&
                        o.due_date <= plusDays(today(), 30) &&
                        state(o, d.payments) !== "done",
                    )
                    .slice(0, 7)}
                  d={d}
                  select={setSelected}
                />
              </section>
            </div>
            <div className="grid-two">
              <section className="panel">
                <h2>Последние оплаты</h2>
                {d.payments
                  .slice()
                  .sort((a, b) => b.paid_on.localeCompare(a.paid_on))
                  .slice(0, 5)
                  .map((p) => (
                    <div className="list-row" key={p.id}>
                      <span>
                        <b>
                          {d.obligations.find((o) => o.id === p.obligation_id)
                            ?.title || "Платеж"}
                        </b>
                        <small>{dateRU(p.paid_on)}</small>
                      </span>
                      <strong>{money(p.amount)}</strong>
                    </div>
                  ))}
                {!d.payments.length && <Empty />}
              </section>
              <section className="panel">
                <h2>Расходы за 12 месяцев</h2>
                <ExpenseChart d={d} />
              </section>
            </div>
          </>
        )}
        {page === "calendar" && (
          <CalendarPage items={items} d={d} select={setSelected} />
        )}
        {page === "payments" && (
          <section className="panel">
            <div className="section-head">
              <h2>Обязательства</h2>
              <button
                className="secondary"
                onClick={() => document.getElementById("import-file")?.click()}
              >
                <Upload size={16} /> Импорт Excel/CSV
              </button>
              <input
                id="import-file"
                type="file"
                hidden
                accept=".xlsx,.csv"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  await run(async () => {
                    const raw = f.name.toLowerCase().endsWith(".csv")
                      ? parseCsv(await f.text())
                      : parseXlsx(new Uint8Array(await f.arrayBuffer()));
                    const rows = rowsToObjects(raw);
                    const seen = new Set(
                      d.templates.map(
                        (t) =>
                          `${t.title}|${t.start_date}|${t.object_id || ""}|${t.planned_amount}`,
                      ),
                    );
                    for (const r of rows) {
                      const title = String(r["Название"] || "").trim(),
                        due = String(r["Дата"] || "");
                      if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(due)) continue;
                      const obj = d.objects.find((o) => o.name === r["Объект"]);
                      const key = `${title}|${due}|${obj?.id || ""}|${amount(String(r["Сумма"] || 0))}`;
                      if (seen.has(key)) continue;
                      seen.add(key);
                      const { error } = await supabase
                        .from("templates")
                        .insert({
                          user_id: session.user.id,
                          title,
                          kind: "payment",
                          object_id: obj?.id || null,
                          planned_amount: amount(String(r["Сумма"] || 0)),
                          start_date: due,
                          recurrence: "once",
                        });
                      if (error) throw error;
                    }
                    await supabase.rpc("generate_occurrences", {
                      p_user: session.user.id,
                    });
                    await reload();
                  }, "Импорт завершен");
                  e.target.value = "";
                }}
              />
            </div>
            <details className="box">
              <summary>Корзина ({deleted.length})</summary>
              <p className="muted">
                Удалённые обязательства и их оплаты исключены из расчётов.
                Восстановление возвращает запись и оплаты; повторение серии
                автоматически не включается.
              </p>
              {deleted.map((o) => (
                <div className="list-row" key={o.id}>
                  <span>
                    {o.title}
                    <small>
                      {dateRU(o.due_date)} · {money(o.planned_amount)}
                    </small>
                  </span>
                  <button
                    className="secondary"
                    onClick={() =>
                      run(async () => {
                        const { error } = await supabase.rpc(
                          "restore_obligation",
                          { p_id: o.id },
                        );
                        if (error) throw error;
                        await reload();
                      }, "Обязательство восстановлено")
                    }
                  >
                    Восстановить
                  </button>
                </div>
              ))}
            </details>
            <Filters d={d} object={filterObject} setObject={setFilterObject} />
            <Rows
              items={items.filter(
                (o) => o.kind === "payment" || o.kind === "salary",
              )}
              d={d}
              select={setSelected}
              extended
            />
          </section>
        )}
        {page === "taxes" && (
          <section className="panel">
            <div className="section-head">
              <div>
                <h2>Налоги и отчетность</h2>
                <p className="muted">
                  Сроки и суммы вводятся вручную. Приложение не рассчитывает
                  налоги.
                </p>
              </div>
              <div className="row">
                <button className="secondary" onClick={() => setForm("tax")}>
                  + Налог
                </button>
                <button className="primary" onClick={() => setForm("report")}>
                  + Отчет
                </button>
              </div>
            </div>
            <Rows
              items={items.filter(
                (o) => o.kind === "tax" || o.kind === "report",
              )}
              d={d}
              select={setSelected}
              extended
            />
          </section>
        )}
        {page === "employees" && (
          <Employees
            d={d}
            run={run}
            reload={reload}
            uid={session.user.id}
            mutate={mutate}
            select={setSelected}
          />
        )}
        {page === "objects" && (
          <Objects d={d} run={run} mutate={mutate} reload={reload} />
        )}
        {page === "analytics" && (
          <Analytics
            d={d}
            from={range.from}
            to={range.to}
            exportTable={exportTable}
          />
        )}
        {page === "settings" && (
          <SettingsPage
            d={d}
            uid={session.user.id}
            theme={theme}
            setTheme={setTheme}
            run={run}
            exportIcs={exportIcs}
          />
        )}
      </div>
      <div className="bottom-nav">
        {nav.slice(0, 6).map(([key, title, Icon]) => (
          <button
            key={key}
            className={page === key ? "active" : ""}
            onClick={() => setPage(key)}
          >
            <Icon size={20} />
            <span>{title.split(" ")[0]}</span>
          </button>
        ))}
      </div>
      {form && (
        <ObligationForm
          kind={form}
          d={d}
          close={() => setForm(null)}
          save={async (payload) => {
            let okay = false;
            await run(async () => {
              const { error } = await supabase
                .from("templates")
                .insert({ ...payload, user_id: session.user.id });
              if (error) throw error;
              const generated = await supabase.rpc("generate_occurrences", {
                p_user: session.user.id,
              });
              if (generated.error) throw generated.error;
              await reload();
              okay = true;
            }, "Обязательство добавлено");
            if (okay) setForm(null);
          }}
        />
      )}
      {selected && (
        <Detail
          o={d.obligations.find((x) => x.id === selected.id) || selected}
          d={d}
          close={() => setSelected(null)}
          run={run}
          reload={reload}
          uid={session.user.id}
        />
      )}
    </div>
  );
}
function Stat({
  label,
  value,
  subtitle,
  accent,
}: {
  label: string;
  value: string;
  subtitle?: string;
  accent: string;
}) {
  return (
    <div className={`stat ${accent}`}>
      <small>{label}</small>
      <strong>{value}</strong>
      <span>{subtitle || " "}</span>
    </div>
  );
}
function Empty() {
  return (
    <div className="empty">
      Пока записей нет. Добавьте первое обязательство.
    </div>
  );
}
function Filters({
  d,
  object,
  setObject,
}: {
  d: Data;
  object: string;
  setObject: (s: string) => void;
}) {
  return (
    <select value={object} onChange={(e) => setObject(e.target.value)}>
      <option value="">Все объекты</option>
      {d.objects
        .filter((o) => !o.archived)
        .map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
    </select>
  );
}
function Rows({
  items,
  d,
  select,
  extended = false,
}: {
  items: Obligation[];
  d: Data;
  select: (o: Obligation) => void;
  extended?: boolean;
}) {
  return items.length ? (
    <div className="rows">
      {items.map((o) => (
        <button className="item" key={o.id} onClick={() => select(o)}>
          <span className={`dot ${state(o, d.payments)}`} />
          <span className="item-main">
            <b>{o.title}</b>
            <small>
              {d.objects.find((x) => x.id === o.object_id)?.name ||
                "Общие расходы бизнеса"}{" "}
              · {dateRU(o.due_date)}
            </small>
          </span>
          <span className="item-end">
            <b>
              {o.kind === "report" ? "Отчет" : money(remaining(o, d.payments))}
            </b>
            <small className={`badge ${state(o, d.payments)}`}>
              {labels[state(o, d.payments)]}
            </small>
          </span>
          {extended && <ChevronRight size={16} />}
        </button>
      ))}
    </div>
  ) : (
    <Empty />
  );
}
function MiniCalendar({
  items,
  payments,
  onSelect,
}: {
  items: Obligation[];
  payments: Data["payments"];
  onSelect: (o: Obligation) => void;
}) {
  const [month, setMonth] = useState(today().slice(0, 7));
  const start = new Date(
      Number(month.slice(0, 4)),
      Number(month.slice(5, 7)) - 1,
      1,
    ),
    days = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate(),
    offset = (start.getDay() + 6) % 7;
  function move(n: number) {
    setMonth(
      iso(new Date(start.getFullYear(), start.getMonth() + n, 1)).slice(0, 7),
    );
  }
  return (
    <>
      <div className="cal-head">
        <button onClick={() => move(-1)}>
          <ChevronLeft size={18} />
        </button>
        <b>
          {start.toLocaleDateString("ru-RU", {
            month: "long",
            year: "numeric",
          })}
        </b>
        <button onClick={() => move(1)}>
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="mini-grid">
        {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((x) => (
          <small key={x}>{x}</small>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <span key={"o" + i} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const s = `${month}-${String(i + 1).padStart(2, "0")}`,
            ev = items.filter((o) => o.due_date === s);
          return (
            <button
              key={s}
              className={s === today() ? "today" : ""}
              onClick={() => ev[0] && onSelect(ev[0])}
              title={ev.map((o) => o.title).join(", ")}
            >
              {i + 1}
              <span className="dots">
                {ev.slice(0, 3).map((o) => (
                  <i key={o.id} className={state(o, payments)} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}
function ExpenseChart({ d }: { d: Data }) {
  const now = new Date(),
    data = Array.from({ length: 12 }, (_, i) => {
      const dt = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1),
        key = iso(dt).slice(0, 7);
      return {
        name: dt.toLocaleDateString("ru-RU", { month: "short" }),
        sum: d.payments
          .filter((p) => p.paid_on.startsWith(key))
          .reduce((a, p) => a + Number(p.amount), 0),
      };
    });
  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid vertical={false} stroke="#e9edf3" />
          <XAxis dataKey="name" tickLine={false} axisLine={false} />
          <YAxis tickLine={false} axisLine={false} width={42} />
          <Tooltip formatter={(v) => money(Number(v))} />
          <Bar dataKey="sum" fill="#3d68dc" radius={[5, 5, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
function ObligationForm({
  kind,
  d,
  close,
  save,
}: {
  kind: Kind;
  d: Data;
  close: () => void;
  save: (p: object) => Promise<void>;
}) {
  const [title, setTitle] = useState(""),
    [object, setObject] = useState(""),
    [category, setCategory] = useState(""),
    [planned, setPlanned] = useState(""),
    [due, setDue] = useState(today()),
    [recurrence, setRecurrence] = useState("once"),
    [days, setDays] = useState("5, 20"),
    [custom, setCustom] = useState(""),
    [reminders, setReminders] = useState("7,3,1,0,-1"),
    [method, setMethod] = useState(""),
    [notes, setNotes] = useState(""),
    [period, setPeriod] = useState(""),
    [busy, setBusy] = useState(false);
  const scope = d.objects.find((o) => o.id === object)?.kind || "business";
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await save({
        title,
        kind,
        object_id: object || null,
        category_id: category || null,
        planned_amount: kind === "report" ? 0 : amount(planned),
        start_date: due,
        recurrence,
        days:
          recurrence === "twice_monthly"
            ? days
                .split(",")
                .map(Number)
                .filter((x) => x >= 1 && x <= 31)
            : [],
        custom_dates:
          recurrence === "custom"
            ? custom
                .split(",")
                .map((s) => s.trim())
                .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s))
            : [],
        payment_method: method,
        notes,
        period_label: period,
        reminder_days: reminders
          .split(",")
          .map(Number)
          .filter(Number.isInteger),
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        kind === "report"
          ? "Новый отчет"
          : kind === "tax"
            ? "Налоговый платеж"
            : "Новый платеж"
      }
      close={close}
    >
      <form className="form" onSubmit={submit}>
        <label>
          Название
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={
              kind === "report" ? "Например, РСВ" : "Например, аренда"
            }
          />
        </label>
        <div className="form-grid">
          <label>
            Объект
            <select
              value={object}
              onChange={(e) => {
                setObject(e.target.value);
                setCategory("");
              }}
            >
              <option value="">Общие расходы бизнеса</option>
              {d.objects
                .filter((o) => !o.archived)
                .map((o) => (
                  <option value={o.id} key={o.id}>
                    {o.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Категория
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">Без категории</option>
              {d.categories
                .filter((c) => c.scope === scope)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <div className="form-grid">
          {kind !== "report" && (
            <label>
              Плановая сумма, ₽
              <input
                type="number"
                min="0"
                step="0.01"
                value={planned}
                onChange={(e) => setPlanned(e.target.value)}
                required
              />
            </label>
          )}
          <label>
            Крайний срок
            <input
              type="date"
              required
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </label>
        </div>
        <div className="form-grid">
          <label>
            Периодичность
            <select
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value)}
            >
              {[
                ["once", "Разово"],
                ["weekly", "Еженедельно"],
                ["monthly", "Ежемесячно"],
                ["bimonthly", "Каждые 2 месяца"],
                ["quarterly", "Ежеквартально"],
                ["semiannual", "Каждые полгода"],
                ["yearly", "Ежегодно"],
                ["twice_monthly", "Дважды в месяц"],
                ["custom", "Произвольные даты"],
              ].map(([v, l]) => (
                <option value={v} key={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          {recurrence === "twice_monthly" && (
            <label>
              Дни месяца через запятую
              <input
                value={days}
                onChange={(e) => setDays(e.target.value)}
                placeholder="5, 20"
              />
            </label>
          )}
          {recurrence === "custom" && (
            <label>
              Даты ГГГГ-ММ-ДД через запятую
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="2026-11-05, 2026-12-05"
              />
            </label>
          )}
        </div>
        {kind === "report" && (
          <label>
            Отчетный период
            <input
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              placeholder="III квартал 2026"
            />
          </label>
        )}
        <div className="form-grid">
          <label>
            Напоминания: дней до срока (−1 = после)
            <input
              value={reminders}
              onChange={(e) => setReminders(e.target.value)}
            />
          </label>
          <label>
            Способ оплаты
            <input
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              placeholder="Банк, карта, наличные"
            />
          </label>
        </div>
        <label>
          Комментарий
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="actions">
          <button type="button" className="secondary" onClick={close}>
            Отмена
          </button>
          <button className="primary" disabled={busy}>
            Создать
          </button>
        </div>
      </form>
    </Modal>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button onClick={close} aria-label="Закрыть">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Detail({
  o,
  d,
  close,
  run,
  reload,
  uid,
}: {
  o: Obligation;
  d: Data;
  close: () => void;
  run: (f: () => Promise<unknown>, s?: string) => Promise<void>;
  reload: () => Promise<void>;
  uid: string;
}) {
  const paymentRequest = useRef(crypto.randomUUID()),
    [payBusy, setPayBusy] = useState(false),
    [payAmount, setPayAmount] = useState(String(remaining(o, d.payments))),
    [payDate, setPayDate] = useState(today()),
    [comment, setComment] = useState(""),
    [due, setDue] = useState(o.due_date),
    [plan, setPlan] = useState(String(o.planned_amount)),
    [reminders, setReminders] = useState(o.reminder_days.join(",")),
    [file, setFile] = useState<File | null>(null);
  const ps = d.payments.filter((p) => p.obligation_id === o.id);
  async function update(body: object) {
    await run(async () => {
      const { error } = await supabase
        .from("obligations")
        .update(body)
        .eq("id", o.id);
      if (error) throw error;
      await reload();
    });
    close();
  }
  return (
    <Modal title={o.title} close={close}>
      <div className="detail">
        <p className="muted">
          {d.objects.find((x) => x.id === o.object_id)?.name ||
            "Общие расходы бизнеса"}{" "}
          · {o.period_label || "Обязательство"}
        </p>
        <div className="detail-summary">
          <span>
            Срок <b>{dateRU(o.due_date)}</b>
          </span>
          <span>
            План <b>{money(o.planned_amount)}</b>
          </span>
          <span>
            Оплачено <b>{money(paid(o, d.payments))}</b>
          </span>
          <span>
            Остаток <b>{money(remaining(o, d.payments))}</b>
          </span>
        </div>
        <p>
          <span className={`badge ${state(o, d.payments)}`}>
            {labels[state(o, d.payments)]}
          </span>{" "}
          {o.notes}
        </p>
        {o.kind === "report" ? (
          <div className="row">
            {(["planned", "prepared", "sent", "accepted"] as const).map((s) => (
              <button
                key={s}
                className={o.status === s ? "primary" : "secondary"}
                onClick={() => update({ status: s })}
              >
                {s === "planned" ? "Не подготовлено" : labels[s]}
              </button>
            ))}
          </div>
        ) : (
          o.status !== "cancelled" &&
          remaining(o, d.payments) > 0 && (
            <div className="box">
              <h3>Внести оплату</h3>
              <div className="form-grid">
                <label>
                  Сумма, ₽
                  <input
                    type="number"
                    min="0.01"
                    max={remaining(o, d.payments)}
                    step="0.01"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                  />
                </label>
                <label>
                  Дата оплаты
                  <input
                    type="date"
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                  />
                </label>
              </div>
              <label>
                Комментарий
                <input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              </label>
              <button
                className="primary"
                disabled={payBusy}
                onClick={async () => {
                  if (payBusy) return;
                  setPayBusy(true);
                  await run(async () => {
                    const { error } = await supabase.rpc(
                      "record_payment_once",
                      {
                        p_obligation: o.id,
                        p_amount: amount(payAmount),
                        p_date: payDate,
                        p_comment: comment,
                        p_request: paymentRequest.current,
                      },
                    );
                    if (error) throw error;
                    await reload();
                    close();
                  }, "Оплата внесена");
                  setPayBusy(false);
                }}
              >
                <Check size={17} /> Оплачено / частичная оплата
              </button>
            </div>
          )
        )}
        {ps.length > 0 && (
          <div>
            <h3>История оплат</h3>
            {ps.map((p) => (
              <div className="list-row" key={p.id}>
                <span>
                  {dateRU(p.paid_on)} {p.comment}
                </span>
                <b>{money(p.amount)}</b>
                <button
                  className="danger"
                  title="Отменить ошибочную запись (сохранится в журнале изменений)"
                  onClick={() => {
                    if (
                      confirm(
                        `Отменить оплату ${money(p.amount)} от ${dateRU(p.paid_on)}?`,
                      )
                    )
                      run(async () => {
                        const { error } = await supabase.rpc("void_payment", {
                          p_payment: p.id,
                        });
                        if (error) throw error;
                        await reload();
                      }, "Оплата отменена, запись сохранена в журнале");
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="box">
          <h3>Изменить обязательство</h3>
          <div className="form-grid">
            <label>
              Новая дата
              <input
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </label>
            <label>
              Плановая сумма, ₽
              <input
                type="number"
                step="0.01"
                min={paid(o, d.payments)}
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
              />
            </label>
          </div>
          <label>
            Напоминания (дней до срока)
            <input
              value={reminders}
              onChange={(e) => setReminders(e.target.value)}
            />
          </label>
          <button
            className="secondary"
            onClick={() =>
              update({
                due_date: due,
                planned_amount: amount(plan),
                reminder_days: reminders
                  .split(",")
                  .map(Number)
                  .filter(Number.isInteger),
              })
            }
          >
            Сохранить изменения
          </button>
        </div>
        <div className="box">
          <h3>Квитанция</h3>
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <button
            className="secondary"
            disabled={!file}
            onClick={() =>
              run(async () => {
                if (!file) return;
                const path = `${uid}/${o.id}/${crypto.randomUUID()}-${file.name}`;
                const up = await supabase.storage
                  .from("receipts")
                  .upload(path, file);
                if (up.error) throw up.error;
                const meta = await supabase.from("receipts").insert({
                  user_id: uid,
                  obligation_id: o.id,
                  storage_path: path,
                  filename: file.name,
                });
                if (meta.error) throw meta.error;
              }, "Квитанция загружена")
            }
          >
            Прикрепить
          </button>
          <ReceiptList id={o.id} />
        </div>
        <div className="box">
          <h3>Удаление ошибочной записи</h3>
          <p className="muted">
            Запись попадёт в корзину. Её оплаты исчезнут из статистики, а
            история и квитанции сохранятся для восстановления.
          </p>
          <div className="actions">
            <button
              className="danger"
              onClick={() => {
                if (
                  !confirm(
                    `Удалить «${o.title}» на ${dateRU(o.due_date)}? Остальные повторения останутся. Запись можно восстановить в разделе «Платежи → Корзина».`,
                  )
                )
                  return;
                run(async () => {
                  const { error } = await supabase.rpc("trash_obligation", {
                    p_id: o.id,
                    p_series: false,
                  });
                  if (error) throw error;
                  await reload();
                  close();
                }, "Платёж перемещён в корзину");
              }}
            >
              <Trash2 size={16} /> Удалить этот платёж
            </button>
            {o.template_id && (
              <button
                className="danger"
                onClick={() => {
                  if (
                    !confirm(
                      `Удалить всю серию «${o.title}», включая оплаченные экземпляры, и остановить повторение? Оплаты серии будут исключены из статистики. Записи сохранятся в корзине.`,
                    )
                  )
                    return;
                  run(async () => {
                    const { error } = await supabase.rpc("trash_obligation", {
                      p_id: o.id,
                      p_series: true,
                    });
                    if (error) throw error;
                    await reload();
                    close();
                  }, "Серия перемещена в корзину, повторение остановлено");
                }}
              >
                Удалить всю серию
              </button>
            )}
          </div>
        </div>
        <div className="actions">
          <button
            className="secondary"
            onClick={() =>
              update({
                status: o.status === "cancelled" ? "planned" : "cancelled",
              })
            }
          >
            {o.status === "cancelled" ? "Восстановить" : "Отменить"}
          </button>
          {o.template_id && (
            <button
              className="secondary"
              onClick={() =>
                run(async () => {
                  const { error } = await supabase
                    .from("templates")
                    .update({ active: false })
                    .eq("id", o.template_id);
                  if (error) throw error;
                  await reload();
                }, "Повторение остановлено")
              }
            >
              Остановить повторение
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
function ReceiptList({ id }: { id: string }) {
  const [files, setFiles] = useState<
    { id: string; filename: string; storage_path: string }[]
  >([]);
  useEffect(() => {
    supabase
      .from("receipts")
      .select("id,filename,storage_path")
      .eq("obligation_id", id)
      .then(({ data }) => setFiles(data || []));
  }, [id]);
  return (
    <div>
      {files.map((f) => (
        <button
          className="link"
          key={f.id}
          onClick={async () => {
            const { data } = await supabase.storage
              .from("receipts")
              .createSignedUrl(f.storage_path, 60);
            if (data)
              window.open(data.signedUrl, "_blank", "noopener,noreferrer");
          }}
        >
          {f.filename} ↗
        </button>
      ))}
    </div>
  );
}
function CalendarPage({
  items,
  d,
  select,
}: {
  items: Obligation[];
  d: Data;
  select: (o: Obligation) => void;
}) {
  const [view, setView] = useState<"month" | "week" | "day" | "list">("month"),
    [cursor, setCursor] = useState(today()),
    [cat, setCat] = useState(""),
    [status, setStatus] = useState(""),
    [employee, setEmployee] = useState("");
  const filtered = items.filter(
    (o) =>
      (!cat || o.category_id === cat) &&
      (!status || state(o, d.payments) === status) &&
      (!employee || o.employee_id === employee),
  );
  const step = view === "day" ? 1 : view === "week" ? 7 : 30;
  const start =
    view === "day"
      ? cursor
      : view === "week"
        ? plusDays(cursor, -(new Date(`${cursor}T12:00:00`).getDay() + 6) % 7)
        : cursor.slice(0, 7) + "-01";
  const end =
    view === "day"
      ? cursor
      : view === "week"
        ? plusDays(start, 6)
        : monthRange(cursor).to;
  return (
    <section className="panel">
      <div className="section-head">
        <h2>Все обязательства</h2>
        <div className="row">
          <button onClick={() => setCursor(plusDays(cursor, -step))}>
            <ChevronLeft size={18} />
          </button>
          <b>{dateRU(cursor)}</b>
          <button onClick={() => setCursor(plusDays(cursor, step))}>
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <div className="filters">
        <select
          value={view}
          onChange={(e) => setView(e.target.value as typeof view)}
        >
          <option value="month">Месяц</option>
          <option value="week">Неделя</option>
          <option value="day">День</option>
          <option value="list">Список</option>
        </select>
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">Все категории</option>
          {d.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.scope})
            </option>
          ))}
        </select>
        <select value={employee} onChange={(e) => setEmployee(e.target.value)}>
          <option value="">Все сотрудники</option>
          {d.employees.map((x) => (
            <option key={x.id} value={x.id}>
              {x.full_name}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Все статусы</option>
          {Object.entries(labels).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      {view === "month" ? (
        <FullCalendar
          month={cursor.slice(0, 7)}
          items={filtered}
          payments={d.payments}
          onSelect={select}
        />
      ) : (
        <Rows
          items={
            view === "list"
              ? filtered
              : filtered.filter((o) => o.due_date >= start && o.due_date <= end)
          }
          d={d}
          select={select}
          extended
        />
      )}
    </section>
  );
}
function FullCalendar({
  month,
  items,
  payments,
  onSelect,
}: {
  month: string;
  items: Obligation[];
  payments: Data["payments"];
  onSelect: (o: Obligation) => void;
}) {
  const first = new Date(
      Number(month.slice(0, 4)),
      Number(month.slice(5, 7)) - 1,
      1,
    ),
    offset = (first.getDay() + 6) % 7,
    count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return (
    <div className="full-calendar">
      {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => (
        <b key={day}>{day}</b>
      ))}
      {Array.from({ length: offset }, (_, i) => (
        <div key={"pad" + i} className="calendar-day blank" />
      ))}
      {Array.from({ length: count }, (_, i) => {
        const date = `${month}-${String(i + 1).padStart(2, "0")}`;
        return (
          <div
            className={`calendar-day ${date === today() ? "current" : ""}`}
            key={date}
          >
            <small>{i + 1}</small>
            {items
              .filter((o) => o.due_date === date)
              .map((o) => (
                <button
                  title={`${o.title} — ${money(o.planned_amount)}`}
                  className={`calendar-event ${state(o, payments)}`}
                  key={o.id}
                  onClick={() => onSelect(o)}
                >
                  {o.title}
                </button>
              ))}
          </div>
        );
      })}
    </div>
  );
}
function Employees({
  d,
  run,
  reload,
  uid,
  mutate,
  select,
}: {
  d: Data;
  run: (f: () => Promise<unknown>, s?: string) => Promise<void>;
  reload: () => Promise<void>;
  uid: string;
  mutate: (t: string, b: object, id?: string) => Promise<void>;
  select: (o: Obligation) => void;
}) {
  const [editing, setEditing] = useState<Employee | null>(null),
    [name, setName] = useState(""),
    [position, setPosition] = useState(""),
    [object, setObject] = useState(""),
    [salary, setSalary] = useState("0"),
    [advance, setAdvance] = useState("0"),
    [day1, setDay1] = useState(""),
    [day2, setDay2] = useState("");
  function edit(x?: Employee) {
    setEditing(
      x || {
        id: "",
        full_name: "",
        position: "",
        object_id: null,
        salary: 0,
        advance: 0,
        day_advance: null,
        day_final: null,
        active: true,
      },
    );
    setName(x?.full_name || "");
    setPosition(x?.position || "");
    setObject(x?.object_id || "");
    setSalary(String(x?.salary || 0));
    setAdvance(String(x?.advance || 0));
    setDay1(x?.day_advance ? String(x.day_advance) : "");
    setDay2(x?.day_final ? String(x.day_final) : "");
  }
  async function save() {
    if (amount(advance) > amount(salary))
      throw Error("Аванс не может превышать зарплату");
    if (amount(salary) > 0 && (!day1 || !day2))
      throw Error("Укажите оба дня выплаты зарплаты");
    const payload = {
      full_name: name,
      position,
      object_id: object || null,
      salary: amount(salary),
      advance: amount(advance),
      day_advance: day1 ? Number(day1) : null,
      day_final: day2 ? Number(day2) : null,
    };
    let id = editing?.id || "";
    if (id) await mutate("employees", payload, id);
    else {
      const { data, error } = await supabase
        .from("employees")
        .insert({ ...payload, user_id: uid })
        .select("id")
        .single();
      if (error) throw error;
      id = data.id;
    }
    if (id) {
      const old = d.templates.filter((t) => t.employee_id === id && t.active);
      for (const t of old) {
        const { error } = await supabase
          .from("templates")
          .update({ active: false })
          .eq("id", t.id);
        if (error) throw error;
        const { error: cancelError } = await supabase
          .from("obligations")
          .update({ status: "cancelled" })
          .eq("template_id", t.id)
          .gte("due_date", today())
          .eq("status", "planned");
        if (cancelError) throw cancelError;
      }
      if (amount(salary) > 0) {
        for (const [stage, day, sum] of [
          ["Аванс", Number(day1), amount(advance)],
          [
            "Окончательный расчет",
            Number(day2),
            amount(salary) - amount(advance),
          ],
        ] as const) {
          if (sum <= 0) continue;
          const first = iso(
            new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          );
          const { error } = await supabase.from("templates").insert({
            user_id: uid,
            title: `${stage}: ${name}`,
            kind: "salary",
            employee_id: id,
            object_id: object || null,
            planned_amount: sum,
            start_date: first,
            recurrence: "twice_monthly",
            days: [day],
            reminder_days: [3, 1, 0, -1],
          });
          if (error) throw error;
        }
        await supabase.rpc("generate_occurrences", { p_user: uid });
      }
    }
    await reload();
    setEditing(null);
  }
  const salaryPaid = d.payments.filter((p) =>
    d.obligations.some((o) => o.id === p.obligation_id && o.kind === "salary"),
  );
  return (
    <>
      <div className="cards two">
        <Stat
          label="Выплачено в этом месяце"
          value={money(
            salaryPaid
              .filter((p) => p.paid_on.startsWith(today().slice(0, 7)))
              .reduce((a, p) => a + Number(p.amount), 0),
          )}
          accent="green"
        />
        <Stat
          label="Выплачено в этом году"
          value={money(
            salaryPaid
              .filter((p) => p.paid_on.startsWith(today().slice(0, 4)))
              .reduce((a, p) => a + Number(p.amount), 0),
          )}
          accent="blue"
        />
      </div>
      <section className="panel">
        <div className="section-head">
          <h2>Сотрудники</h2>
          <button className="primary" onClick={() => edit()}>
            + Добавить
          </button>
        </div>
        <div className="employee-grid">
          {d.employees.map((x) => (
            <div className="employee-card" key={x.id}>
              <div className="avatar">{x.full_name[0]}</div>
              <h3>{x.full_name}</h3>
              <p>
                {x.position || "Укажите должность"} ·{" "}
                {d.objects.find((o) => o.id === x.object_id)?.name ||
                  "Точка не выбрана"}
              </p>
              <strong>{money(x.salary)} / мес.</strong>
              <small>
                {x.day_advance && x.day_final
                  ? `Аванс: ${x.day_advance} числа · расчет: ${x.day_final} числа`
                  : "Дни выплат не указаны"}
              </small>
              <button className="secondary" onClick={() => edit(x)}>
                Настроить
              </button>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>Начисления и переводы</h2>
        <Rows
          items={d.obligations
            .filter((o) => o.kind === "salary")
            .sort((a, b) => b.due_date.localeCompare(a.due_date))
            .slice(0, 40)}
          d={d}
          select={select}
        />
      </section>
      {editing && (
        <Modal
          title="Сотрудник и график зарплаты"
          close={() => setEditing(null)}
        >
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              run(save, "Сотрудник сохранен");
            }}
          >
            <label>
              Фамилия и имя
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Должность
              <input
                value={position}
                onChange={(e) => setPosition(e.target.value)}
              />
            </label>
            <label>
              Торговая точка
              <select
                value={object}
                onChange={(e) => setObject(e.target.value)}
              >
                <option value="">Не выбрана</option>
                {d.objects
                  .filter((o) => o.kind === "shop")
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="form-grid">
              <label>
                Зарплата на руки за месяц
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={salary}
                  onChange={(e) => setSalary(e.target.value)}
                />
              </label>
              <label>
                Аванс
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={advance}
                  onChange={(e) => setAdvance(e.target.value)}
                />
              </label>
              <label>
                День аванса
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={day1}
                  onChange={(e) => setDay1(e.target.value)}
                />
              </label>
              <label>
                День расчета
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={day2}
                  onChange={(e) => setDay2(e.target.value)}
                />
              </label>
            </div>
            <p className="muted">
              Налоги и взносы добавляйте отдельными обязательствами. Новые суммы
              применяются к будущим начислениям.
            </p>
            <button className="primary">Сохранить</button>
          </form>
        </Modal>
      )}
    </>
  );
}
function Objects({
  d,
  run,
  mutate,
  reload,
}: {
  d: Data;
  run: (f: () => Promise<unknown>, s?: string) => Promise<void>;
  mutate: (t: string, b: object, id?: string) => Promise<void>;
  reload: () => Promise<void>;
}) {
  const [name, setName] = useState(""),
    [kind, setKind] = useState<"shop" | "apartment">("shop"),
    [category, setCategory] = useState(""),
    [scope, setScope] = useState<"shop" | "apartment" | "business">("shop");
  return (
    <>
      <section className="panel">
        <h2>Объекты учета</h2>
        <div className="employee-grid">
          {d.objects.map((o) => (
            <div className="employee-card" key={o.id}>
              <small>
                {o.kind === "shop" ? "ТОРГОВАЯ ТОЧКА" : "КВАРТИРА"}{" "}
                {o.archived ? "· АРХИВ" : ""}
              </small>
              <h3>{o.name}</h3>
              <p>
                {d.obligations.filter((x) => x.object_id === o.id).length}{" "}
                обязательств
              </p>
              <div className="row">
                <button
                  className="secondary"
                  onClick={() => {
                    const n = prompt("Название", o.name);
                    if (n && n !== o.name)
                      run(() => mutate("objects", { name: n }, o.id));
                  }}
                >
                  Изменить
                </button>
                <button
                  className="secondary"
                  onClick={() =>
                    run(() =>
                      mutate("objects", { archived: !o.archived }, o.id),
                    )
                  }
                >
                  {o.archived ? "Восстановить" : "Архив"}
                </button>
                <button
                  className="danger"
                  title="Удалить объект"
                  onClick={() => {
                    if (
                      confirm(
                        `Удалить «${o.name}»? Связанные записи потеряют привязку к объекту.`,
                      )
                    )
                      run(async () => {
                        const { error } = await supabase
                          .from("objects")
                          .delete()
                          .eq("id", o.id);
                        if (error) throw error;
                        await reload();
                      });
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await mutate("objects", { name, kind });
              setName("");
            });
          }}
        >
          <input
            placeholder="Новый объект"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <option value="shop">Торговая точка</option>
            <option value="apartment">Квартира</option>
          </select>
          <button className="primary">Добавить</button>
        </form>
      </section>
      <section className="panel">
        <h2>Категории</h2>
        <div className="chips">
          {d.categories.map((c) => (
            <span className="chip" key={c.id}>
              {c.name}{" "}
              <small>
                (
                {
                  {
                    shop: "торговые точки",
                    apartment: "квартиры",
                    business: "бизнес",
                  }[c.scope]
                }
                )
              </small>
              <button
                title="Переименовать"
                onClick={() => {
                  const n = prompt("Название категории", c.name);
                  if (n) run(() => mutate("categories", { name: n }, c.id));
                }}
              >
                ✎
              </button>
              <button
                title="Удалить"
                onClick={() => {
                  if (confirm(`Удалить категорию «${c.name}»?`))
                    run(async () => {
                      const { error } = await supabase
                        .from("categories")
                        .delete()
                        .eq("id", c.id);
                      if (error) throw error;
                      await reload();
                    });
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await mutate("categories", { name: category, scope });
              setCategory("");
            });
          }}
        >
          <input
            placeholder="Новая категория"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            required
          />
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as typeof scope)}
          >
            <option value="shop">Торговые точки</option>
            <option value="apartment">Квартиры</option>
            <option value="business">Бизнес</option>
          </select>
          <button className="primary">Добавить</button>
        </form>
      </section>
    </>
  );
}
function Analytics({
  d,
  from,
  to,
  exportTable,
}: {
  d: Data;
  from: string;
  to: string;
  exportTable: (t: "csv" | "xlsx" | "pdf") => void;
}) {
  const current = metrics(d, from, to),
    prevDate = new Date(`${from}T12:00:00`);
  prevDate.setMonth(prevDate.getMonth() - 1);
  const prev = metrics(
    d,
    ...(Object.values(monthRange(iso(prevDate))) as [string, string]),
  );
  const entries = d.payments
    .filter((p) => p.paid_on >= from && p.paid_on <= to)
    .map((p) => ({
      p,
      o: d.obligations.find((o) => o.id === p.obligation_id),
    }));
  const groups = [
    ...d.objects.map((o) => ({
      name: o.name,
      value: entries
        .filter((e) => e.o?.object_id === o.id)
        .reduce((a, e) => a + Number(e.p.amount), 0),
    })),
    {
      name: "Общие",
      value: entries
        .filter((e) => !e.o?.object_id)
        .reduce((a, e) => a + Number(e.p.amount), 0),
    },
  ].filter((x) => x.value > 0);
  const categories = d.categories
    .map((c) => ({
      name: c.name,
      value: entries
        .filter((e) => e.o?.category_id === c.id)
        .reduce((a, e) => a + Number(e.p.amount), 0),
    }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value);
  const sumKind = (kind: Kind) =>
    entries
      .filter((e) => e.o?.kind === kind)
      .reduce((a, e) => a + Number(e.p.amount), 0);
  const top = d.obligations
    .filter(
      (o) => o.due_date >= from && o.due_date <= to && o.kind !== "report",
    )
    .sort((a, b) => Number(b.planned_amount) - Number(a.planned_amount))
    .slice(0, 8);
  return (
    <>
      <div className="cards">
        <Stat label="Оплачено" value={money(current.actual)} accent="green" />
        <Stat label="Прошлый месяц" value={money(prev.actual)} accent="blue" />
        <Stat
          label="Изменение"
          value={
            prev.actual
              ? `${Math.round((current.actual / prev.actual - 1) * 100)}%`
              : "—"
          }
          accent="violet"
        />
        <Stat
          label="Осталось оплатить"
          value={money(current.outstanding)}
          accent="orange"
        />
        <Stat label="Просрочено" value={money(current.overdue)} accent="red" />
      </div>
      <div className="export row">
        <button className="secondary" onClick={() => exportTable("csv")}>
          CSV
        </button>
        <button className="secondary" onClick={() => exportTable("xlsx")}>
          Excel
        </button>
        <button className="secondary" onClick={() => exportTable("pdf")}>
          PDF
        </button>
      </div>
      <div className="grid-two">
        <section className="panel">
          <h2>Динамика расходов</h2>
          <ExpenseChart d={d} />
        </section>
        <section className="panel">
          <h2>По объектам</h2>
          {groups.length ? (
            <div className="chart">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={groups}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={55}
                    outerRadius={95}
                    label
                  >
                    {groups.map((_, i) => (
                      <Cell
                        key={i}
                        fill={
                          [
                            "#3d68dc",
                            "#24a980",
                            "#f3a43b",
                            "#9d80db",
                            "#e17077",
                            "#8191a8",
                          ][i % 6]
                        }
                      />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => money(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty />
          )}
          <div className="legend">
            {groups.map((x) => (
              <div key={x.name}>
                {x.name}
                <b>{money(x.value)}</b>
              </div>
            ))}
          </div>
        </section>
      </div>
      <div className="grid-two">
        <section className="panel">
          <h2>По категориям</h2>
          <div className="legend">
            {categories.map((x) => (
              <div key={x.name}>
                {x.name}
                <b>{money(x.value)}</b>
              </div>
            ))}
          </div>
          {!categories.length && <Empty />}
        </section>
        <section className="panel">
          <h2>Ключевые статьи</h2>
          <div className="legend">
            <div>
              Зарплата на руки <b>{money(sumKind("salary"))}</b>
            </div>
            <div>
              Налоговые платежи <b>{money(sumKind("tax"))}</b>
            </div>
            <div>
              Коммунальные услуги{" "}
              <b>
                {money(
                  entries
                    .filter((e) =>
                      /электр|вод|газ|коммун|квартплат/i.test(
                        d.categories.find((c) => c.id === e.o?.category_id)
                          ?.name || "",
                      ),
                    )
                    .reduce((a, e) => a + Number(e.p.amount), 0),
                )}
              </b>
            </div>
          </div>
          <h3>Самые затратные обязательства</h3>
          {top.map((o) => (
            <div className="list-row" key={o.id}>
              <span>{o.title}</span>
              <b>{money(o.planned_amount)}</b>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
function SettingsPage({
  d,
  uid,
  theme,
  setTheme,
  run,
  exportIcs,
}: {
  d: Data;
  uid: string;
  theme: string;
  setTheme: (s: string) => void;
  run: (f: () => Promise<unknown>, s?: string) => Promise<void>;
  exportIcs: () => void;
}) {
  const [googleReady, setGoogleReady] = useState<boolean | null>(null),
    [googleError, setGoogleError] = useState(""),
    [calendar, setCalendar] = useState(""),
    [calendars, setCalendars] = useState<{ id: string; summary: string }[]>([]),
    [chat, setChat] = useState(""),
    [tz, setTz] = useState("Europe/Moscow"),
    [emailEnabled, setEmailEnabled] = useState(false),
    [telegramEnabled, setTelegramEnabled] = useState(false),
    [taxRegime, setTaxRegime] = useState(""),
    [hasEmployees, setHasEmployees] = useState(true);
  useEffect(() => {
    supabase
      .from("profiles")
      .select("timezone")
      .eq("id", uid)
      .single()
      .then(
        ({ data }) =>
          data &&
          (setTz(data.timezone),
          localStorage.setItem("finance_timezone", data.timezone)),
      );
    supabase
      .from("user_settings")
      .select("*")
      .eq("user_id", uid)
      .single()
      .then(({ data }) => {
        if (data) {
          setTaxRegime(data.tax_regime);
          setHasEmployees(data.has_employees);
        }
      });
    invoke<{
      configured: boolean;
      calendars: { id: string; summary: string }[];
      calendarId: string;
      emailEnabled: boolean;
      telegramEnabled: boolean;
      telegramChatId: string;
    }>("calendar-sync", { action: "status" })
      .then((x) => {
        setGoogleReady(x.configured);
        setCalendars(x.calendars || []);
        setCalendar(x.calendarId || "");
        setEmailEnabled(x.emailEnabled);
        setTelegramEnabled(x.telegramEnabled);
        setChat(x.telegramChatId || "");
      })
      .catch(() =>
        setGoogleError(
          "Не удалось проверить подключение Google. Проверьте связь или повторите позже.",
        ),
      );
  }, [uid]);
  async function backup() {
    const tables = [
      "profiles",
      "objects",
      "categories",
      "employees",
      "templates",
      "obligations",
      "payments",
      "payroll_accruals",
      "receipts",
      "user_settings",
      "audit_log",
      "reminder_log",
    ];
    const records: Record<string, unknown> = {};
    for (const t of tables) {
      records[t] = await fetchAll(t);
    }
    const files = [];
    for (const receipt of records.receipts as { storage_path: string }[]) {
      const { data, error } = await supabase.storage
        .from("receipts")
        .download(receipt.storage_path);
      if (error) throw error;
      const bytes = new Uint8Array(await data.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i++)
        binary += String.fromCharCode(bytes[i]);
      files.push({
        path: receipt.storage_path,
        type: data.type,
        base64: btoa(binary),
      });
    }
    download(
      new Blob(
        [
          JSON.stringify(
            {
              format: "mfc-1",
              exported_at: new Date().toISOString(),
              records,
              files,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
      "fincontrol-backup.json",
    );
  }
  return (
    <>
      <section className="panel settings">
        <h2>Google Календарь и уведомления</h2>
        <p>
          Каждый платёж появится в выбранном календаре в 09:00 по вашему
          часовому поясу. Неоплаченные обязательства напомнят о себе в день
          срока и заранее по настройке платежа. Изменения и удаления
          синхронизируются после сохранения в приложении.
        </p>
        <p className="muted">
          На телефоне включите уведомления Google Календаря и отображение
          выбранного календаря. Для конфиденциальности используйте личный
          календарь.
        </p>
        {googleReady === false && (
          <p role="alert">
            Для подключения требуется настроить Google OAuth в Supabase. Ключи
            Google ещё не добавлены на сервере.
          </p>
        )}
        {googleError && <p role="alert">{googleError}</p>}
        <div className="row">
          <button
            className="primary"
            onClick={() =>
              run(async () => {
                const x = await invoke<{ url: string }>("google-oauth", {
                  action: "start",
                });
                location.href = x.url;
              })
            }
          >
            Подключить Google Календарь
          </button>
          <button className="secondary" onClick={exportIcs}>
            <ArrowDownToLine size={17} /> Экспорт .ics
          </button>
        </div>
        <p className="muted">
          Google OAuth откроется на странице авторизации. Секреты и refresh
          токен остаются на сервере.
        </p>
        {calendars.length > 0 && (
          <div className="row">
            <select
              value={calendar}
              onChange={(e) => setCalendar(e.target.value)}
            >
              <option value="">Выберите календарь</option>
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.summary}
                </option>
              ))}
            </select>
            <button
              className="secondary"
              onClick={() =>
                run(async () => {
                  await invoke("calendar-sync", {
                    action: "select",
                    calendarId: calendar,
                  });
                  await invoke("calendar-sync", { action: "sync" });
                }, "Календарь синхронизирован")
              }
            >
              Сохранить и синхронизировать
            </button>
            <button
              className="secondary"
              onClick={() =>
                run(
                  () => invoke("calendar-sync", { action: "sync" }),
                  "Синхронизация завершена",
                )
              }
            >
              Повторить синхронизацию
            </button>
          </div>
        )}
      </section>
      <section className="panel settings">
        <h2>Напоминания</h2>
        <label>
          Часовой пояс
          <input
            value={tz}
            onChange={(e) => setTz(e.target.value)}
            placeholder="Europe/Moscow"
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={emailEnabled}
            onChange={(e) => setEmailEnabled(e.target.checked)}
          />{" "}
          Электронная почта аккаунта
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={telegramEnabled}
            onChange={(e) => setTelegramEnabled(e.target.checked)}
          />{" "}
          Telegram
        </label>
        <label>
          Telegram chat ID
          <input
            value={chat}
            onChange={(e) => setChat(e.target.value)}
            placeholder="Напишите боту /start и узнайте chat ID"
          />
        </label>
        <button
          className="primary"
          onClick={() =>
            run(async () => {
              const { error } = await supabase
                .from("profiles")
                .update({ timezone: tz })
                .eq("id", uid);
              if (error) throw error;
              localStorage.setItem("finance_timezone", tz);
              await invoke("calendar-sync", {
                action: "notifications",
                emailEnabled,
                telegramEnabled,
                telegramChatId: chat,
              });
            })
          }
        >
          Сохранить уведомления
        </button>
        <p className="muted">
          Уведомления внутри приложения появляются в журнале. Почта и Telegram
          требуют настройки серверных секретов и расписания из README.
        </p>
        <h3>Последние уведомления</h3>
        {d.reminders.slice(-6).map((r) => (
          <div className="list-row" key={r.id}>
            <span>
              {d.obligations.find((o) => o.id === r.obligation_id)?.title ||
                "Обязательство"}{" "}
              · {r.channel}
            </span>
            <small>{dateRU(r.scheduled_for)}</small>
          </div>
        ))}
      </section>
      <section className="panel settings">
        <h2>Параметры учета</h2>
        <label>
          Налоговый режим (справочно)
          <input
            value={taxRegime}
            onChange={(e) => setTaxRegime(e.target.value)}
            placeholder="Например, УСН"
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={hasEmployees}
            onChange={(e) => setHasEmployees(e.target.checked)}
          />{" "}
          Есть работники
        </label>
        <button
          className="secondary"
          onClick={() =>
            run(async () => {
              const { error } = await supabase
                .from("user_settings")
                .update({ tax_regime: taxRegime, has_employees: hasEmployees })
                .eq("user_id", uid);
              if (error) throw error;
            })
          }
        >
          Сохранить
        </button>
        <p className="muted">
          Шаблоны отчетов создаются вручную с проверенным сроком; автоматический
          налоговый календарь не включен.
        </p>
        <label>
          Тема
          <select value={theme} onChange={(e) => setTheme(e.target.value)}>
            <option value="light">Светлая</option>
            <option value="dark">Темная</option>
          </select>
        </label>
      </section>
      <section className="panel settings">
        <h2>Данные и безопасность</h2>
        <div className="row">
          <button
            className="secondary"
            onClick={() => run(backup, "Резервная копия скачана")}
          >
            Полный экспорт JSON
          </button>
          <button
            className="danger"
            onClick={() => {
              if (
                confirm(
                  "Безвозвратно удалить все данные и аккаунт? Сначала сохраните резервную копию.",
                )
              )
                run(async () => {
                  await invoke("account-data", { action: "delete" });
                  await supabase.auth.signOut();
                }, "Данные удалены");
            }}
          >
            Удалить аккаунт и данные
          </button>
        </div>
        <p className="muted">
          Экспорт включает квитанции. Для восстановления используйте
          scripts/restore.mjs из README.
        </p>
        <button className="text-btn" onClick={() => supabase.auth.signOut()}>
          Выйти из аккаунта
        </button>
      </section>
    </>
  );
}
