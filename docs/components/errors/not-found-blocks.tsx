import { cn } from "@/lib/cn";

type BlockSurface = "canvas-soft" | "line" | "accent-muted" | "ink" | "accent";

type BlockSpec = {
  id: string;
  surface: BlockSurface;
  bordered?: boolean;
  width: number;
  height: number;
  iconDecoration: string;
  desktop: { left: string; bottom: number; rotate?: number; zIndex?: number };
  mobile: { left: string; bottom: number; rotate?: number; zIndex?: number; scale?: number };
  icon: "knobs" | "mark" | "curve" | "quotes" | "type" | "lock" | "wave" | "flow";
};

const SURFACE_CLASS: Record<BlockSurface, string> = {
  "canvas-soft": "bg-canvas-soft",
  line: "bg-line",
  "accent-muted": "bg-accent-muted",
  ink: "bg-ink",
  accent: "bg-accent",
};

const DARK_SURFACES = new Set<BlockSurface>(["ink", "accent"]);

const BLOCKS: BlockSpec[] = [
  {
    id: "knobs",
    surface: "canvas-soft",
    bordered: true,
    width: 88,
    height: 200,
    iconDecoration:
      "right-0 bottom-0 translate-x-1/4 translate-y-1/5 -rotate-12",
    desktop: { left: "4%", bottom: 0, zIndex: 2 },
    mobile: { left: "4%", bottom: 4, rotate: -8, zIndex: 3, scale: 0.58 },
    icon: "knobs",
  },
  {
    id: "mark",
    surface: "line",
    width: 96,
    height: 168,
    iconDecoration:
      "right-0 top-0 -translate-y-1/4 translate-x-1/3 rotate-[14deg]",
    desktop: { left: "13%", bottom: 0, zIndex: 3 },
    mobile: { left: "22%", bottom: 0, rotate: 5, zIndex: 5, scale: 0.56 },
    icon: "mark",
  },
  {
    id: "curve",
    surface: "accent-muted",
    width: 80,
    height: 220,
    iconDecoration:
      "left-0 bottom-0 -translate-x-1/4 translate-y-1/4 -rotate-[10deg]",
    desktop: { left: "22%", bottom: 0, zIndex: 1 },
    mobile: { left: "40%", bottom: 10, rotate: -10, zIndex: 2, scale: 0.54 },
    icon: "curve",
  },
  {
    id: "quotes",
    surface: "canvas-soft",
    bordered: true,
    width: 92,
    height: 176,
    iconDecoration:
      "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/3 rotate-6",
    desktop: { left: "31%", bottom: 0, zIndex: 4 },
    mobile: { left: "58%", bottom: 2, rotate: 7, zIndex: 6, scale: 0.58 },
    icon: "quotes",
  },
  {
    id: "type",
    surface: "line",
    width: 84,
    height: 192,
    iconDecoration:
      "right-0 bottom-0 translate-x-1/3 translate-y-1/4 rotate-90",
    desktop: { left: "40%", bottom: 0, zIndex: 2 },
    mobile: { left: "72%", bottom: 8, rotate: -5, zIndex: 4, scale: 0.52 },
    icon: "type",
  },
  {
    id: "lock",
    surface: "accent-muted",
    width: 76,
    height: 148,
    iconDecoration:
      "left-1/2 bottom-0 -translate-x-1/2 translate-y-1/4 -rotate-[8deg]",
    desktop: { left: "49%", bottom: 0, rotate: -8, zIndex: 5 },
    mobile: { left: "14%", bottom: 44, rotate: 12, zIndex: 7, scale: 0.5 },
    icon: "lock",
  },
  {
    id: "wave",
    surface: "canvas-soft",
    bordered: true,
    width: 88,
    height: 164,
    iconDecoration:
      "right-0 top-1/2 -translate-y-1/2 translate-x-1/4 rotate-[12deg]",
    desktop: { left: "58%", bottom: 0, zIndex: 3 },
    mobile: { left: "48%", bottom: 48, rotate: -14, zIndex: 1, scale: 0.48 },
    icon: "wave",
  },
  {
    id: "flow",
    surface: "ink",
    width: 100,
    height: 208,
    iconDecoration:
      "left-0 top-0 -translate-x-1/5 -translate-y-1/5 rotate-[6deg]",
    desktop: { left: "67%", bottom: 0, zIndex: 4 },
    mobile: { left: "64%", bottom: 40, rotate: 4, zIndex: 2, scale: 0.54 },
    icon: "flow",
  },
  {
    id: "mark-2",
    surface: "accent",
    width: 72,
    height: 156,
    iconDecoration:
      "right-0 bottom-0 translate-x-1/3 translate-y-1/5 -rotate-[16deg]",
    desktop: { left: "76%", bottom: 0, zIndex: 2 },
    mobile: { left: "42%", bottom: 56, rotate: -5, zIndex: 3, scale: 0.44 },
    icon: "mark",
  },
  {
    id: "curve-2",
    surface: "line",
    width: 68,
    height: 132,
    iconDecoration:
      "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-[18deg]",
    desktop: { left: "85%", bottom: 0, rotate: 6, zIndex: 1 },
    mobile: { left: "62%", bottom: 52, rotate: 8, zIndex: 4, scale: 0.42 },
    icon: "curve",
  },
];

