import { Type, type Static } from 'typebox';
import { Nullable, PaginationQuery, Uuid } from './common.js';

const Email = Type.String({ format: 'email', maxLength: 254 });

export const Agent = Type.Object({
  id: Uuid,
  name: Type.String(),
  email: Type.String(),
  phone: Nullable(Type.String()),
  brokerage: Nullable(Type.String()),
  license_number: Nullable(Type.String()),
  created_at: Type.String({ format: 'date-time' }),
  updated_at: Type.String({ format: 'date-time' }),
});
export type Agent = Static<typeof Agent>;

export const AgentCreate = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 200 }),
    email: Email,
    phone: Type.Optional(Nullable(Type.String({ maxLength: 40 }))),
    brokerage: Type.Optional(Nullable(Type.String({ maxLength: 200 }))),
    license_number: Type.Optional(Nullable(Type.String({ maxLength: 100 }))),
  },
  { additionalProperties: false },
);
export type AgentCreate = Static<typeof AgentCreate>;

export const AgentUpdate = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    email: Type.Optional(Email),
    phone: Type.Optional(Nullable(Type.String({ maxLength: 40 }))),
    brokerage: Type.Optional(Nullable(Type.String({ maxLength: 200 }))),
    license_number: Type.Optional(Nullable(Type.String({ maxLength: 100 }))),
  },
  { additionalProperties: false, minProperties: 1 },
);
export type AgentUpdate = Static<typeof AgentUpdate>;

export const AgentListQuery = Type.Object({
  ...PaginationQuery,
  q: Type.Optional(Type.String({ minLength: 1, maxLength: 100, description: 'Case-insensitive search on name or brokerage' })),
});
export type AgentListQuery = Static<typeof AgentListQuery>;
