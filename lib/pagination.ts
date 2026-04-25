export interface PaginationMeta {
  page: number
  perPage: number
  total: number
  totalPages: number
  start: number
  end: number
}

export function normalizePositivePage(value: string | number | null | undefined): number {
  const parsed = typeof value === 'number' ? value : parseInt(value ?? '1', 10)
  if (!Number.isFinite(parsed)) return 1
  return Math.max(1, Math.floor(parsed))
}

export function getPaginationMeta(total: number, page: number, perPage: number): PaginationMeta {
  const safeTotal = Math.max(0, Math.floor(total))
  const safePage = normalizePositivePage(page)
  const safePerPage = Math.max(1, Math.floor(perPage))
  const totalPages = Math.ceil(safeTotal / safePerPage)

  if (safeTotal === 0) {
    return {
      page: safePage,
      perPage: safePerPage,
      total: safeTotal,
      totalPages,
      start: 0,
      end: 0,
    }
  }

  const start = (safePage - 1) * safePerPage + 1
  const end = Math.min(safePage * safePerPage, safeTotal)

  return {
    page: safePage,
    perPage: safePerPage,
    total: safeTotal,
    totalPages,
    start,
    end,
  }
}
