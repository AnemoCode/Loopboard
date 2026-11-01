import { z } from 'zod';

// ---------------------------------------------------------------- roles

export const ROLES = ['owner', 'editor', 'commenter', 'viewer'] as const;
export type Role = (typeof ROLES)[number];
export const INVITABLE_ROLES = ['editor', 'commenter', 'viewer'] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

const RANK: Record<Role, number> = { viewer: 0, commenter: 1, editor: 2, owner: 3 };
export const atLeast = (role: Role | null | undefined, min: Role): boolean => !!role && RANK[role] >= RANK[min];

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  editor: 'Can edit',
  commenter: 'Can comment',
  viewer: 'Can view',
};

/** Name of the collaborative document of a project. */
export const docName = (projectId: string): string => `project:${projectId}`;
export const projectIdFromDoc = (name: string): string | null => {
  const m = name.match(/^project:([0-9a-f-]{36})$/);
  return m ? m[1]! : null;
};

// ---------------------------------------------------------------- API payloads

export const projectName = z.string().trim().min(1).max(200);

export const createProjectBody = z.object({
  name: projectName,
  /** Optional initial content (import / template); validated server-side with the snapshot schema. */
  snapshot: z.unknown().optional(),
});

export const updateProjectBody = z.object({ name: projectName });

export const inviteBody = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  role: z.enum(INVITABLE_ROLES),
});

export const roleBody = z.object({ role: z.enum(INVITABLE_ROLES) });
export const linkBody = z.object({ role: z.enum(INVITABLE_ROLES) });
export const versionBody = z.object({ label: z.string().trim().min(1).max(200) });

export const commentBody = z.object({
  diagramId: z.string().min(1).max(64),
  elementId: z.string().min(1).max(64).optional(),
  x: z.number().finite(),
  y: z.number().finite(),
  body: z.string().trim().min(1).max(5000),
});
export const replyBody = z.object({ body: z.string().trim().min(1).max(5000) });
export const resolveBody = z.object({ resolved: z.boolean() });

// ---------------------------------------------------------------- API responses

export interface Me {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  role: Role;
  ownerName: string;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: Role;
}

export interface PendingInvite {
  id: string;
  email: string;
  role: InvitableRole;
  createdAt: string;
}

export interface ShareLink {
  id: string;
  token: string;
  role: InvitableRole;
  createdAt: string;
}

export interface VersionSummary {
  id: string;
  label: string | null;
  kind: 'auto' | 'manual' | 'import' | 'restore';
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface InvitePreview {
  projectId: string;
  projectName: string;
  role: InvitableRole;
  invitedBy: string;
  alreadyMember: boolean;
}

export interface AppConfig {
  socialProviders: ('google' | 'github')[];
}

/** RFC 9457 problem body returned by the API on errors. */
export interface Problem {
  type?: string;
  title: string;
  status: number;
  detail?: string;
}

// ---------------------------------------------------------------- presence

/** 12 accessible presence colors; a user's color is derived from their id. */
export const PRESENCE_COLORS = [
  '#e11d48',
  '#ea580c',
  '#d97706',
  '#65a30d',
  '#059669',
  '#0891b2',
  '#2563eb',
  '#4f46e5',
  '#7c3aed',
  '#c026d3',
  '#db2777',
  '#0d9488',
];

export function colorForUser(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PRESENCE_COLORS[h % PRESENCE_COLORS.length]!;
}
