import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');

export const TopicSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  size: z.number().int().nonnegative(),
});

export type Topic = z.infer<typeof TopicSchema>;

export const TopicMemberSchema = z.object({
  documentId: z.string().min(1),
  title: z.string().min(1),
  date: isoDate,
});

export type TopicMember = z.infer<typeof TopicMemberSchema>;

export const TopicDriftPointSchema = z.object({
  topicId: z.string().min(1),
  period: z.string().min(1),
  documentCount: z.number().int().nonnegative(),
  share: z.number().min(0).max(1),
});

export type TopicDriftPoint = z.infer<typeof TopicDriftPointSchema>;

export const TopicsResponseSchema = z.object({
  items: z.array(TopicSchema),
  total: z.number().int().nonnegative(),
});

export type TopicsResponse = z.infer<typeof TopicsResponseSchema>;

export const TopicDetailResponseSchema = z.object({
  topic: TopicSchema,
  members: z.array(TopicMemberSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});

export type TopicDetailResponse = z.infer<typeof TopicDetailResponseSchema>;

export const TopicDriftResponseSchema = z.object({
  points: z.array(TopicDriftPointSchema),
});

export type TopicDriftResponse = z.infer<typeof TopicDriftResponseSchema>;
