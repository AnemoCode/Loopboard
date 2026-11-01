ALTER TABLE "project_changes" ADD COLUMN "revert" jsonb;--> statement-breakpoint
ALTER TABLE "project_changes" ADD COLUMN "undone_by" text;--> statement-breakpoint
ALTER TABLE "project_changes" ADD COLUMN "undone_by_name" text;--> statement-breakpoint
ALTER TABLE "project_changes" ADD COLUMN "undone_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project_changes" ADD CONSTRAINT "project_changes_undone_by_user_id_fk" FOREIGN KEY ("undone_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;