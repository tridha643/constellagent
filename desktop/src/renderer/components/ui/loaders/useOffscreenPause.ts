import { useEffect, useRef, useState } from 'react';

/**
 * Pauses decorative loader animations when their element is not actually
 * visible to the user. Returns a ref to attach to the loader's root element
 * and a `paused` boolean.
 *
 * `paused` is true when EITHER:
 *  - the element is scrolled offscreen / inside a hidden tab (IntersectionObserver
 *    reports `!isIntersecting` at threshold 0), or
 *  - the document/window is hidden (e.g. the app window is in the background),
 *    tracked via the `visibilitychange` event.
 *
 * Consumers wire this to the existing `[data-paused='true']` CSS hook in
 * grid.css, which sets `animation-play-state: paused` so the compositor stops
 * doing work for offscreen/hidden loaders.
 *
 * Degrades gracefully when IntersectionObserver / document are unavailable
 * (SSR or older environments): `paused` simply stays false and the loader
 * animates as before.
 */
export function useOffscreenPause<T extends Element = HTMLDivElement>(): {
  ref: React.RefObject<T | null>;
  paused: boolean;
} {
  const ref = useRef<T>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof document === 'undefined') return;

    // Whether the element is within the viewport. Defaults to true so that, if
    // IntersectionObserver is unavailable, we never pause an on-screen loader.
    let intersecting = true;
    // Whether the document is currently hidden (background window / tab).
    let docHidden = document.hidden;

    const apply = () => setPaused(!intersecting || docHidden);

    const onVisibility = () => {
      docHidden = document.hidden;
      apply();
    };
    document.addEventListener('visibilitychange', onVisibility);

    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[entries.length - 1];
          if (!entry) return;
          intersecting = entry.isIntersecting;
          apply();
        },
        { threshold: 0 },
      );
      observer.observe(el);
    }

    // Reflect the initial state immediately (e.g. window already backgrounded).
    apply();

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      observer?.disconnect();
    };
  }, []);

  return { ref, paused };
}
