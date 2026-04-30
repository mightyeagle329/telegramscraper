/**
 * Outpilot logo — placeholder while the final mark is being designed.
 *
 * The mark is a rounded square containing a north-east chevron, suggesting
 * outbound motion / outreach. Single accent colour means it works on dark
 * and light backgrounds and reads cleanly at favicon size (16-32px).
 *
 * Swap this file's SVG out when the final logo lands; the export shape +
 * usage sites stay the same.
 */
interface Props {
  /** Pixel size of the icon mark (height = width). Defaults to 28. */
  size?: number;
  /** Show the wordmark next to the icon. Use on landing/header, not favicon. */
  withWordmark?: boolean;
  /** Tailwind class for the icon fill colour (defaults to accent-green). */
  iconClassName?: string;
  /** Tailwind class for the wordmark colour (defaults to foreground). */
  wordmarkClassName?: string;
}

export default function Logo({
  size = 28,
  withWordmark = false,
  iconClassName = "text-accent-green",
  wordmarkClassName = "text-foreground",
}: Props) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg
        viewBox="0 0 32 32"
        width={size}
        height={size}
        aria-hidden="true"
        className={iconClassName}
      >
        <rect width="32" height="32" rx="7" fill="currentColor" />
        <path
          d="M10.5 21.5 L21.5 10.5"
          stroke="white"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        <path
          d="M14.5 10.5 L21.5 10.5 L21.5 17.5"
          stroke="white"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
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
