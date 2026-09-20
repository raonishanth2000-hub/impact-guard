import { memo, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, Menu, X, Activity, Share2, Layers, Lightbulb, ListChecks,
  LayoutDashboard, ShieldAlert, Check, Sparkles, Clock, GitCompare,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Impact Guard — landing surface.
 *
 * Structure follows the SaaS template (fixed nav, eyebrow badge, gradient
 * headline, hero CTA, section anchors). Adapted rather than copied:
 *
 *   palette   The template is pure black/grey. This page must differ from the
 *             console yet belong to it, so it uses the console's palette
 *             inverted and pushed dark — warm near-black, the console's canvas
 *             colour as text, the identical #FF8A3D accent.
 *   icons     lucide-react is already a dependency; re-declaring inline SVGs
 *             would mean two icon systems in one codebase.
 *   auth      The template ships Sign in / Sign Up. This product has no
 *             authentication, so those would be dead buttons. Replaced with the
 *             one real destination: the console.
 *   imagery   Stock screenshots replaced by a CSS 3D scene and a mockup built
 *             from real interface elements.
 *
 * Motion is CSS or IntersectionObserver driven throughout — never a JS frame
 * loop — so nothing silently fails to initialise.
 */

/* ---------------------------------------------------------------- primitives */

const LButton = ({ variant = 'default', size = 'default', className = '', children, ...props }) => {
  const base =
    'group/btn relative inline-flex items-center justify-center gap-2 whitespace-nowrap ' +
    'rounded-button font-medium transition-all duration-200 focus-visible:outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-[var(--l-accent)] focus-visible:ring-offset-2 ' +
    'focus-visible:ring-offset-[var(--l-void)] disabled:pointer-events-none disabled:opacity-50'

  const variants = {
    default:
      'bg-[var(--l-accent)] text-[#0a0806] shadow-[0_0_0_0_rgba(255,138,61,0.45)] ' +
      'hover:shadow-[0_0_28px_-4px_rgba(255,138,61,0.55)] hover:brightness-[1.06]',
    secondary:
      'bg-[var(--l-raised)] text-[var(--l-text)] ring-1 ring-[var(--l-line)] ' +
      'hover:bg-[var(--l-elevated)] hover:ring-[var(--l-accent)]/35',
    ghost: 'text-[var(--l-muted)] hover:bg-[var(--l-raised)] hover:text-[var(--l-text)]',
  }
  const sizes = {
    default: 'h-10 px-4 text-sm',
    sm: 'h-9 px-3.5 text-[13px]',
    lg: 'h-12 px-6 text-[15px]',
  }

  return (
    <button type="button" className={cn(base, variants[variant], sizes[size], className)} {...props}>
      {children}
    </button>
  )
}

/** Reveals children once they scroll into view. IntersectionObserver is
 *  event-based, so it fires regardless of frame scheduling. */
/**
 * Reveal — scroll-driven, with a guarantee that nothing stays hidden.
 *
 * Two deliberate choices, both learned the hard way on this page:
 *
 *   1. A scroll listener, not IntersectionObserver. The observer never fired in
 *      this project's preview environment and every section stayed at opacity 0
 *      — a blank page. Scroll events are reliable here.
 *   2. A fail-safe timer regardless. If the listener is somehow never called,
 *      the content reveals anyway. Decoration must never gate readability.
 *
 * `variant` picks the technique: focus (blur to sharp), wipe (a clip-path
 * sweep), or draw (a rule drawn from its origin). None of them translate the
 * element vertically.
 */
function Reveal({ children, delay = 0, variant = 'focus', className = '' }) {
  const ref = useRef(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    let settled = false
    const timers = []

    const detach = () => {
      window.removeEventListener('scroll', check)
      window.removeEventListener('resize', check)
      document.removeEventListener('visibilitychange', check)
    }
    const reveal = () => {
      if (settled) return
      settled = true
      detach()
      timers.push(setTimeout(() => setShown(true), delay))
    }
    function check() {
      const r = node.getBoundingClientRect()
      if (r.top < window.innerHeight * 0.92 && r.bottom > 0) reveal()
    }

    window.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check)
    // A page loaded in a background tab has its timers throttled, so the
    // fail-safe below can be delayed indefinitely. Re-check the moment the tab
    // is actually looked at.
    document.addEventListener('visibilitychange', check)
    check()
    timers.push(setTimeout(reveal, 6000))   // last-resort guarantee

    return () => { detach(); timers.forEach(clearTimeout) }
  }, [delay])

  return (
    <div
      ref={ref}
      className={cn('rv', `rv-${variant}`, shown && 'in', className)}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  )
}

