export function reportPageOffset(page: number, size: number): number {
  return (page - 1) * size;
}

export function reportTotalPages(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / size));
}

export function clampReportPage(page: number, total: number, size: number): number {
  return Math.min(Math.max(1, page), reportTotalPages(total, size));
}
