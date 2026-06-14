export type Pagination = {
  page: number;
  pageSize: number;
  offset: number;
  total: number;
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
  // 1-based inclusive range of the current page, e.g. "1–50 of 213". Both 0 when
  // there are no rows.
  from: number;
  to: number;
};

// Parse an untrusted `?page=` value to a 1-based integer, defaulting to 1.
export function parsePage(raw: string | null | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

// Clamp a requested page to the valid range for `total` rows and derive the
// offset and display range. Page is clamped to [1, totalPages] so an
// out-of-range `?page=` never yields an empty view.
export function paginate(total: number, requestedPage: number, pageSize: number): Pagination {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const offset = (page - 1) * pageSize;
  return {
    page,
    pageSize,
    offset,
    total,
    totalPages,
    hasPrev: page > 1,
    hasNext: page < totalPages,
    from: total === 0 ? 0 : offset + 1,
    to: Math.min(offset + pageSize, total),
  };
}
