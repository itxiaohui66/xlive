-- Add replay metadata to completed live sessions.
ALTER TABLE "live_sessions"
ADD COLUMN "recording_url" VARCHAR(500),
ADD COLUMN "recording_size" BIGINT;

-- Associate chat messages with their live session so they can be replayed as timed danmaku.
ALTER TABLE "chat_messages"
ADD COLUMN "session_id" UUID,
ADD COLUMN "offset_seconds" DOUBLE PRECISION;

CREATE INDEX "chat_messages_session_id_offset_seconds_idx"
ON "chat_messages"("session_id", "offset_seconds");

ALTER TABLE "chat_messages"
ADD CONSTRAINT "chat_messages_session_id_fkey"
FOREIGN KEY ("session_id") REFERENCES "live_sessions"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
