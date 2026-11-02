export function Logo({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" className="fill-primary" />
      <rect x="1" y="1" width="30" height="15" rx="8" fill="white" opacity="0.08" />
      <rect x="7" y="8" width="5" height="16" rx="2" fill="white" />
      <rect x="13.5" y="8" width="5" height="11" rx="2" fill="white" opacity="0.85" />
      <rect x="20" y="8" width="5" height="7" rx="2" fill="white" opacity="0.65" />
    </svg>
  );
}
