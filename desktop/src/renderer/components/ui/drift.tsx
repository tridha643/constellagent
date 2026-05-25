import type { CSSProperties } from 'react';
import { coords5 } from '@/lib/grid-coords';
import { loaderStyle, type LoaderProps } from '@/lib/loader-props';
import { useOffscreenPause } from './loaders/useOffscreenPause';
import styles from './drift.module.css';

export function Drift(props: LoaderProps = {}) {
  const { ref, paused } = useOffscreenPause();
  return (
    <div
      ref={ref}
      className={`loader ${styles.loader}${props.className ? ` ${props.className}` : ''}`}
      style={loaderStyle(props)}
      data-paused={paused ? 'true' : undefined}
      role='status'
      aria-label={props['aria-label'] ?? 'Loading'}
    >
      {coords5.map((c) => (
        <span
          key={c.i}
          className='dot'
          style={{ '--diag': c.diag } as CSSProperties}
        />
      ))}
    </div>
  );
}
