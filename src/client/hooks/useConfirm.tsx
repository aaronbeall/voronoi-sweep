import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaExclamationTriangle, FaCheck, FaTimes } from 'react-icons/fa';

export type ConfirmTone = 'default' | 'warn' | 'danger' | 'success';

export type ConfirmOptions = {
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  tone?: ConfirmTone;
  // If true, clicking backdrop will NOT close
  strict?: boolean;
};

export const useConfirm = () => {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ConfirmOptions>({});
  const resolver = useRef<(val: boolean) => void>();

  const confirm = useCallback((options: ConfirmOptions = {}) => {
    setOpts(options);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const resolve = useCallback((val: boolean) => {
    setOpen(false);
    const r = resolver.current;
    resolver.current = undefined;
    if (r) r(val);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') resolve(false);
      if (e.key === 'Enter') resolve(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, resolve]);

  const toneClasses = useMemo(() => {
    switch (opts.tone) {
      case 'danger':
        return {
          border: 'border-red-500/50',
          glow: 'shadow-red-500/30',
          icon: <FaExclamationTriangle className="text-red-500" size={18} />,
          btn: 'bg-red-500 hover:bg-red-400',
        };
      case 'warn':
        return {
          border: 'border-amber-400/50',
          glow: 'shadow-amber-400/30',
          icon: <FaExclamationTriangle className="text-amber-400" size={18} />,
          btn: 'bg-amber-400 hover:bg-amber-300 text-black',
        };
      case 'success':
        return {
          border: 'border-emerald-500/50',
          glow: 'shadow-emerald-500/30',
          icon: <FaCheck className="text-emerald-400" size={18} />,
          btn: 'bg-emerald-500 hover:bg-emerald-400',
        };
      default:
        return {
          border: 'border-white/20',
          glow: 'shadow-white/10',
          icon: <FaExclamationTriangle className="text-white/70" size={18} />,
          btn: 'bg-white/20 hover:bg-white/30',
        };
    }
  }, [opts.tone]);

  const ConfirmOverlay = useCallback(() => {
    if (!open) return null;
    const title = opts.title ?? 'Are you sure?';
    const message = opts.message ?? '';
    const confirmText = opts.confirmText ?? 'Confirm';
    const cancelText = opts.cancelText ?? 'Cancel';

    return (
      <div className="pointer-events-none absolute inset-0 z-50">
        {/* Bottom-centered lightweight sheet */}
        <div className="pointer-events-auto absolute bottom-4 left-1/2 -translate-x-1/2">
          <div
            className={`glass backdrop-blur-md px-5 py-4 rounded-xl flex items-start gap-4 border-2 shadow-2xl anim-pop ${toneClasses.border} ${toneClasses.glow}`}
            role="dialog"
            aria-modal="true"
          >
            <div className="mt-0.5 shrink-0">{toneClasses.icon}</div>
            <div className="flex flex-col gap-1 max-w-md">
              <p className="font-semibold leading-tight">{title}</p>
              {message && <p className="text-sm text-white/70 leading-snug">{message}</p>}
              <div className="flex items-center gap-2 mt-2">
                <button
                  className={`px-3 py-1.5 rounded-md text-sm font-medium ${toneClasses.btn}`}
                  onClick={() => resolve(true)}
                >
                  {confirmText}
                </button>
                <button
                  className="px-3 py-1.5 rounded-md text-sm font-medium bg-white/10 hover:bg-white/15"
                  onClick={() => resolve(false)}
                >
                  {cancelText}
                </button>
              </div>
            </div>
            <button
              className="ml-1 p-2 rounded-md hover:bg-white/10"
              aria-label="Close"
              onClick={() => resolve(false)}
            >
              <FaTimes size={14} />
            </button>
          </div>
        </div>
        {/* small backdrop behind the card only */}
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 w-[min(640px,90vw)] h-[96px] blur-2xl bg-black/30 rounded-xl anim-fade" />
      </div>
    );
  }, [open, opts.title, opts.message, opts.confirmText, opts.cancelText, toneClasses, resolve]);

  return { Confirm: ConfirmOverlay, confirm };
};
