import { useQueryClient } from '@tanstack/react-query';
import { LogOut, Monitor, Moon, Pencil, Sun, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { colorForUser, type Me } from '@cld/shared';
import { api, errorMessage } from '../lib/api';
import { authClient } from '../lib/auth';
import { keys, useMe } from '../lib/queries';
import { setThemePref, useThemePref } from '../lib/theme';
import {
  Avatar,
  Button,
  Dialog,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from './ui';

export function UserMenu() {
  const me = useMe().data;
  const theme = useThemePref();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [dialog, setDialog] = useState<null | 'name' | 'end'>(null);
  if (!me) return null;

  const signOut = async () => {
    await authClient.signOut();
    qc.clear();
    navigate('/signin');
  };
  const here = encodeURIComponent(location.pathname + location.search);

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <button aria-label="Account menu" className="rounded-full focus-visible:ring-2">
            <Avatar name={me.name} image={me.image} color={colorForUser(me.id)} size={30} />
          </button>
        </MenuTrigger>
        <MenuContent>
          <div className="px-2 py-1.5">
            <div className="text-sm font-medium text-app">{me.name}</div>
            <div className="text-xs text-muted">
              {me.isGuest ? 'Guest on this device' : me.email}
            </div>
          </div>
          {me.isGuest && (
            <>
              <MenuSeparator />
              <MenuItem
                icon={<UserPlus className="size-4" />}
                onSelect={() => navigate(`/signup?next=${here}`)}
              >
                Create account to keep access
              </MenuItem>
            </>
          )}
          <MenuItem icon={<Pencil className="size-4" />} onSelect={() => setDialog('name')}>
            Change name
          </MenuItem>
          <MenuSeparator />
          <MenuLabel>Theme</MenuLabel>
          <MenuItem
            icon={<Sun className="size-4" />}
            checked={theme === 'light'}
            onSelect={() => setThemePref('light')}
          >
            Light
          </MenuItem>
          <MenuItem
            icon={<Moon className="size-4" />}
            checked={theme === 'dark'}
            onSelect={() => setThemePref('dark')}
          >
            Dark
          </MenuItem>
          <MenuItem
            icon={<Monitor className="size-4" />}
            checked={theme === 'system'}
            onSelect={() => setThemePref('system')}
          >
            System
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            icon={<LogOut className="size-4" />}
            onSelect={() => (me.isGuest ? setDialog('end') : void signOut())}
          >
            {me.isGuest ? 'End guest session' : 'Sign out'}
          </MenuItem>
        </MenuContent>
      </Menu>
      {dialog === 'name' && <NameDialog me={me} onClose={() => setDialog(null)} />}
      <Dialog
        open={dialog === 'end'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="End guest session?"
        description="You'll lose access to the projects you joined as a guest on this device. You can rejoin through a share link, or create an account to keep access."
        footer={
          <>
            <Button onClick={() => navigate(`/signup?next=${here}`)}>Create account</Button>
            <Button variant="danger" onClick={signOut}>
              End session
            </Button>
          </>
        }
      />
    </>
  );
}

function NameDialog({ me, onClose }: { me: Me; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(me.name);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api('/me', { method: 'PATCH', body: { name: name.trim() } });
      await qc.invalidateQueries({ queryKey: keys.me });
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Change your name"
      description="Shown to others next to your cursor and on new comments."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Input
          autoFocus
          aria-label="Your name"
          maxLength={50}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </form>
    </Dialog>
  );
}
