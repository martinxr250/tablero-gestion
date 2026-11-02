export function Logo({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" className="fill-primary" />
      <rect x="7" y="8" width="5" height="16" rx="1.5" fill="white" />
      <rect x="13.5" y="8" width="5" height="11" rx="1.5" fill="white" opacity="0.8" />
      <rect x="20" y="8" width="5" height="7" rx="1.5" fill="white" opacity="0.6" />
    </svg>
  );
}
