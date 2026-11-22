export function FlowerMark({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 72 72" fill="currentColor" aria-hidden="true">
      <path d="M34.5 33.6C21.3 35 3.9 29.7 4 12.4 4 5.8 7.3 4 13 4c17.1-.1 22.5 15.5 21.5 29.6Z" />
      <path d="M37.5 33.6C50.7 35 68.1 29.7 68 12.4 68 5.8 64.7 4 59 4 41.9 3.9 36.5 19.5 37.5 33.6Z" />
      <path d="M34.5 38.4C21.3 37 3.9 42.3 4 59.6 4 66.2 7.3 68 13 68c17.1.1 22.5-15.5 21.5-29.6Z" />
      <path d="M37.5 38.4C50.7 37 68.1 42.3 68 59.6c0 6.6-3.3 8.4-9 8.4-17.1.1-22.5-15.5-21.5-29.6Z" />
    </svg>
  );
}

export function OVILogo() {
  return <a className="ovi-logo" href="/" aria-label="OVI, Talk to OVI"><FlowerMark className="logo-flower" /><span>OVI</span></a>;
}
