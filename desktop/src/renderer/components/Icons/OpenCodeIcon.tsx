/** OpenCode delta logo — inline SVG for currentColor support */
export function OpenCodeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path d="M12 2.5 22 20.5H2L12 2.5ZM12 7.6 6.9 17H17.1L12 7.6Z" />
      <path d="M8.4 13.8H15.6V16.4H8.4V13.8Z" />
    </svg>
  )
}
