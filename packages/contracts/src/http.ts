/**
 * Enveloppe HTTP standard partagee api <-> web.
 * Reference : docs/foundation/01-architecture.md §5.2.
 */

export interface ApiErrorBody {
  correlationId: string;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiSuccessEnvelope<T> {
  correlationId: string;
  data: T;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
