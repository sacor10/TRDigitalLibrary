import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

import { ChevronDownIcon } from './icons';

export interface NavMenuItem {
  to: string;
  label: string;
}

interface NavMenuProps {
  label: string;
  items: NavMenuItem[];
}

/**
 * Accessible click/keyboard dropdown for grouped nav destinations.
 * - Trigger is a real <button> with aria-haspopup / aria-expanded.
 * - Items are NavLinks inside a role="menu" container.
 * - Opens on click / Enter / Space / ArrowDown; Arrow keys move a roving focus;
 *   Escape and click-outside close; Escape returns focus to the trigger.
 */
export function NavMenu({ label, items }: NavMenuProps) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const menuId = useId();

  const groupActive = items.some(
    (item) => pathname === item.to || pathname.startsWith(`${item.to}/`),
  );

  const close = useCallback((focusTrigger = false) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  const openMenu = useCallback((focusIndex: number | null) => {
    setOpen(true);
    if (focusIndex !== null) {
      // Focus after the menu paints.
      requestAnimationFrame(() => itemRefs.current[focusIndex]?.focus());
    }
  }, []);

  // Close on outside pointerdown while open.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const focusItem = (index: number) => {
    const count = items.length;
    const next = (index + count) % count;
    itemRefs.current[next]?.focus();
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    switch (e.key) {
      case 'ArrowDown':
      case 'Enter':
      case ' ':
        e.preventDefault();
        openMenu(0);
        break;
      case 'ArrowUp':
        e.preventDefault();
        openMenu(items.length - 1);
        break;
      case 'Escape':
        if (open) close();
        break;
    }
  };

  const onItemKeyDown = (e: React.KeyboardEvent<HTMLAnchorElement>, index: number) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusItem(index + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusItem(index - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusItem(0);
        break;
      case 'End':
        e.preventDefault();
        focusItem(items.length - 1);
        break;
      case 'Escape':
        e.preventDefault();
        close(true);
        break;
      case 'Tab':
        // Let focus leave naturally, just close.
        setOpen(false);
        break;
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close() : openMenu(null))}
        onKeyDown={onTriggerKeyDown}
        className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border-b-2 px-3 py-2 hover:bg-parchment-200/60 dark:hover:bg-ink-700 ${
          groupActive
            ? 'border-accent-500 font-semibold text-accent-500'
            : 'border-transparent'
        }`}
      >
        {label}
        <ChevronDownIcon
          width={16}
          height={16}
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className="absolute left-0 top-full z-40 mt-1 min-w-44 overflow-hidden rounded-md border border-ink-700/10 bg-parchment-100 py-1 shadow-lg dark:border-parchment-50/10 dark:bg-ink-800"
        >
          {items.map((item, index) => (
            <NavLink
              key={item.to}
              to={item.to}
              role="menuitem"
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              onClick={() => close()}
              onKeyDown={(e) => onItemKeyDown(e, index)}
              className={({ isActive }) =>
                `block px-4 py-2 text-sm hover:bg-parchment-200/60 dark:hover:bg-ink-700 ${
                  isActive ? 'font-semibold text-accent-500' : ''
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}
