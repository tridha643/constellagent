/** Play / run triangle — inline SVG so it picks up `currentColor` from CSS. */
export function PlayIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M4.5 3.2c0-.86.93-1.4 1.68-.98l8.06 4.8c.76.45.76 1.5 0 1.96l-8.06 4.8c-.75.42-1.68-.12-1.68-.98V3.2z" />
    </svg>
  )
}
