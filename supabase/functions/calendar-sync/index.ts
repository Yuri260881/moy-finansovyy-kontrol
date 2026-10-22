import {
  cors,
  json,
  user,
  service,
  googleToken,
  google,
} from "../_shared/core.ts";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const person = await user(req),
      b = await req.json(),
      uid = person.id;
    const { data: connection, error } = await service
      .from("connections")
      .select("*")
      .eq("user_id", uid)
      .single();
    if (error) throw error;
    if (b.action === "notifications") {
      if (b.telegramChatId && !/^-?\d+$/.test(b.telegramChatId))
        throw Error("Invalid Telegram chat ID");
      const { error } = await service
        .from("connections")
        .update({
          email_enabled: !!b.emailEnabled,
          telegram_enabled: !!b.telegramEnabled,
          telegram_chat_id: b.telegramChatId || null,
        })
        .eq("user_id", uid);
      if (error) throw error;
      return json({ ok: true });
    }
    const configured = !!(
      Deno.env.get("GOOGLE_CLIENT_ID") &&
      Deno.env.get("GOOGLE_CLIENT_SECRET") &&
      Deno.env.get("GOOGLE_REDIRECT_URI") &&
      Deno.env.get("TOKEN_ENCRYPTION_KEY")
    );
    if (
      b.action === "sync-if-connected" &&
      (!connection.google_refresh_token || !connection.google_calendar_id)
    )
      return json({ skipped: true });
    const token = connection.google_refresh_token
      ? await googleToken(uid)
      : null;
    if (b.action === "status") {
      const calendars = token
        ? (await google("/users/me/calendarList", token)).items?.map(
            (c: { id: string; summary: string }) => ({
              id: c.id,
              summary: c.summary,
            }),
          ) || []
        : [];
      return json({
        configured,
        connected: !!connection.google_refresh_token,
        calendars,
        calendarId: connection.google_calendar_id,
        emailEnabled: connection.email_enabled,
        telegramEnabled: connection.telegram_enabled,
        telegramChatId: connection.telegram_chat_id,
      });
    }
    if (!token) throw Error("Connect Google Calendar first");
    if (b.action === "select") {
      const list = await google("/users/me/calendarList", token);
      if (!list.items?.some((c: { id: string }) => c.id === b.calendarId))
        throw Error("Calendar not found");
      const { error } = await service
        .from("connections")
        .update({ google_calendar_id: b.calendarId })
        .eq("user_id", uid);
      if (error) throw error;
      return json({ ok: true });
    }
    if (!["sync", "sync-if-connected"].includes(b.action))
      throw Error("Unknown action");
    const generated = await service.rpc("generate_occurrences", {
      p_user: uid,
    });
    if (generated.error) throw generated.error;
    const { data: profile } = await service
      .from("profiles")
      .select("timezone")
      .eq("id", uid)
      .single();
    const zone = profile?.timezone || "Europe/Moscow";
    const cal = connection.google_calendar_id;
    if (!cal) throw Error("Select a calendar");
    const { data: obligations, error: oe } = await service
      .from("obligations")
      .select("*")
      .eq("user_id", uid)
      .gte(
        "due_date",
        new Date(new Date().getFullYear() - 1, 0, 1).toISOString().slice(0, 10),
      )
      .lte(
        "due_date",
        new Date(new Date().getFullYear() + 2, 11, 31)
          .toISOString()
          .slice(0, 10),
      );
    if (oe) throw oe;
    const { data: payments } = await service
      .from("payments")
      .select("obligation_id,amount")
      .eq("user_id", uid);
    const { data: links } = await service
      .from("calendar_events")
      .select("*")
      .eq("user_id", uid)
      .eq("calendar_id", cal);
    let synced = 0;
    for (const o of obligations || []) {
      const link = links?.find(
        (x: { obligation_id: string }) => x.obligation_id === o.id,
      );
      const path = `/calendars/${encodeURIComponent(cal)}/events`;
      if (o.status === "cancelled" || o.deleted_at) {
        if (link) {
          try {
            await google(
              path + "/" + encodeURIComponent(link.event_id),
              token,
              "DELETE",
            );
          } catch (e) {
            if (!/Google Calendar (404|410):/.test(String(e))) throw e;
          }
          await service
            .from("calendar_events")
            .delete()
            .eq("obligation_id", o.id)
            .eq("calendar_id", cal);
        }
        continue;
      }
      const paid = (payments || [])
        .filter((p: { obligation_id: string }) => p.obligation_id === o.id)
        .reduce((a: number, p: { amount: number }) => a + Number(p.amount), 0);
      const done =
        o.kind === "report"
          ? o.status === "accepted"
          : paid >= Number(o.planned_amount);
      const eventId = link?.event_id || "fc" + o.id.replaceAll("-", "");
      const event = {
        summary: (done ? "✓ " : "") + o.title,
        description: `${o.kind === "report" ? "Отчет" : "Обязательство"} · План: ${o.planned_amount} ₽ · Оплачено: ${paid} ₽ · Осталось: ${Math.max(0, Number(o.planned_amount) - paid).toFixed(2)} ₽. Время 09:00 — напоминание, крайний срок относится ко всему дню.`,
        start: { dateTime: o.due_date + "T09:00:00", timeZone: zone },
        end: { dateTime: o.due_date + "T09:15:00", timeZone: zone },
        visibility: "private",
        transparency: "transparent",
        reminders: {
          useDefault: false,
          overrides: done
            ? []
            : [
                ...new Set([
                  0,
                  ...(o.reminder_days || []).filter(
                    (d: number) => Number.isInteger(d) && d > 0 && d <= 28,
                  ),
                ]),
              ]
                .slice(0, 5)
                .map((days) => ({
                  method: "popup",
                  minutes: Number(days) * 1440,
                })),
        },
        extendedProperties: { private: { financeObligationId: o.id } },
      };
      let result;
      try {
        result = link
          ? await google(
              path + "/" + encodeURIComponent(link.event_id),
              token,
              "PUT",
              event,
            )
          : await google(path, token, "POST", { ...event, id: eventId });
      } catch (e) {
        if (!link && String(e).includes("409")) {
          result = await google(path + "/" + eventId, token, "PUT", event);
        } else if (link && /Google Calendar (404|410):/.test(String(e))) {
          result = await google(path, token, "POST", {
            ...event,
            id: "fc" + crypto.randomUUID().replaceAll("-", ""),
          });
        } else throw e;
      }
      const { error } = await service.from("calendar_events").upsert(
        {
          user_id: uid,
          obligation_id: o.id,
          calendar_id: cal,
          event_id: result.id,
        },
        { onConflict: "obligation_id,calendar_id" },
      );
      if (error) throw error;
      synced++;
    }
    return json({ synced });
  } catch (e) {
    return json({ error: String(e) }, 400);
  }
});