/**
 * The headline, wiped in a word at a time.
 *
 * Each word is its own clip-path sweep, so the line prints left to right the
 * way a readout does, rather than sliding in from below. Screen readers get the
 * whole string from the parent's aria-label; the spans are hidden from them so
 * the sentence is not announced word by word.
 */
function WipeHeadline({ lines, className = '', style, delay = 0, step = 90 }) {
  let n = -1
  return (
    <h1 className={className} style={style} aria-label={lines.join(' ')}>
      {lines.map((line, li) => (
        <span key={li} className="block" aria-hidden="true">
          {line.split(' ').map((word) => {
            n += 1
            return (
              <Reveal
                key={`${li}-${n}`}
                variant="wipe"
                delay={delay + n * step}
                className="inline-block"
              >
                {word}&nbsp;
              </Reveal>
            )
          })}
        </span>
      ))}
    </h1>
  )
}

/** Counts up when scrolled into view. Uses timers, not rAF. */
function Counter({ to, suffix = '', duration = 1100 }) {
  const ref = useRef(null)
  const [value, setValue] = useState(0)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    let timers = []
    const run = () => {
      const steps = 26
      for (let i = 1; i <= steps; i++) {
        timers.push(setTimeout(() => {
          const t = i / steps
          setValue(Math.round(to * (1 - Math.pow(1 - t, 3))))
        }, (duration / steps) * i))
      }
    }
    if (!('IntersectionObserver' in window)) { setValue(to); return }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { run(); io.disconnect() } },
                                        { threshold: 0.4 })
    io.observe(node)
    return () => { io.disconnect(); timers.forEach(clearTimeout) }
  }, [to, duration])

  return <span ref={ref} className="tnum">{value}{suffix}</span>
}

/* ------------------------------------------------------------------ chrome */

const SECTIONS = [
  { href: '#inside', label: 'What’s inside' },
  { href: '#pipeline', label: 'How it works' },
  { href: '#honesty', label: 'What it won’t claim' },
]

