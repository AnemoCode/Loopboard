import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AppConfig,
  Me,
  Member,
  PendingInvite,
  ProjectSummary,
  Role,
  ShareLink,
  VersionSummary,
} from '@cld/shared';
import { api, ApiError } from './api';

export const keys = {
  me: ['me'] as const,
  config: ['config'] as const,
  projects: ['projects'] as const,
  project: (id: string) => ['project', id] as const,
  members: (id: string) => ['members', id] as const,
  links: (id: string) => ['links', id] as const,
  versions: (id: string) => ['versions', id] as const,
};

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return await api<Me>('/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

export const useConfig = () =>
  useQuery({
    queryKey: keys.config,
    queryFn: () => api<AppConfig>('/config'),
    staleTime: Infinity,
  });
export const useProjects = () =>
  useQuery({ queryKey: keys.projects, queryFn: () => api<ProjectSummary[]>('/projects') });

export interface ProjectInfo {
  id: string;
  name: string;
  role: Role;
  ownerId: string;
  updatedAt: string;
}
export const useProject = (id: string) =>
  useQuery({
    queryKey: keys.project(id),
    queryFn: () => api<ProjectInfo>(`/projects/${id}`),
    retry: false,
  });

export const useMembers = (id: string) =>
  useQuery({
    queryKey: keys.members(id),
    queryFn: () => api<{ members: Member[]; invites: PendingInvite[] }>(`/projects/${id}/members`),
  });
export const useLinks = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: keys.links(id),
    queryFn: () => api<ShareLink[]>(`/projects/${id}/links`),
    enabled,
  });
export const useVersions = (id: string) =>
  useQuery({
    queryKey: keys.versions(id),
    queryFn: () => api<VersionSummary[]>(`/projects/${id}/versions`),
  });

/** Mutation that invalidates the given query keys on success. */
export function useApiMutation<TVars, TRes = unknown>(
  fn: (v: TVars) => Promise<TRes>,
  invalidate: readonly (readonly unknown[])[] = [],
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: k }))),
  });
}
