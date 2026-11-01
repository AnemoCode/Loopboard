import { useQueryClient } from '@tanstack/react-query';
import { LogOut, Monitor, Moon, Sun } from 'lucide-react';
import { useNavigate } from 'react-router';
import { colorForUser } from '@cld/shared';
import { authClient } from '../lib/auth';
import { useMe } from '../lib/queries';
import { setThemePref, useThemePref } from '../lib/theme';
import { Avatar, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from './ui';

export function UserMenu() {
  const me = useMe().data;
  const theme = useThemePref();
  const qc = useQueryClient();
  const navigate = useNavigate();
  if (!me) return null;
  return (
    <Menu>
      <MenuTrigger asChild>
        <button aria-label="Account menu" className="rounded-full focus-visible:ring-2">
          <Avatar name={me.name} image={me.image} color={colorForUser(me.id)} size={30} />
        </button>
      </MenuTrigger>
      <MenuContent>
        <div className="px-2 py-1.5">
          <div className="text-sm font-medium text-app">{me.name}</div>
          <div className="text-xs text-muted">{me.email}</div>
        </div>
        <MenuSeparator />
        <MenuLabel>Theme</MenuLabel>
        <MenuItem icon={<Sun className="size-4" />} checked={theme === 'light'} onSelect={() => setThemePref('light')}>Light</MenuItem>
        <MenuItem icon={<Moon className="size-4" />} checked={theme === 'dark'} onSelect={() => setThemePref('dark')}>Dark</MenuItem>
        <MenuItem icon={<Monitor className="size-4" />} checked={theme === 'system'} onSelect={() => setThemePref('system')}>System</MenuItem>
        <MenuSeparator />
        <MenuItem
          icon={<LogOut className="size-4" />}
          onSelect={async () => {
            await authClient.signOut();
            qc.clear();
            navigate('/signin');
          }}
        >
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
