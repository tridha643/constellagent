/** Theater spotlight — filled bulb housing on top, stroked beam cone fanning down. */
export function SpotlightIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
      strokeLinecap="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M6 1.8 L10 1.8 L10 4 L13.5 13.5 L2.5 13.5 L6 4 Z" />
      <rect x="6" y="1.8" width="4" height="2.4" fill="currentColor" stroke="none" />
    </svg>
  )
}
