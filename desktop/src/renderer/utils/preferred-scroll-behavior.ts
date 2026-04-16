/**
 * Scroll APIs ignore CSS `scroll-behavior`; honor `prefers-reduced-motion` in JS.
 */
export function getPreferredScrollBehavior(): ScrollBehavior {
  if (typeof window === 'undefined') return 'auto'
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}
