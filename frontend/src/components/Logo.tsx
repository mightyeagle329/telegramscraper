import Image from "next/image";

/**
 * Outpilot logo — uses the PNG mark from /public/logo.png next to a
 * wordmark when requested. Single source of truth: swap the file at
 * public/logo.png to refresh every site usage at once.
 *
 * The source PNG is 1536x1024 (3:2 aspect, with built-in padding around
 * the icon), so we render it at the requested HEIGHT and let width scale
 * proportionally — keeps it crisp on retina without distorting the mark.
 */
interface Props {
  /** Pixel height of the icon mark. Width auto-scales from PNG aspect. */
  size?: number;
  /** Show the "Outpilot" wordmark next to the icon. */
  withWordmark?: boolean;
  /** Tailwind class for the wordmark colour. */
  wordmarkClassName?: string;
}

const ASPECT = 1536 / 1024;

export default function Logo({
  size = 28,
  withWordmark = false,
  wordmarkClassName = "text-foreground",
}: Props) {
  const height = size;
  const width = Math.round(height * ASPECT);
  return (
    <span className="inline-flex items-center gap-2">
      <Image
        src="/logo.png"
        alt="Outpilot"
        width={width}
        height={height}
        priority
        sizes={`${width}px`}
        style={{ height, width: "auto" }}
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