const Navigation = memo(() => {
  const [open, setOpen] = useState(false)
  const [stuck, setStuck] = useState(false)
  const sentinel = useRef(null)

  // A sentinel at the top of the page tells us when the nav has left it,
  // without listening to every scroll event.
  useEffect(() => {
    const node = sentinel.current
    if (!node || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting), { threshold: 1 })
    io.observe(node)
    return () => io.disconnect()
  }, [])

  return (
    <>
      <div ref={sentinel} className="absolute left-0 top-0 h-px w-px" aria-hidden="true" />
      <header className={cn(
        'fixed top-0 z-50 w-full transition-all duration-300',
        stuck
          ? 'border-b border-[var(--l-line)] bg-[var(--l-void)]/88 backdrop-blur-xl'
          : 'border-b border-transparent bg-transparent',
      )}>
        <nav className="mx-auto max-w-6xl px-6 py-3.5">
          <div className="flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2.5">
              <span className="text-[var(--l-accent)]">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M2 17h4.2l2.6-8.4h2.4l2.2 6" stroke="currentColor" strokeWidth="1.7"
                        strokeLinecap="round" strokeLinejoin="round" opacity="0.45" />
                  <circle cx="16" cy="11" r="5" stroke="currentColor" strokeWidth="1.7" />
                  <path d="m19.8 14.8 2.2 2.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
              </span>
              <span className="text-[15px] font-semibold tracking-[-0.015em]">Impact Guard</span>
            </Link>

            <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-8 md:flex">
              {SECTIONS.map((s) => (
                <a key={s.href} href={s.href}
                   className="relative text-[13px] text-[var(--l-muted)] transition-colors
                              hover:text-[var(--l-text)]">
                  {s.label}
                </a>
              ))}
            </div>

            <div className="hidden md:flex">
              <Link to="/dashboard">
                <LButton variant="default" size="sm">
                  Open console
                  <ArrowRight size={14} strokeWidth={2} aria-hidden="true"
                              className="transition-transform duration-200 group-hover/btn:translate-x-0.5" />
                </LButton>
              </Link>
            </div>

            <button type="button" className="text-[var(--l-text)] md:hidden"
                    onClick={() => setOpen(!open)}
                    aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}>
              {open ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
            </button>
          </div>
        </nav>

        {open && (
          <div className="border-t border-[var(--l-line)] bg-[var(--l-void)]/97 backdrop-blur-xl md:hidden">
            <div className="flex flex-col gap-1 px-6 py-4">
              {SECTIONS.map((s) => (
                <a key={s.href} href={s.href} onClick={() => setOpen(false)}
                   className="py-2 text-[13px] text-[var(--l-muted)] hover:text-[var(--l-text)]">
                  {s.label}
                </a>
              ))}
              <Link to="/dashboard" className="mt-3">
                <LButton variant="default" size="sm" className="w-full">Open console</LButton>
              </Link>
            </div>
          </div>
        )}
      </header>
    </>
  )
})
Navigation.displayName = 'Navigation'

/* -------------------------------------------------------------------- hero */

const PLANES = [
  { z: 0,   label: 'Control-plane events', tone: 'var(--l-faint)' },
  { z: 52,  label: 'Normalised changes',   tone: 'var(--l-muted)' },
  { z: 104, label: 'Ranked by relevance',  tone: 'var(--l-accent)' },
  { z: 156, label: 'Investigation',        tone: 'var(--l-sage)' },
]

const NODES = [
  { x: -68, y: -30, d: 0 }, { x: 34, y: -62, d: 700 }, { x: 78, y: 26, d: 1400 },
  { x: -24, y: 58, d: 2100 }, { x: -92, y: 40, d: 2800 },
]

const Scene = memo(() => (
  <div className="scene relative mx-auto h-[340px] w-full max-w-xl" aria-hidden="true">
    <div className="stack absolute left-1/2 top-1/2 h-0 w-0">
      {PLANES.map((p) => (
        <div key={p.label} className="plane absolute -left-[140px] -top-[140px] h-[280px] w-[280px]"
             style={{ transform: `translateZ(${p.z}px)` }}>
          <div className="h-full w-full rounded-[20px] border"
               style={{
                 borderColor: p.tone,
                 background:
                   'linear-gradient(135deg, rgba(255,138,61,0.06), rgba(246,244,239,0.015))',
                 boxShadow: `0 0 40px -16px ${p.tone}`,
               }} />
        </div>
      ))}

      {/* Points of light on the top plane — the changes being surfaced. */}
      <div className="plane absolute left-0 top-0" style={{ transform: 'translateZ(156px)' }}>
        {NODES.map((n, i) => (
          <span key={i} className="node-bob absolute block h-1.5 w-1.5 rounded-full"
                style={{
                  left: n.x, top: n.y, animationDelay: `${n.d}ms`,
                  background: 'var(--l-accent)',
                  boxShadow: '0 0 12px 2px rgba(255,138,61,0.55)',
                }} />
        ))}
      </div>
    </div>
  </div>
))
Scene.displayName = 'Scene'

