import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { ROLE_LABELS, type InvitePreview } from '@cld/shared';
import { LogoMark } from '../components/Logo';
import { Button, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { keys } from '../lib/queries';
import { NotFoundPage } from './NotFoundPage';

export function InvitePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const preview = useQuery({ queryKey: ['invite', token], queryFn: () => api<InvitePreview>(`/invites/${token}`), retry: false });
  const accept = useMutation({
    mutationFn: () => api<{ projectId: string }>(`/invites/${token}/accept`, { method: 'POST' }),
    onSuccess: async ({ projectId }) => {
      await qc.invalidateQueries({ queryKey: keys.projects });
      navigate(`/p/${projectId}`, { replace: true });
    },
  });

  if (preview.isLoading)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  if (preview.error) return <NotFoundPage title="Invite not available" message={errorMessage(preview.error)} />;
  const p = preview.data!;
  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-app bg-surface p-8 text-center shadow-sm">
        <div className="flex justify-center">
          <LogoMark size={40} />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-app">{p.invitedBy} invited you</h1>
        <p className="mt-1 text-sm text-muted">
          to <span className="font-medium text-app">{p.projectName}</span> · {ROLE_LABELS[p.role].toLowerCase()}
        </p>
        {accept.error && <p className="mt-4 text-sm text-red-600">{errorMessage(accept.error)}</p>}
        <Button variant="primary" className="mt-6 w-full" loading={accept.isPending} onClick={() => accept.mutate()}>
          {p.alreadyMember ? 'Open project' : 'Join project'}
        </Button>
      </div>
    </div>
  );
}
