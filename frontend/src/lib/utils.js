import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * shadcn's class helper: conditional classes via clsx, then tailwind-merge to
 * resolve conflicts so a later utility genuinely overrides an earlier one.
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs))
}
