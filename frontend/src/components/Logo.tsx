import Image from "next/image";

/**
 * Outpilot logo — uses the symbol-only mark from /public/logo-mark.png
 * (single-colour green silhouette on transparent) next to an optional
 * wordmark.
 *
 * Why /logo-mark.png and not /logo.png?
 *   /logo.png is the stamped "app icon" badge (green plate + white
 *   reticle). It looks great as a favicon but reads as a sticker on
 *   inline web headers, especially in dark mode. /logo-mark.png is the
 *   same symbol re-rendered as a flat single-colour mark on transparent —
 *   modern web brand pattern (Linear/Stripe/Vercel) that adapts cleanly
 *   to any background.
 *
 * Swap public/logo-mark.png to update every inline usage at once.
 */
interface Props {
  /** Pixel height of the icon mark. Width auto-scales from PNG aspect. */
  size?: number;
  /** Show the "Outpilot" wordmark next to the icon. */
  withWordmark?: boolean;
  /** Tailwind class for the wordmark colour. */
  wordmarkClassName?: string;
}

// Source PNG is 1254x1254 (square), so the rendered mark is a square block
// matching `size` exactly.
export default function Logo({
  size = 28,
  withWordmark = false,
  wordmarkClassName = "text-foreground",
}: Props) {
  return (
    <span className="inline-flex items-center gap-2">
      <Image
        src="/logo-mark.png"
        alt="Outpilot"
        width={size}
        height={size}
        priority
        sizes={`${size}px`}
        style={{ height: size, width: size }}
      />
      {withWordmark ? (
        <span
          className={`text-lg md:text-xl font-bold tracking-tight ${wordmarkClassName}`}
        >
          Outpilot
        </span>
      ) : null}
    </span>
  );
}
