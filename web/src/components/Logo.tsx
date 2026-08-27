/**
 * The warden mark — the agent's own headshot. Was a drawn shield-and-keyhole
 * vector; swapped for the actual character portrait used everywhere else
 * (the download landing page, the Twitter/X profile) so the mark is
 * consistent across every surface instead of two different logos.
 */

export function LogoMark({ size = 18 }: { size?: number }) {
  return (
    <img
      src="/robot-mark.jpg"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      style={{
        display: "inline-block",
        verticalAlign: "-0.15em",
        borderRadius: "50%",
        objectFit: "cover",
        border: "1px solid var(--gold, #f0b90b)",
      }}
    />
  );
}