function BlockIcon({
  type,
  className,
}: {
  type: BlockSpec["icon"];
  className?: string;
}) {
  switch (type) {
    case "knobs":
      return (
        <svg
          viewBox="0 0 48 64"
          fill="none"
          className={className}
          aria-hidden
        >
          <circle cx="24" cy="18" r="10" fill="currentColor" />
          <circle cx="24" cy="46" r="10" fill="currentColor" />
        </svg>
      );
    case "mark":
      return (
        <svg
          viewBox="0 0 48 52"
          fill="none"
          className={className}
          aria-hidden
        >
          <path
            d="M26.5 7.5C30.5 9.8 32 14.5 29.7 18.5L19.2 38.5L12.5 34.6C8.5 32.3 7 27.6 9.3 23.6L19.8 3.6L26.5 7.5Z"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            d="M38.5 41.2C36.4 44.8 32.2 46.1 28.6 44L14.2 35.7L17.6 29.2C19.7 25.6 23.9 24.3 27.5 26.4L41.9 34.7L38.5 41.2Z"
            stroke="currentColor"
            strokeWidth="4"
          />
        </svg>
      );
    case "curve":
      return (
        <svg
          viewBox="0 0 56 72"
          fill="none"
          className={className}
          aria-hidden
        >
          <path
            d="M8 56C8 56 16 12 44 16C56 18 52 48 28 52"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="8" cy="56" r="4" fill="currentColor" />
          <circle cx="44" cy="16" r="4" fill="currentColor" />
          <circle cx="28" cy="52" r="4" fill="currentColor" />
        </svg>
      );
    case "quotes":
      return (
        <svg
          viewBox="0 0 48 56"
          fill="currentColor"
          className={className}
          aria-hidden
        >
          <path d="M14 38C14 28 18 20 26 16V10C14 14 8 24 8 36V46H16V38H14Z" />
          <path d="M38 38C38 28 42 20 48 16V10C36 14 30 24 30 36V46H38V38Z" />
        </svg>
      );
    case "type":
      return (
        <svg
          viewBox="0 0 64 48"
          fill="currentColor"
          className={className}
          aria-hidden
        >
          <text
            x="4"
            y="40"
            fontSize="36"
            fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
            fontWeight="600"
          >
            Aa
          </text>
        </svg>
      );
    case "lock":
      return (
        <svg
          viewBox="0 0 48 56"
          fill="none"
          className={className}
          aria-hidden
        >
          <rect
            x="12"
            y="24"
            width="24"
            height="24"
            rx="4"
            fill="currentColor"
          />
          <path
            d="M16 24V18C16 12.5 20.5 8 26 8C31.5 8 36 12.5 36 18V24"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </svg>
      );
    case "wave":
      return (
        <svg
          viewBox="0 0 56 48"
          fill="none"
          className={className}
          aria-hidden
        >
          <path
            d="M6 32C14 20 22 40 30 28C38 16 46 36 50 24"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <circle cx="44" cy="12" r="5" fill="currentColor" opacity="0.5" />
        </svg>
      );
    case "flow":
      return (
        <svg
          viewBox="0 0 56 56"
          fill="none"
          className={className}
          aria-hidden
        >
          <path
            d="M28 8L48 44H8L28 8Z"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <circle cx="28" cy="8" r="4" fill="currentColor" />
          <circle cx="48" cy="44" r="4" fill="currentColor" />
          <circle cx="8" cy="44" r="4" fill="currentColor" />
        </svg>
      );
  }
}

function NotFoundBlock({
  block,
  variant,
  index,
}: {
  block: BlockSpec;
  variant: "desktop" | "mobile";
  index: number;
}) {
  const layout = variant === "desktop" ? block.desktop : block.mobile;
  const scale = variant === "mobile" ? (block.mobile.scale ?? 1) : 1;
  const width = block.width * scale;
  const height = block.height * scale;
  const isDark = DARK_SURFACES.has(block.surface);

  return (
    <div
      className={cn(
        "not-found-block absolute",
        variant === "desktop" ? "hidden md:block" : "block md:hidden",
      )}
      style={{
        left: layout.left,
        bottom: layout.bottom,
        zIndex: layout.zIndex ?? 1,
        animationDelay: `${120 + index * 55}ms`,
      }}
      aria-hidden
    >
      <div
        className={cn(
          "relative overflow-hidden",
          SURFACE_CLASS[block.surface],
          block.bordered && "border border-line",
        )}
        style={{
          width,
          height,
          transform: layout.rotate ? `rotate(${layout.rotate}deg)` : undefined,
          transformOrigin: "center bottom",
        }}
      >
        <div
          className={cn(
            "pointer-events-none absolute",
            block.iconDecoration,
            isDark ? "text-canvas opacity-[0.12]" : "text-ink opacity-[0.08]",
          )}
        >
          <BlockIcon
            type={block.icon}
            className={
              variant === "desktop"
                ? "h-64 w-64 min-h-64 min-w-64"
                : "h-40 w-40 min-h-40 min-w-40"
            }
          />
        </div>
      </div>
    </div>
  );
}

export function NotFoundBlocks() {
  return (
    <div
      className="pointer-events-none relative mx-auto h-[min(38vh,280px)] w-full max-w-6xl shrink-0 md:h-[min(42vh,320px)]"
      aria-hidden
    >
      {BLOCKS.map((block, index) => (
        <NotFoundBlock
          key={`${block.id}-desktop`}
          block={block}
          variant="desktop"
          index={index}
        />
      ))}
      {BLOCKS.slice(0, 8).map((block, index) => (
        <NotFoundBlock
          key={`${block.id}-mobile`}
          block={block}
          variant="mobile"
          index={index}
        />
      ))}
    </div>
  );
}
