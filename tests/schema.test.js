import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("fresh-install schema uses valid PostgreSQL dollar-quoted function bodies", async () => {
  const sql = await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8");
  assert.equal(sql.includes("as $\n"), false);
  assert.equal(sql.includes("\n$;"), false);
  assert.match(sql, /create or replace function public\.get_room_participant_id/);
  assert.match(sql, /create or replace function public\.is_room_participant/);
});

test("reflection responses are accepted only after the room is revealed", async () => {
  const schema = await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8");
  const migration = await readFile(
    new URL("../supabase/migrations/20261120_require_reveal_before_reflection.sql", import.meta.url),
    "utf8"
  );
  for (const sql of [schema, migration]) {
    assert.match(sql, /p_phase = 'after_reveal' and r\.status = 'revealed'/);
    assert.doesNotMatch(sql, /p_phase = 'after_reveal' and r\.status in \('revealed', 'voting'\)/);
  }
});


test("fresh schema binds every response to the authenticated room participant", async () => {
  const schema = await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8");
  assert.match(schema, /user_id = \(select auth\.uid\(\)\)[\s\S]*?is_room_participant\(room_code, participant_id\)/);
  assert.match(schema, /create policy "responses controlled read"[\s\S]*?user_id = \(select auth\.uid\(\)\)[\s\S]*?is_room_host\(room_code\)[\s\S]*?is_room_revealed\(room_code\)/);
  assert.match(schema, /create policy "responses own update"[\s\S]*?using \([\s\S]*?is_room_participant\(room_code, participant_id\)[\s\S]*?with check \([\s\S]*?is_room_participant\(room_code, participant_id\)/);
});

test("identity migration keeps participant mappings inaccessible through direct table grants", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20261120_bind_participant_identity.sql", import.meta.url),
    "utf8"
  );
  assert.match(migration, /alter table public\.room_participants enable row level security/);
  assert.match(migration, /revoke all on public\.room_participants from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.get_room_participant_id\(text\) to authenticated/);
});
