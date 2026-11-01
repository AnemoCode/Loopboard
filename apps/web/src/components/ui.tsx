import * as RDialog from '@radix-ui/react-dialog';
import * as RMenu from '@radix-ui/react-dropdown-menu';
import * as RPopover from '@radix-ui/react-popover';
import * as RTooltip from '@radix-ui/react-tooltip';
import { clsx } from 'clsx';
import { Check, Loader2, X } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';

export const cx = clsx;

// ---------------------------------------------------------------- buttons

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent-600 text-white hover:bg-accent-700 shadow-sm',
  secondary: 'bg-surface text-app border border-app hover:bg-surface-2 shadow-sm',
  ghost: 'text-app hover:bg-surface-2',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm',
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean }
>(function Button({ variant = 'secondary', size = 'md', loading, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none select-none whitespace-nowrap',
        size === 'sm' ? 'h-8 px-3 text-sm' : 'h-9 px-4 text-sm',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; size?: 'sm' | 'md'; shortcut?: string; side?: 'top' | 'right' | 'bottom' | 'left' }
>(function IconButton({ label, active, size = 'md', shortcut, side = 'bottom', className, children, ...rest }, ref) {
  return (
    <Tooltip content={label} shortcut={shortcut} side={side}>
      <button
        ref={ref}
        aria-label={label}
        aria-pressed={active}
        className={cx(
          'inline-flex items-center justify-center rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none',
          size === 'sm' ? 'size-7' : 'size-9',
          active ? 'bg-accent-100 text-accent-700 dark:bg-accent-500/20 dark:text-accent-300' : 'text-app hover:bg-surface-2',
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  );
});

// ---------------------------------------------------------------- inputs

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cx(
        'h-9 w-full rounded-lg border border-app bg-surface px-3 text-sm text-app placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]/40 focus:border-[var(--ring)] disabled:opacity-60',
        className,
      )}
      {...rest}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cx(
        'w-full rounded-lg border border-app bg-surface px-3 py-2 text-sm text-app placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]/40 focus:border-[var(--ring)] resize-none',
        className,
      )}
      {...rest}
    />
  );
});

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Select<T extends string>({ value, onChange, options, className, disabled, ariaLabel }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as T)}
      className={cx('h-8 rounded-lg border border-app bg-surface px-2 text-sm text-app focus:outline-none focus:ring-2 focus:ring-[var(--ring)]/40', className)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Segmented control. */
export function Segmented<T extends string>({ value, onChange, options, disabled, size = 'md' }: {
  value: T | null;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
  disabled?: boolean;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="inline-flex w-full rounded-lg bg-surface-2 p-0.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          aria-label={o.title}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cx(
            'flex-1 inline-flex items-center justify-center rounded-md font-medium transition-colors disabled:opacity-50',
            size === 'sm' ? 'h-6 text-xs' : 'h-7 text-sm',
            value === o.value ? 'bg-surface text-app shadow-sm' : 'text-muted hover:text-app',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- overlays

export function Tooltip({ content, shortcut, children, side = 'bottom' }: { content: ReactNode; shortcut?: string; children: ReactNode; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  return (
    <RTooltip.Root delayDuration={350}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content side={side} sideOffset={6} className="z-50 rounded-md bg-stone-900 px-2 py-1 text-xs text-white shadow-lg dark:bg-stone-100 dark:text-stone-900 animate-pop">
          {content}
          {shortcut && <span className="ml-2 opacity-60">{shortcut}</span>}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

export function Dialog({ open, onOpenChange, title, description, children, footer, wide }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]" />
        <RDialog.Content
          className={cx(
            'fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-app bg-surface p-6 shadow-2xl animate-pop focus:outline-none',
            wide ? 'max-w-2xl' : 'max-w-md',
          )}
          // Keep focus where React's autoFocus put it (or on the dialog) instead of the close button.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            const content = e.currentTarget as HTMLElement;
            if (!content.contains(document.activeElement)) content.focus();
          }}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <RDialog.Title className="text-lg font-semibold text-app">{title}</RDialog.Title>
              {description ? (
                <RDialog.Description className="mt-1 text-sm text-muted">{description}</RDialog.Description>
              ) : (
                <RDialog.Description className="sr-only">{title}</RDialog.Description>
              )}
            </div>
            <RDialog.Close asChild>
              <button aria-label="Close" className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-app">
                <X className="size-4" />
              </button>
            </RDialog.Close>
          </div>
          {children}
          {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export const Menu = RMenu.Root;
export const MenuTrigger = RMenu.Trigger;
export function MenuContent({ children, align = 'end', side }: { children: ReactNode; align?: 'start' | 'end' | 'center'; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <RMenu.Portal>
      <RMenu.Content align={align} side={side} sideOffset={6} className="z-50 min-w-48 rounded-xl border border-app bg-surface p-1 shadow-xl animate-pop">
        {children}
      </RMenu.Content>
    </RMenu.Portal>
  );
}
export function MenuItem({ children, onSelect, danger, shortcut, disabled, icon, checked }: {
  children: ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  shortcut?: string;
  disabled?: boolean;
  icon?: ReactNode;
  checked?: boolean;
}) {
  return (
    <RMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cx(
        'flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-surface-2',
        danger ? 'text-red-600 dark:text-red-400' : 'text-app',
      )}
    >
      <span className="flex size-4 items-center justify-center text-muted">{checked ? <Check className="size-4" /> : icon}</span>
      <span className="flex-1">{children}</span>
      {shortcut && <span className="text-xs text-muted">{shortcut}</span>}
    </RMenu.Item>
  );
}
export const MenuSeparator = () => <RMenu.Separator className="my-1 h-px bg-[var(--border)]" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => <RMenu.Label className="px-2 py-1 text-xs font-medium text-muted">{children}</RMenu.Label>;

export const Popover = RPopover.Root;
export const PopoverTrigger = RPopover.Trigger;
export const PopoverAnchor = RPopover.Anchor;
export function PopoverContent({ children, className, side = 'bottom', align = 'center' }: { children: ReactNode; className?: string; side?: 'top' | 'right' | 'bottom' | 'left'; align?: 'start' | 'center' | 'end' }) {
  return (
    <RPopover.Portal>
      <RPopover.Content side={side} align={align} sideOffset={8} collisionPadding={12} className={cx('z-50 rounded-xl border border-app bg-surface p-3 shadow-xl animate-pop focus:outline-none', className)}>
        {children}
      </RPopover.Content>
    </RPopover.Portal>
  );
}

// ---------------------------------------------------------------- misc

export function Avatar({ name, color, image, size = 28, ring }: { name: string; color?: string; image?: string | null; size?: number; ring?: boolean }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span
      className={cx('inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none', ring && 'ring-2 ring-[var(--surface)]')}
      style={{ width: size, height: size, fontSize: size * 0.4, background: color ?? '#78716c' }}
      title={name}
    >
      {image ? <img src={image} alt="" className="size-full rounded-full object-cover" /> : initials || '?'}
    </span>
  );
}

export const Spinner = ({ className }: { className?: string }) => <Loader2 className={cx('size-5 animate-spin text-muted', className)} />;

export const Kbd = ({ children }: { children: ReactNode }) => (
  <kbd className="inline-flex min-w-5 items-center justify-center rounded border border-app bg-surface-2 px-1 font-sans text-[11px] text-muted">{children}</kbd>
);

export function Swatches({ colors, value, onChange, allowNone, noneLabel = 'None' }: {
  colors: string[];
  value: string | null | undefined;
  onChange: (c: string | null) => void;
  allowNone?: boolean;
  noneLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {allowNone && (
        <button
          title={noneLabel}
          aria-label={noneLabel}
          onClick={() => onChange(null)}
          className={cx('relative size-6 rounded-md border border-app bg-surface', value === null && 'ring-2 ring-[var(--ring)] ring-offset-1 ring-offset-[var(--surface)]')}
        >
          <span className="absolute left-1/2 top-1/2 h-px w-7 -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-red-500" />
        </button>
      )}
      {colors.map((c) => (
        <button
          key={c}
          title={c}
          aria-label={`Color ${c}`}
          onClick={() => onChange(c)}
          className={cx('size-6 rounded-md border border-black/10 dark:border-white/15', value?.toLowerCase() === c && 'ring-2 ring-[var(--ring)] ring-offset-1 ring-offset-[var(--surface)]')}
          style={{ background: c }}
        />
      ))}
      <label className="relative size-6 cursor-pointer overflow-hidden rounded-md border border-app" title="Custom color">
        <span className="absolute inset-0" style={{ background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }} />
        <input
          type="color"
          aria-label="Custom color"
          className="absolute inset-0 cursor-pointer opacity-0"
          value={value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-accent-50 text-accent-600 dark:bg-accent-500/15 dark:text-accent-300">{icon}</div>
      <h3 className="text-base font-semibold text-app">{title}</h3>
      {children && <p className="mt-1 max-w-sm text-sm text-muted">{children}</p>}
      {action && <div className="mt-5 flex gap-2">{action}</div>}
    </div>
  );
}
