"use client";

/**
 * Reusable pagination controls. Client-side pagination — the parent slices
 * the data array based on `page` + `pageSize`.
 *
 * Usage:
 *   const [page, setPage] = useState(1);
 *   const [pageSize, setPageSize] = useState(25);
 *   const paginated = useMemo(
 *     () => rows.slice((page-1)*pageSize, page*pageSize),
 *     [rows, page, pageSize]
 *   );
 *   <Pagination
 *     total={rows.length} page={page} pageSize={pageSize}
 *     onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
 *   />
 */

interface Props {
  total: number;
  page: number;
  pageSize: number;
  pageSizeOptions?: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  label?: string; // e.g. "contacts", "accounts"
}

export default function Pagination({
  total,
  page,
  pageSize,
  pageSizeOptions = [10, 25, 50, 100],
  onPageChange,
  onPageSizeChange,
  label = "rows",
}: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const from = total === 0 ? 0 : (clampedPage - 1) * pageSize + 1;
  const to = Math.min(clampedPage * pageSize, total);

  const canPrev = clampedPage > 1;
  const canNext = clampedPage < totalPages;

  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 px-3 md:px-4 py-3 border-t border-card-border/40 text-sm">
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-text-muted">
          <span className="hidden sm:inline">Show</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="bg-background border border-card-border rounded-md px-2 py-1 text-foreground text-sm focus:outline-none focus:border-accent-green/50"
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <span className="hidden sm:inline">per page</span>
        </label>
        <span className="text-text-muted">
          {total === 0
            ? `No ${label}`
            : `${from}–${to} of ${total.toLocaleString()} ${label}`}
        </span>
      </div>

      <div className="flex items-center gap-1">
        <PageButton onClick={() => onPageChange(1)} disabled={!canPrev} aria-label="First page">
          «
        </PageButton>
        <PageButton onClick={() => onPageChange(clampedPage - 1)} disabled={!canPrev} aria-label="Previous page">
          ‹
        </PageButton>
        <span className="px-2 text-text-muted text-xs whitespace-nowrap">
          Page {clampedPage} / {totalPages}
        </span>
        <PageButton onClick={() => onPageChange(clampedPage + 1)} disabled={!canNext} aria-label="Next page">
          ›
        </PageButton>
        <PageButton onClick={() => onPageChange(totalPages)} disabled={!canNext} aria-label="Last page">
          »
        </PageButton>
      </div>
    </div>
  );
}

function PageButton({
  onClick,
  disabled,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-8 h-8 rounded-md border border-card-border bg-background hover:bg-card-border/40 disabled:opacity-40 disabled:cursor-not-allowed text-sm"
      {...rest}
    >
      {children}
    </button>
  );
}
