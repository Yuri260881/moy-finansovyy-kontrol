import { cors, json, user, service } from "../_shared/core.ts";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const person = await user(req);
    if ((await req.json()).action !== "delete") throw Error("Unknown action");
    const { data: receipts } = await service
      .from("receipts")
      .select("storage_path")
      .eq("user_id", person.id);
    if (receipts?.length) {
      const { error } = await service.storage
        .from("receipts")
        .remove(receipts.map((r: { storage_path: string }) => r.storage_path));
      if (error) throw error;
    }
    const { error } = await service.auth.admin.deleteUser(person.id);
    if (error) throw error;
    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e) }, 400);
  }
});
