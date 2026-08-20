export default function Logo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id="logo-g" x1="0" y1="0" x2="32" y2="32">
          <stop stopColor="#60A5FA" />
          <stop offset="1" stopColor="#22D3EE" />
        </linearGradient>
      </defs>
      <rect
        x="1.25"
        y="1.25"
        width="29.5"
        height="29.5"
        rx="8.5"
        stroke="url(#logo-g)"
        strokeWidth="1.5"
        opacity="0.65"
      />
      <circle cx="16" cy="16" r="6.4" stroke="url(#logo-g)" strokeWidth="1.6" />
      <circle cx="16" cy="16" r="2.1" fill="url(#logo-g)" />
      <path
        d="M16 3.6v3.2M16 25.2v3.2M3.6 16h3.2M25.2 16h3.2"
        stroke="url(#logo-g)"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
