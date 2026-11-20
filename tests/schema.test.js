import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("fresh-install schema uses valid PostgreSQL dollar-quoted function bodies", async () => {
  const sql = await readFile(new URL("../supabase/schema.sql.", import.meta.url), "utf8");
  assert.doesNotMatch(sql, /\\bas\\s+\\$(?!\\$)/);
  assert.doesNotMatch(sql, /\\n\\$;/);
  assert.match(sql, /create or replace function public\\.get_room_participant_id/);
  assert.match(sql, /create or replace function public\\.is_room_participant/);
});
