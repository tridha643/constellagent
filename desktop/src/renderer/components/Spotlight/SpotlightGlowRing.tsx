import type { SpotlightState } from '../../../shared/spotlight-types'
import styles from './Spotlight.module.css'

/**
 * Soft halo applied as `box-shadow` on the spotlighted sidebar workspace row so
 * it's identifiable across the sidebar without staring at the dot. Color tracks
 * the dot's state. Static once visible — pulsing two things at once is noise.
 */
export function SpotlightGlowRing({ state }: { state: SpotlightState }) {
  if (state === 'idle') return null
  return <span aria-hidden className={[styles.glow, styles[`glow_${state}`]].join(' ')} />
}