const SceneLegend = () => (
  <ul className="mx-auto mt-1 flex max-w-xl flex-wrap items-center justify-center gap-x-6 gap-y-2">
    {[...PLANES].reverse().map((p) => (
      <li key={p.label} className="flex items-center gap-2 text-[12px]">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: p.tone }} aria-hidden="true" />
        <span className="text-[var(--l-muted)]">{p.label}</span>
      </li>
    ))}
  </ul>
)

const Hero = memo(() => (
  <section className="relative overflow-hidden px-6 pb-24 pt-32 md:pt-36">
    <div className="aurora" aria-hidden="true" />
    <div className="grid-field" aria-hidden="true" />

    <div className="relative z-10 flex flex-col items-center">
      <Reveal>
        <aside className="mb-7 inline-flex flex-wrap items-center justify-center gap-2 rounded-full
                          border border-[var(--l-line)] bg-[var(--l-raised)]/70 px-3.5 py-1.5
                          backdrop-blur-sm">
          <Sparkles size={12} strokeWidth={2} aria-hidden="true" className="text-[var(--l-accent)]" />
          <span className="text-[11.5px] text-[var(--l-muted)]">
            Deterministic ranking. Explanations that never claim cause.
          </span>
        </aside>
      </Reveal>

      <WipeHeadline
        lines={['Find what changed', 'before you start debugging']}
        delay={60}
        className="display mb-6 max-w-3xl pb-[0.44em] text-center text-[40px] font-semibold
                   leading-[1.14] tracking-[-0.03em] md:text-[62px]"
        style={{
          background: 'linear-gradient(to bottom, #ffffff 0%, #f6f4ef 62%, rgba(246,244,239,0.88) 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        }}
      />

      <Reveal delay={120}>
        <p className="mb-9 max-w-xl text-center text-[15.5px] leading-relaxed text-[var(--l-muted)]">
          Give Impact Guard the moment an incident began. It collects control-plane
          changes from around that time, ranks them by how plausibly they relate, and
          tells you what to check first.
        </p>
      </Reveal>

      <Reveal delay={180}>
        <div className="mb-16 flex flex-wrap items-center justify-center gap-3">
          <Link to="/dashboard">
            <LButton variant="default" size="lg">
              Open the console
              <ArrowRight size={16} strokeWidth={2} aria-hidden="true"
                          className="transition-transform duration-200 group-hover/btn:translate-x-0.5" />
            </LButton>
          </Link>
          <a href="#inside"><LButton variant="secondary" size="lg">See what’s inside</LButton></a>
        </div>
      </Reveal>

      <Scene />
      <SceneLegend />
    </div>
  </section>
))
Hero.displayName = 'Hero'

/* ------------------------------------------------------------------ marquee */

const TRACKED = [
  'ModifyDBInstance', 'UpdateFunctionConfiguration', 'UpdateFunctionCode', 'RunInstances',
  'StopInstances', 'TerminateInstances', 'AuthorizeSecurityGroupIngress',
  'RevokeSecurityGroupIngress', 'PutBucketPolicy', 'DeleteBucketPolicy', 'UpdateAutoScalingGroup',
]

const Marquee = () => (
  <section className="border-y border-[var(--l-line)] py-5">
    <p className="mb-4 text-center text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--l-faint)]">
      Change types tracked today
    </p>
    <div className="marquee">
      <div className="marquee-track">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0" aria-hidden={copy === 1}>
            {TRACKED.map((t) => (
              <span key={t} className="mx-3 whitespace-nowrap rounded-control border
                                       border-[var(--l-line-soft)] bg-[var(--l-raised)] px-3 py-1.5
                                       font-mono text-[11.5px] text-[var(--l-muted)]">
                {t}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  </section>
)

/* ------------------------------------------------------------------- inside */

const VIEWS = [
  { Icon: Share2, name: 'Topology', wide: true,
    copy: 'The resources that changed and the links we can evidence from the payloads — plus a replay that builds the incident up step by step.' },
  { Icon: LayoutDashboard, name: 'Dashboard', copy: 'Session status and the last run at a glance.' },
  { Icon: Activity, name: 'Investigation', copy: 'Set the incident time and window; read the counts.' },
  { Icon: Layers, name: 'Changes', copy: 'Every change ranked, each showing the rules behind it.' },
  { Icon: Lightbulb, name: 'Insight', copy: 'A written assessment with its provenance on the same line.' },
  { Icon: ListChecks, name: 'Actions', copy: 'Concrete checks you can tick off as you work.' },
]

const Inside = () => (
  <section id="inside" className="mx-auto max-w-6xl scroll-mt-24 px-6 py-24">
    <Reveal>
      <h2 className="display text-[30px] font-semibold tracking-[-0.03em] md:text-[38px]">
        What’s inside
      </h2>
      <p className="mt-3 max-w-xl text-[14.5px] leading-relaxed text-[var(--l-muted)]">
        Six views over one investigation. Each answers a different question, and they all
        read from the same run.
      </p>
    </Reveal>

    <div className="mt-11 grid gap-4 md:grid-cols-3">
      {VIEWS.map((v, i) => (
        <Reveal key={v.name} delay={i * 55} className={v.wide ? 'md:col-span-2' : ''}>
          <article className={cn(
            'spot h-full rounded-[14px] border border-[var(--l-line)] bg-[var(--l-raised)]/60 p-6',
            'transition-colors duration-300 hover:border-[var(--l-accent)]/35',
          )}>
            <v.Icon size={18} strokeWidth={1.75} aria-hidden="true" className="text-[var(--l-accent)]" />
            <h3 className="mt-4 text-[15.5px] font-semibold">{v.name}</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--l-muted)]">{v.copy}</p>
          </article>
        </Reveal>
      ))}
    </div>
  </section>
)

/* ----------------------------------------------------------------- pipeline */

const STEPS = [
  { n: '01', Icon: ShieldAlert, t: 'Collect',
    d: 'Control-plane events, filtered to writes. No trail, no bucket, no extra infrastructure.' },
  { n: '02', Icon: GitCompare, t: 'Normalise',
    d: 'Nested API records become one readable sentence: what changed, which resource, who did it.' },
  { n: '03', Icon: Clock, t: 'Rank',
    d: 'Additive rules — time proximity, blast radius, production naming, destructiveness.' },
  { n: '04', Icon: Sparkles, t: 'Explain',
    d: 'Bedrock writes the assessment. If it is unavailable, the rule-derived analysis stands alone.' },
]

const Pipeline = () => (
  <section id="pipeline" className="mx-auto max-w-6xl scroll-mt-24 px-6 py-24">
    <Reveal>
      <h2 className="display text-[30px] font-semibold tracking-[-0.03em] md:text-[38px]">
        How it works
      </h2>
      <p className="mt-3 max-w-xl text-[14.5px] leading-relaxed text-[var(--l-muted)]">
        Four steps. The first three are deterministic, which is why the same window always
        produces the same ranking.
      </p>
    </Reveal>

    <Reveal variant="draw" className="mt-10" >
      <div className="beam" aria-hidden="true" />
    </Reveal>

    <ol className="mt-8 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
      {STEPS.map((s, i) => (
        <Reveal key={s.n} delay={i * 70}>
          <li className="list-none">
            <div className="flex items-center gap-2.5">
              <s.Icon size={15} strokeWidth={1.75} aria-hidden="true" className="text-[var(--l-accent)]" />
              <span className="font-mono text-[12px] text-[var(--l-faint)]">{s.n}</span>
            </div>
            <h3 className="mt-3 text-[15.5px] font-semibold">{s.t}</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--l-muted)]">{s.d}</p>
          </li>
        </Reveal>
      ))}
    </ol>

    <Reveal delay={120}>
      <dl className="mt-14 grid gap-px overflow-hidden rounded-[14px] bg-[var(--l-line)] sm:grid-cols-3">
        {[
          { v: 11, s: '', l: 'Change types understood' },
          { v: 100, s: '', l: 'Point relevance score, every point traceable' },
          { v: 0, s: '', l: 'Causal claims made' },
        ].map((m) => (
          <div key={m.l} className="bg-[var(--l-void)] px-6 py-7">
            <dd className="font-mono text-[30px] leading-none text-[var(--l-accent)]">
              <Counter to={m.v} suffix={m.s} />
            </dd>
            <dt className="mt-3 text-[12.5px] leading-relaxed text-[var(--l-muted)]">{m.l}</dt>
          </div>
        ))}
      </dl>
    </Reveal>
  </section>
)

/* ------------------------------------------------------------------ honesty */

const CLAIMS = [
  'Rankings reflect timing correlation and resource sensitivity — never proven causation.',
  'Graph links are drawn only where a change payload literally evidences them.',
  'Every point of a relevance score traces back to a named rule, not to a model.',
  'When the model is unavailable the interface says so, rather than passing rule output off as AI.',
]

const Honesty = () => (
  <section id="honesty" className="mx-auto max-w-6xl scroll-mt-24 px-6 py-24">
    <Reveal>
      <div className="spot relative overflow-hidden rounded-[18px] border border-[var(--l-line)]
                      bg-[var(--l-raised)]/45 p-8 md:p-12">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full"
             style={{ background: 'radial-gradient(circle, rgba(143,168,138,0.12), transparent 70%)' }}
             aria-hidden="true" />
        <h2 className="display relative text-[28px] font-semibold tracking-[-0.03em] md:text-[34px]">
          What it won’t claim
        </h2>
        <p className="relative mt-3 max-w-2xl text-[14.5px] leading-relaxed text-[var(--l-muted)]">
          During an outage, a tool that overstates its confidence sends people down the
          wrong path. These are the limits, stated up front.
        </p>
        <ul className="relative mt-8 grid gap-4 md:grid-cols-2">
          {CLAIMS.map((c) => (
            <li key={c} className="flex gap-3">
              <Check size={15} strokeWidth={2.25} aria-hidden="true"
                     className="mt-0.5 shrink-0 text-[var(--l-sage)]" />
              <span className="text-[13.5px] leading-relaxed text-[var(--l-muted)]">{c}</span>
            </li>
          ))}
        </ul>
      </div>
    </Reveal>
  </section>
)

const Closing = () => (
  <section className="relative overflow-hidden px-6 pb-28 pt-6 text-center">
    <div className="aurora opacity-60" aria-hidden="true" />
    <Reveal className="relative z-10">
      <h2 className="display text-[28px] font-semibold tracking-[-0.03em] md:text-[36px]">
        Start with the time it broke
      </h2>
      <p className="mx-auto mt-3 max-w-lg text-[14.5px] leading-relaxed text-[var(--l-muted)]">
        A demo incident is built in, so you can walk a complete investigation without
        connecting an account.
      </p>
      <div className="mt-8 flex justify-center">
        <Link to="/dashboard">
          <LButton variant="default" size="lg">
            Open the console
            <ArrowRight size={16} strokeWidth={2} aria-hidden="true"
                        className="transition-transform duration-200 group-hover/btn:translate-x-0.5" />
          </LButton>
        </Link>
      </div>
    </Reveal>
  </section>
)

export default function SaasTemplate() {
  return (
    <main data-surface="landing" className="relative min-h-screen overflow-x-hidden">
      <Navigation />
      <div className="relative z-[2]">
        <Hero />
        <Marquee />
        <Inside />
        <Pipeline />
        <Honesty />
        <Closing />
        <footer className="border-t border-[var(--l-line)] px-6 py-8">
          <p className="mx-auto max-w-6xl text-[11.5px] text-[var(--l-faint)]">
            Impact Guard — an investigation layer over CloudTrail, not a replacement for it.
          </p>
        </footer>
      </div>
    </main>
  )
}
