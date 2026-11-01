ALTER TABLE "project_invites" ADD COLUMN "allow_guests" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "project_members" ADD COLUMN "invite_id" uuid;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "is_anonymous" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_invite_id_project_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."project_invites"("id") ON DELETE set null ON UPDATE no action;