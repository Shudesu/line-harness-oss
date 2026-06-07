/**
 * Phase: UI 磨き込み (Polish v1)
 *
 * 軽量で再利用可能な UI プリミティブ。
 * shadcn/ui を入れる前段階として、最小限の API で
 * 既存 Tailwind v4 上に統一感のあるデザイン言語を作る。
 *
 * 設計方針:
 * - クラス名は forwardRef + variants で型安全に
 * - 装飾的なお洒落要素は避け、情報密度と読みやすさを優先
 * - キーボードナビゲーション・focus ring を必ず付ける
 */

import React from 'react'

// ─── classes ユーティリティ ────────────────────────────
export function cx(...args: Array<string | false | null | undefined>): string {
  return args.filter(Boolean).join(' ')
}

// ─── Button ─────────────────────────────────────────
type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-blue-500 disabled:bg-blue-300',
  secondary:
    'bg-gray-900 text-white hover:bg-gray-800 focus-visible:ring-gray-500 disabled:bg-gray-400',
  outline:
    'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus-visible:ring-gray-400 disabled:opacity-50',
  ghost:
    'text-gray-700 hover:bg-gray-100 focus-visible:ring-gray-400 disabled:opacity-50',
  danger:
    'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500 disabled:bg-red-300',
}

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-base',
}

export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant
    size?: ButtonSize
  }
>(({ className, variant = 'primary', size = 'md', ...props }, ref) => (
  <button
    ref={ref}
    className={cx(
      'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
      'disabled:cursor-not-allowed',
      buttonVariants[variant],
      buttonSizes[size],
      className,
    )}
    {...props}
  />
))
Button.displayName = 'Button'

// ─── Card ───────────────────────────────────────────
export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        'rounded-xl border border-gray-200 bg-white shadow-sm',
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx('px-5 pt-5 pb-3', className)}
      {...props}
    />
  )
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cx('text-base font-semibold text-gray-900', className)}
      {...props}
    />
  )
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cx('mt-1 text-sm text-gray-500', className)}
      {...props}
    />
  )
}

export function CardContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('px-5 pb-5', className)} {...props} />
}

export function CardFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        'flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3',
        className,
      )}
      {...props}
    />
  )
}

// ─── Badge ──────────────────────────────────────────
type BadgeTone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'

const badgeTones: Record<BadgeTone, string> = {
  default: 'bg-blue-50 text-blue-700 ring-blue-200',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  danger: 'bg-red-50 text-red-700 ring-red-200',
  info: 'bg-sky-50 text-sky-700 ring-sky-200',
  neutral: 'bg-gray-100 text-gray-700 ring-gray-200',
}

export function Badge({
  tone = 'default',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        badgeTones[tone],
        className,
      )}
      {...props}
    />
  )
}

// ─── Form primitives ─────────────────────────────────
export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cx(
        'block text-sm font-medium text-gray-700',
        className,
      )}
      {...props}
    />
  )
}

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cx(
      'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm',
      'placeholder:text-gray-400',
      'focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500',
      'disabled:bg-gray-50 disabled:text-gray-500',
      className,
    )}
    {...props}
  />
))
Input.displayName = 'Input'

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cx(
      'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm',
      'placeholder:text-gray-400',
      'focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500',
      'disabled:bg-gray-50 disabled:text-gray-500',
      className,
    )}
    {...props}
  />
))
Textarea.displayName = 'Textarea'

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cx(
      'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm',
      'focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500',
      'disabled:bg-gray-50 disabled:text-gray-500',
      className,
    )}
    {...props}
  >
    {children}
  </select>
))
Select.displayName = 'Select'

// ─── Banner (alert) ──────────────────────────────────
type BannerTone = 'info' | 'success' | 'warning' | 'danger'

const bannerTones: Record<BannerTone, string> = {
  info: 'border-blue-200 bg-blue-50 text-blue-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  danger: 'border-red-300 bg-red-50 text-red-800',
}

export function Banner({
  tone = 'info',
  title,
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { tone?: BannerTone; title?: string }) {
  // Codex P3 修正: tone に応じた ARIA role を付ける (支援技術への通知)
  const ariaRole = tone === 'danger' ? 'alert' : tone === 'warning' ? 'status' : undefined
  return (
    <div
      role={ariaRole}
      aria-live={ariaRole === 'alert' ? 'assertive' : ariaRole === 'status' ? 'polite' : undefined}
      className={cx(
        'rounded-lg border px-4 py-3 text-sm',
        bannerTones[tone],
        className,
      )}
      {...props}
    >
      {title && <p className="mb-1 font-medium">{title}</p>}
      <div>{children}</div>
    </div>
  )
}

// ─── Section (page-level grouping) ───────────────────
export function Section({
  title,
  description,
  action,
  className,
  children,
}: {
  title?: string
  description?: string
  action?: React.ReactNode
  className?: string
  children?: React.ReactNode
}) {
  return (
    <section className={cx('space-y-4', className)}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-4">
          <div>
            {title && (
              <h2 className="text-lg font-semibold tracking-tight text-gray-900">
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-0.5 text-sm text-gray-500">{description}</p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

// ─── EmptyState ──────────────────────────────────────
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
      <p className="text-base font-medium text-gray-900">{title}</p>
      {description && (
        <p className="mt-1 text-sm text-gray-500">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
