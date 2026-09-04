/** warden's mark, matching the dashboard — kept as one shared image, not redrawn per surface. */
export function Logo({ size = 22 }: { size?: number }) {
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
