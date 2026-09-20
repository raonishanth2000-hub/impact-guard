import { createContext, useContext, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Collapsible sidebar — expands on hover, collapses to an icon rail.
 *
 * Ported from the Next.js/TypeScript original to this stack:
 *   next/link      -> react-router NavLink (this app routes client-side)
 *   next/image     -> not needed; no remote avatars here
 *   "use client"   -> dropped; Vite has no server components
 *   neutral-*      -> design tokens, so the rail inherits the warm system
 *                     rather than introducing a second, colder palette
 *   framer-motion  -> CSS transitions (see below)
 *
 * On motion: the original animates width with framer-motion. That drives the
 * tween from requestAnimationFrame, so in any context where the document is not
 * compositing the style is never applied at all and the rail renders at its
 * content width — collapsed and expanded look identical. A CSS transition is
 * applied by the browser immediately and tweens when it can, so the layout is
 * always correct and the animation is a progressive enhancement. It also keeps
 * the rail on the same 150-250ms easing as the rest of the interface, and off
 * the main bundle.
 *
 * The API is unchanged: Sidebar / SidebarBody / SidebarLink / useSidebar.
 */

export const SIDEBAR_WIDTH_OPEN = 288
export const SIDEBAR_WIDTH_CLOSED = 84

const SidebarContext = createContext(undefined)

export const useSidebar = () => {
  const context = useContext(SidebarContext)
  if (!context) throw new Error('useSidebar must be used within a SidebarProvider')
  return context
}

export const SidebarProvider = ({ children, open: openProp, setOpen: setOpenProp, animate = true }) => {
  const [openState, setOpenState] = useState(false)
  const open = openProp !== undefined ? openProp : openState
  const setOpen = setOpenProp !== undefined ? setOpenProp : setOpenState

  return (
    <SidebarContext.Provider value={{ open, setOpen, animate }}>
      {children}
    </SidebarContext.Provider>
  )
}

export const Sidebar = ({ children, open, setOpen, animate }) => (
  <SidebarProvider open={open} setOpen={setOpen} animate={animate}>
    {children}
  </SidebarProvider>
)

export const SidebarBody = (props) => (
  <>
    <DesktopSidebar {...props} />
    <MobileSidebar {...props} />
  </>
)

export const DesktopSidebar = ({ className, children, ...props }) => {
  const { open, setOpen, animate } = useSidebar()
  // Hover is expressed in CSS rather than driven from the mouse handlers, so
  // expansion never depends on JS event delivery. The handlers still run — they
  // keep `open` in context so labels can respond — and focus-within covers
  // keyboard users, who never generate a hover at all.
  const forced = !animate || open

  return (
    <>
      {/* A fixed-width gutter that never changes size. The rail itself is taken
          out of flow and overlays the page when it expands, so hovering the
          navigation cannot reflow the layout — and cannot push content wide
          enough to introduce a horizontal scroll that clips the rail itself. */}
      <div className="hidden w-[84px] shrink-0 lg:block" aria-hidden="true" />

      <aside
      className={cn(
        'group/rail fixed left-0 top-0 z-40 hidden h-dvh flex-col overflow-hidden border-r',
        'border-rule bg-sunken px-3.5 py-5 lg:flex',
        'transition-[width,box-shadow] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]',
        'motion-reduce:transition-none',
        forced
          ? 'w-[288px] shadow-raised'
          : 'w-[84px] hover:w-[288px] hover:shadow-raised '
            + 'focus-within:w-[288px] focus-within:shadow-raised',
        className,
      )}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      // Expanding on focus keeps the rail usable for keyboard users, who never
      // generate a mouseenter.
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false)
      }}
      {...props}
    >
      {children}
      </aside>
    </>
  )
}

export const MobileSidebar = ({ className, children, ...props }) => {
  const { open, setOpen } = useSidebar()

  return (
    <div className="lg:hidden" {...props}>
      <div className="sticky top-0 z-30 flex h-12 items-center justify-between border-b
                      border-rule bg-canvas/92 px-4 backdrop-blur-md">
        <span className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink">
          Impact Guard
        </span>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-label={open ? 'Close navigation' : 'Open navigation'}
          aria-expanded={open}
          className="rounded-control p-1.5 text-ink-2 transition-colors duration-150
                     cursor-pointer hover:bg-sunken hover:text-ink"
        >
          <Menu size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      {open && (
        <div
          className={cn(
            'slide-in fixed inset-0 z-[100] flex flex-col justify-between bg-canvas p-8',
            className,
          )}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
            className="absolute right-6 top-6 rounded-control p-1.5 text-ink-2
                       transition-colors duration-150 cursor-pointer
                       hover:bg-sunken hover:text-ink"
          >
            <X size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
          {children}
        </div>
      )}
    </div>
  )
}

/**
 * Collapsing label. Width animates to zero on the icon rail rather than the
 * text being removed, so the row keeps its height and nothing reflows.
 */
function CollapsibleLabel({ children, className }) {
  const { open, animate } = useSidebar()
  const forced = !animate || open

  return (
    <span
      className={cn(
        'overflow-hidden whitespace-pre transition-[width,opacity] duration-200',
        'ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none',
        forced
          ? 'w-auto opacity-100'
          : 'w-0 opacity-0 group-hover/rail:w-auto group-hover/rail:opacity-100 ' +
            'group-focus-within/rail:w-auto group-focus-within/rail:opacity-100',
        className,
      )}
    >
      {children}
    </span>
  )
}

export { CollapsibleLabel }

/**
 * A navigation entry. Renders as a NavLink when routable, or as an inert row
 * when disabled — this app gates the analysis views until an investigation has
 * actually run, and a dead link would be worse than a visibly disabled one.
 */
export const SidebarLink = ({ link, className, onNavigate, ...props }) => {
  const label = (
    <CollapsibleLabel className="text-[13.5px] leading-[1.45]">
      {link.label}
    </CollapsibleLabel>
  )

  if (link.disabled) {
    return (
      <span
        aria-disabled="true"
        title={link.disabledHint}
        className={cn(
          'flex cursor-not-allowed items-center gap-3.5 rounded-control px-3 py-2.5',
          'text-ink-3 opacity-50',
          className,
        )}
      >
        <span className="shrink-0">{link.icon}</span>
        {label}
        {/* The collapsed label keeps width 0 rather than display:none, so it
            stays in the accessibility tree. No sr-only duplicate is needed —
            adding one made screen readers announce every item twice. */}
        <span className="sr-only">{link.disabledHint}</span>
      </span>
    )
  }

  return (
    <NavLink
      to={link.href}
      end={link.end}
      onClick={onNavigate}
      title={link.label}
      className={({ isActive }) =>
        cn(
          'group/sidebar relative flex items-center gap-3.5 rounded-control px-3 py-2.5',
          'transition-colors duration-150',
          isActive
            ? 'bg-surface font-semibold text-ink shadow-subtle ring-1 ring-rule'
            : 'text-ink-2 hover:bg-surface/80 hover:text-ink',
          className,
        )
      }
      {...props}
    >
      {({ isActive }) => (
        <>
          <span className={cn('shrink-0', isActive ? 'text-accent-ink' : 'text-ink-2')}>
            {link.icon}
          </span>
          {/* Active marker that survives the collapsed rail, where the label
              is not readable. */}
          {isActive && (
            <span className="absolute -left-3.5 top-1/2 h-5 w-[3px] -translate-y-1/2
                             rounded-r-full bg-accent" aria-hidden="true" />
          )}
          {label}
        </>
      )}
    </NavLink>
  )
}
