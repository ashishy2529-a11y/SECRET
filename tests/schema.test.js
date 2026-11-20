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
