-- Track uploaded files (avatars, covers) so admins can manage them.
CREATE TABLE "uploads" (
    "id" UUID NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "original_name" VARCHAR(255),
    "mime_type" VARCHAR(64) NOT NULL,
    "size" INTEGER NOT NULL,
    "uploader_id" UUID,
    "url" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "uploads_created_at_idx" ON "uploads"("created_at");

ALTER TABLE "uploads"
ADD CONSTRAINT "uploads_uploader_id_fkey"
FOREIGN KEY ("uploader_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Per-room choice whether live sessions generate a replay, captured per session at publish time.
ALTER TABLE "rooms"
ADD COLUMN "record_replay" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "live_sessions"
ADD COLUMN "record_enabled" BOOLEAN NOT NULL DEFAULT true;
