import type { CSSProperties } from 'react';
import { coords5 } from '@/lib/grid-coords';
import { loaderStyle, type LoaderProps } from '@/lib/loader-props';
import styles from './vector-index.module.css';

export function VectorIndex(props: LoaderProps = {}) {
  return (
    <div
      className={`loader ${styles.loader}${props.className ? ` ${props.className}` : ''}`}
      style={loaderStyle(props)}
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
