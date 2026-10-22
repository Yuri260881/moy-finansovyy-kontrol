import { json, service, cors } from "../_shared/core.ts";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret)
    return json({ error: "Forbidden" }, 403);
  try {
    let sent = 0;
    const { data: profiles, error: pe } = await service
      .from("profiles")
      .select("id,timezone");
    if (pe) throw pe;
    for (const profile of profiles || []) {
      const generated = await service.rpc("generate_occurrences", {
        p_user: profile.id,
      });
      if (generated.error) throw generated.error;
      const zone = profile.timezone || "Europe/Moscow";
      let today;
      try {
        today = new Intl.DateTimeFormat("en-CA", {
          timeZone: zone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date());
      } catch {
        continue;
      }
      const date = (offset: number) => {
        const d = new Date(today + "T12:00:00Z");
        d.setUTCDate(d.getUTCDate() + offset);
        return d.toISOString().slice(0, 10);
      };
      const { data: items } = await service
        .from("obligations")
        .select("*")
        .eq("user_id", profile.id)
        .neq("status", "cancelled")
        .is("deleted_at", null)
        .gte("due_date", date(-30))
        .lte("due_date", date(90));
      const { data: payments } = await service
        .from("payments")
        .select("obligation_id,amount")
        .eq("user_id", profile.id);
      const { data: conn } = await service
        .from("connections")
        .select("*")
        .eq("user_id", profile.id)
        .single();
      for (const o of items || []) {
        const paid = (payments || [])
          .filter((p: { obligation_id: string }) => p.obligation_id === o.id)
          .reduce(
            (a: number, p: { amount: number }) => a + Number(p.amount),
            0,
          );
        if (
          o.kind === "report"
            ? o.status === "accepted"
            : paid >= Number(o.planned_amount)
        )
          continue;
        const diff = Math.round(
          (new Date(o.due_date + "T12:00:00Z").getTime() -
            new Date(today + "T12:00:00Z").getTime()) /
            86400000,
        );
        const offset = (o.reminder_days || []).find(
          (x: number) => x === diff || (x < 0 && diff < 0 && diff === x),
        );
        if (offset === undefined) continue;
        const prefix =
          diff === 1
            ? "Завтра"
            : diff === 0
              ? "Сегодня"
              : diff < 0
                ? "Просрочено"
                : "Скоро";
        const msg = `${prefix}: ${o.kind === "report" ? "сдать" : "оплатить"} ${o.title}. ${o.kind === "report" ? "" : `Остаток: ${(Number(o.planned_amount) - paid).toFixed(2)} ₽.`} Срок: ${o.due_date}.`;
        const channels = [
          "in_app",
          ...(conn?.email_enabled ? ["email"] : []),
          ...(conn?.telegram_enabled && conn.telegram_chat_id
            ? ["telegram"]
            : []),
        ];
        for (const channel of channels) {
          const { data: prior } = await service
            .from("reminder_log")
            .select("id")
            .eq("obligation_id", o.id)
            .eq("channel", channel)
            .eq("offset_days", offset)
            .eq("scheduled_for", today)
            .maybeSingle();
          if (prior) continue;
          try {
            if (channel === "telegram") {
              const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
              if (!token) throw Error("TELEGRAM_BOT_TOKEN missing");
              const r = await fetch(
                `https://api.telegram.org/bot${token}/sendMessage`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    chat_id: conn.telegram_chat_id,
                    text: msg,
                  }),
                },
              );
              if (!r.ok) throw Error(await r.text());
            }
            if (channel === "email") {
              const key = Deno.env.get("MAIL_PROVIDER_API_KEY"),
                from = Deno.env.get("MAIL_FROM");
              if (!key || !from) throw Error("Mail settings missing");
              const { data: authUser } = await service.auth.admin.getUserById(
                profile.id,
              );
              const r = await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${key}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  from,
                  to: authUser.user?.email,
                  subject: `Финконтроль: ${o.title}`,
                  text: msg,
                }),
              });
              if (!r.ok) throw Error(await r.text());
            }
            const { error } = await service.from("reminder_log").insert({
              user_id: profile.id,
              obligation_id: o.id,
              channel,
              offset_days: offset,
              scheduled_for: today,
            });
            if (error) throw error;
            sent++;
          } catch (e) {
            console.error(
              "Delivery failed",
              profile.id,
              o.id,
              channel,
              String(e),
            );
          }
        }
      }
    }
    return json({ sent });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
