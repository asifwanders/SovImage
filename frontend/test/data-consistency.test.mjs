import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const migration1 = readFileSync(
  new URL("../src-tauri/migrations/0001_init.sql", import.meta.url),
  "utf8",
);
const migration2 = readFileSync(
  new URL("../src-tauri/migrations/0002_data_consistency.sql", import.meta.url),
  "utf8",
);

function database(foreignKeys = true) {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`PRAGMA foreign_keys = ${foreignKeys ? "ON" : "OFF"}`);
  sql.exec(migration1);
  sql.exec(migration2);
  return sql;
}

for (const foreignKeys of [false, true]) {
  test(`chat deletion cascades with foreign keys ${foreignKeys ? "on" : "off"}`, () => {
    const sql = database(foreignKeys);
    sql.exec("INSERT INTO chats (id, title, created_at, updated_at) VALUES ('c', 'Chat', 'now', 'now')");
    sql.exec("INSERT INTO messages (id, chat_id, role, kind, content, status, created_at) VALUES ('m', 'c', 'user', 'text', 'private prompt', 'done', 'now')");
    sql.exec("INSERT INTO attachments (id, message_id, path, mime, created_at) VALUES ('a', 'm', '/private/image.png', 'image/png', 'now')");
    sql.exec("DELETE FROM chats WHERE id = 'c'");
    assert.equal(sql.prepare("SELECT count(*) AS n FROM messages").get().n, 0);
    assert.equal(sql.prepare("SELECT count(*) AS n FROM attachments").get().n, 0);
    assert.equal(sql.prepare("SELECT count(*) AS n FROM messages_fts").get().n, 0);
    sql.close();
  });
}

test("message insertion updates its chat in the same statement", () => {
  const sql = database();
  sql.exec("INSERT INTO chats (id, title, created_at, updated_at) VALUES ('c', 'Chat', 'old', 'old')");
  sql.exec("INSERT INTO messages (id, chat_id, role, kind, content, status, created_at) VALUES ('m', 'c', 'user', 'text', 'hello', 'done', 'new')");
  assert.equal(
    sql.prepare("SELECT updated_at FROM chats WHERE id = 'c'").get().updated_at,
    "new",
  );
  sql.close();
});

test("clear requests keep settings unless reset and roll back together", () => {
  const sql = database();
  sql.exec("INSERT INTO settings (key, value) VALUES ('theme', 'dark')");
  sql.exec("INSERT INTO chats (id, title, created_at, updated_at) VALUES ('c1', 'Chat', 'now', 'now')");
  sql.exec("INSERT INTO messages (id, chat_id, role, kind, content, status, created_at) VALUES ('m1', 'c1', 'user', 'text', 'private prompt', 'done', 'now')");
  sql.exec("INSERT INTO clear_requests (id, reset_settings) VALUES (1, 0)");
  assert.equal(sql.prepare("SELECT count(*) AS n FROM chats").get().n, 0);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM messages_fts").get().n, 0);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM settings").get().n, 1);

  sql.exec("INSERT INTO chats (id, title, created_at, updated_at) VALUES ('locked', 'Locked', 'now', 'now')");
  sql.exec("CREATE TRIGGER prevent_locked_delete BEFORE DELETE ON chats WHEN old.id = 'locked' BEGIN SELECT RAISE(ABORT, 'locked'); END");
  assert.throws(
    () => sql.exec("INSERT INTO clear_requests (id, reset_settings) VALUES (1, 1)"),
    /locked/,
  );
  assert.equal(sql.prepare("SELECT count(*) AS n FROM chats").get().n, 1);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM settings").get().n, 1);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM clear_requests").get().n, 0);
  sql.close();
});
