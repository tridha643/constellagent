const STROKE = 1.5

export function CursorMutateDocIcon() {
  return (
    <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden>
      <path d="M6 3h8l4 4v14a0 0 0 0 1 0 0H6a0 0 0 0 1 0 0V3Z" strokeLinejoin="round" />
      <path d="M14 3v4h4" strokeLinejoin="round" />
      <path d="M16.5 14.5l-5 5M14 17l2.5-2.5" strokeLinecap="round" />
    </svg>
  )
}

export function CursorReadDocIcon() {
  return (
    <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden>
      <path d="M6 3h8l4 4v14a0 0 0 0 1 0 0H6a0 0 0 0 1 0 0V3Z" strokeLinejoin="round" />
      <path d="M14 3v4h4" strokeLinejoin="round" />
      <path d="M8.5 12h7M8.5 15.5h7" strokeLinecap="round" />
    </svg>
  )
}

export function CursorListDocIcon() {
  return (
    <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden>
      <path d="M6 3h8l4 4v14a0 0 0 0 1 0 0H6a0 0 0 0 1 0 0V3Z" strokeLinejoin="round" />
      <path d="M14 3v4h4" strokeLinejoin="round" />
      <circle cx="17" cy="17" r="3.5" />
      <path d="m19.2 19.2 2.3 2.3" strokeLinecap="round" />
    </svg>
  )
}

export function CursorBashIcon() {
  return (
    <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={STROKE} aria-hidden>
      <path d="M5 7l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 15h8" strokeLinecap="round" />
    </svg>
  )
}
