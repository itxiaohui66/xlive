-- 站内信 / 开播申请：用户向管理员申请开播权限，管理员审批。
CREATE TABLE "notices" (
    "id" UUID NOT NULL,
    "from_id" UUID NOT NULL,
    "content" VARCHAR(1000) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handled_at" TIMESTAMP(3),
    "handled_by" UUID,
    CONSTRAINT "notices_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notices_status_created_at_idx" ON "notices"("status", "created_at");

ALTER TABLE "notices"
ADD CONSTRAINT "notices_from_id_fkey"
FOREIGN KEY ("from_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- 新注册用户默认无开播权限，需向管理员申请并由管理员批准。
ALTER TABLE "users" ALTER COLUMN "can_stream" SET DEFAULT false;
