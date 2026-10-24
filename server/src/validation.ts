import {
  CATEGORY_IDS,
  DEAL_TYPE_IDS,
  MAX_RADIUS,
  MIN_RADIUS,
  SORT_IDS,
  isValidDate,
  isValidTime,
  type CategoryId,
  type DealTypeId,
  type SortId,
} from '@sale-radar/shared';
import { z } from 'zod';

const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);

const bool = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => (v === undefined || v === '' ? undefined : v === true || v === '1' || v === 'true'));

const csvEnum = <T extends string>(values: readonly T[]) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v
        ? (v
            .split(',')
            .map((s) => s.trim())
            .filter((s): s is T => (values as readonly string[]).includes(s)) as T[])
        : undefined,
    );

const radius = z.coerce
  .number()
  .optional()
  .transform((v) => Math.round(Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, v ?? 500))));

export const searchQuerySchema = z.object({
  lat,
  lng,
  radius,
  categories: csvEnum<CategoryId>(CATEGORY_IDS),
  types: csvEnum<DealTypeId>(DEAL_TYPE_IDS),
  q: z.string().max(60).optional(),
  sort: z
    .string()
    .optional()
    .transform((v) => (v && (SORT_IDS as string[]).includes(v) ? (v as SortId) : undefined)),
  sample: bool,
  active: bool,
  minDiscount: z.coerce.number().min(0).max(100).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
});

export const pointSchema = z.object({ lat, lng, radius });

export const textQuerySchema = z.object({
  q: z.string().trim().min(1).max(60),
  lat: lat.optional(),
  lng: lng.optional(),
  radius,
});

const price = z.coerce.number().int().min(0).max(100_000_000).optional();
const optText = (max: number) => z.string().trim().max(max).optional();

export const createDealSchema = z
  .object({
    store: z.object({
      id: z.string().max(120).optional(),
      name: z.string().trim().min(1, '매장 이름을 입력해 주세요').max(60),
      lat,
      lng,
      category: z.enum(CATEGORY_IDS as [CategoryId, ...CategoryId[]]),
      address: optText(120),
      phone: optText(30),
    }),
    title: z.string().trim().min(2, '행사 제목을 2자 이상 입력해 주세요').max(80),
    type: z.enum(DEAL_TYPE_IDS as [DealTypeId, ...DealTypeId[]]),
    productName: optText(60),
    description: optText(500),
    originalPrice: price,
    salePrice: price,
    discountRate: z.coerce.number().min(0).max(100).optional(),
    unit: optText(30),
    startDate: z
      .string()
      .optional()
      .refine((v) => !v || isValidDate(v), '시작일 형식이 올바르지 않습니다'),
    endDate: z
      .string()
      .optional()
      .refine((v) => !v || isValidDate(v), '종료일 형식이 올바르지 않습니다'),
    timeStart: z
      .string()
      .optional()
      .refine((v) => !v || isValidTime(v), '시작 시간 형식이 올바르지 않습니다 (HH:MM)'),
    timeEnd: z
      .string()
      .optional()
      .refine((v) => !v || isValidTime(v), '종료 시간 형식이 올바르지 않습니다 (HH:MM)'),
    days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    tags: z.array(z.string().max(20)).max(8).optional(),
  })
  .transform((v) => ({
    ...v,
    startDate: v.startDate || undefined,
    endDate: v.endDate || undefined,
    timeStart: v.timeStart || undefined,
    timeEnd: v.timeEnd || undefined,
  }))
  .refine((v) => !v.startDate || !v.endDate || v.startDate <= v.endDate, {
    message: '종료일이 시작일보다 빠릅니다',
    path: ['endDate'],
  })
  .refine((v) => Boolean(v.timeStart) === Boolean(v.timeEnd), {
    message: '시간대는 시작과 종료를 함께 입력해 주세요',
    path: ['timeEnd'],
  })
  .refine((v) => !v.originalPrice || v.salePrice === undefined || v.salePrice <= v.originalPrice, {
    message: '할인가가 정가보다 비쌉니다',
    path: ['salePrice'],
  });

export const voteSchema = z.object({ action: z.enum(['like', 'confirm', 'expired']) });

/** zod 오류를 사용자에게 보여줄 한 줄 메시지로 */
export function formatZodError(err: z.ZodError): string {
  return err.issues.map((i) => i.message).join(', ');
}
