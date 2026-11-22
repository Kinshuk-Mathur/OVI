const LOGO_IMAGE = "/Refined%20Terracotta%20OVI%20Logo.png";

export function LogoFilter() {
  return (
    <svg className="logo-filter" aria-hidden="true" focusable="false" width="0" height="0">
      <filter id="ovi-logo-background" colorInterpolationFilters="sRGB">
        <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  -1 -1 -1 0 2.45" />
      </filter>
    </svg>
  );
}

export function FlowerMark({ className = "" }: { className?: string }) {
  return <span className={`ovi-flower ${className}`} aria-hidden="true"><img src={LOGO_IMAGE} alt="" /></span>;
}

export function OVILogo() {
  return <a className="ovi-logo" href="/" aria-label="OVI, Talk to OVI"><span className="ovi-logo-crop"><img src={LOGO_IMAGE} alt="" /></span></a>;
}
