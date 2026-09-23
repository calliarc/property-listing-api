import { Type, type Static, type TSchema } from 'typebox';

export const Uuid = Type.String({ format: 'uuid' });

export const IdParams = Type.Object({ id: Uuid });
export type IdParams = Static<typeof IdParams>;

export const PaginationQuery = {
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1, description: 'Page number (1-based)' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20, description: 'Page size (max 100)' })),
};

export const PageMeta = Type.Object({
  page: Type.Integer(),
  limit: Type.Integer(),
  total: Type.Integer(),
  total_pages: Type.Integer(),
});
export type PageMeta = Static<typeof PageMeta>;

export const ErrorResponse = Type.Object(
  {
    statusCode: Type.Integer(),
    error: Type.String(),
    message: Type.String(),
    code: Type.Optional(Type.String()),
  },
  { $id: 'ErrorResponse' },
);

export function Nullable<T extends TSchema>(schema: T) {
  return Type.Union([schema, Type.Null()]);
}

export function Paginated<T extends TSchema>(item: T) {
  return Type.Object({ data: Type.Array(item), meta: PageMeta });
}

/** Standard error responses referenced by route schemas. */
export const errorResponses = {
  400: Type.Ref('ErrorResponse'),
  401: Type.Ref('ErrorResponse'),
  404: Type.Ref('ErrorResponse'),
  409: Type.Ref('ErrorResponse'),
  429: Type.Ref('ErrorResponse'),
};

export function pageMeta(page: number, limit: number, total: number): PageMeta {
  return { page, limit, total, total_pages: total === 0 ? 0 : Math.ceil(total / limit) };
}
