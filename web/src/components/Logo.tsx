/**
 * The warden mark — a shield with a keyhole cut through it, in BNB Chain gold.
 * Shield = guarding the account; keyhole = the one key that opens it (the
 * owner key), everything else locked out. Fixed gold fill so the mark reads
 * the same regardless of surrounding text color.
 */

export function LogoMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ display: "inline-block", verticalAlign: "-0.15em" }}
    >
      {/* the shield */}
      <path
        d="M15,18 Q50,7 85,18 L85,46 Q85,76 50,95 Q15,76 15,46 Z"
        fill="var(--gold, #f0b90b)"
      />
      {/* the keyhole, cut through it */}
      <circle cx="50" cy="41" r="10.5" fill="var(--bg, #0b0e0a)" />
      <path d="M43.5,47 L56.5,47 L61,70 L39,70 Z" fill="var(--bg, #0b0e0a)" />
    </svg>
  );
}
