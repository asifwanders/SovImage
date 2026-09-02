-- Keep a chat's ordering timestamp consistent with its newest message inside
-- the same statement that inserts that message.
CREATE TRIGGER IF NOT EXISTS messages_touch_chat
AFTER INSERT ON messages BEGIN
  UPDATE chats SET updated_at = new.created_at WHERE id = new.chat_id;
END;

-- Keep deletion deterministic even if a future SQLite pool is opened without
-- foreign-key enforcement. These are idempotent alongside ON DELETE actions.
CREATE TRIGGER IF NOT EXISTS chats_delete_messages
AFTER DELETE ON chats BEGIN
  DELETE FROM messages WHERE chat_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS messages_delete_dependents
AFTER DELETE ON messages BEGIN
  DELETE FROM attachments WHERE message_id = old.id;
  UPDATE messages SET parent_id = NULL WHERE parent_id = old.id;
END;

-- plugin-sql is pool-backed, so separate BEGIN/DELETE/COMMIT calls from the
-- frontend are not guaranteed to use one connection. Inserting this request
-- performs both deletes in the trigger's implicit statement transaction.
CREATE TABLE IF NOT EXISTS clear_requests (
  id             INTEGER PRIMARY KEY CHECK(id = 1),
  reset_settings INTEGER NOT NULL CHECK(reset_settings IN (0, 1))
);

CREATE TRIGGER IF NOT EXISTS clear_requests_apply
AFTER INSERT ON clear_requests BEGIN
  DELETE FROM settings WHERE new.reset_settings = 1;
  DELETE FROM chats;
  DELETE FROM clear_requests WHERE id = new.id;
END;
