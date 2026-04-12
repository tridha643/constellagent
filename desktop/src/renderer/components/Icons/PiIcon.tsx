/** Pi agent mark — inline SVG for currentColor support */
export function PiIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path d="M4 5.2H20V8.1H17.25V18.8H14.05V8.1H10.75V18.8H7.55V8.1H4V5.2Z" />
      <path d="M16.9 16.05C17.55 16.75 18.15 17.05 18.7 17.05C19.25 17.05 19.68 16.72 20 16.05L21.9 17.7C21.2 18.98 20.14 19.62 18.72 19.62C17.32 19.62 16.1 18.97 15.05 17.65L16.9 16.05Z" />
    </svg>
  )
}
