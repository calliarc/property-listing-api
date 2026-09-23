import { Type, type Static } from 'typebox';
import { Nullable, Uuid } from './common.js';

export const MEDIA_TYPES = ['image', 'video', 'floor_plan', 'virtual_tour'] as const;
const MediaType = Type.Enum(MEDIA_TYPES);

const HttpUrl = Type.String({ format: 'uri', pattern: '^https?://', maxLength: 2048 });

export const Media = Type.Object({
  id: Uuid,
  listing_id: Uuid,
  media_type: MediaType,
  url: Type.String(),
  caption: Nullable(Type.String()),
  position: Type.Integer(),
  created_at: Type.String({ format: 'date-time' }),
});
export type Media = Static<typeof Media>;

export const MediaCreate = Type.Object(
  {
    media_type: Type.Optional(MediaType),
    url: HttpUrl,
    caption: Type.Optional(Nullable(Type.String({ maxLength: 500 }))),
    position: Type.Optional(Type.Integer({ minimum: 0, maximum: 10_000 })),
  },
  { additionalProperties: false },
);
export type MediaCreate = Static<typeof MediaCreate>;

export const MediaUpdate = Type.Object(
  {
    media_type: Type.Optional(MediaType),
    url: Type.Optional(HttpUrl),
    caption: Type.Optional(Nullable(Type.String({ maxLength: 500 }))),
    position: Type.Optional(Type.Integer({ minimum: 0, maximum: 10_000 })),
  },
  { additionalProperties: false, minProperties: 1 },
);
export type MediaUpdate = Static<typeof MediaUpdate>;

export const MediaParams = Type.Object({ id: Uuid, mediaId: Uuid });
export type MediaParams = Static<typeof MediaParams>;
