// Serialization helpers: map Prisma objects to plain JSON for the frontend.

import type { Tweet, XUser } from '@prisma/client';

export interface TweetAuthorDTO {
  handle: string;
  name: string;
  avatarColor: string;
  isBot: boolean;
  isVerified: boolean;
  bio: string;
}

export interface TweetDTO {
  id: string;
  xid: string;
  author: TweetAuthorDTO;
  content: string;
  imageUrl: string | null;
  parentId: string | null;
  quotedId: string | null;
  quoted?: TweetDTO | null;
  isBot: boolean;
  botModel: string | null;
  botCommand: string | null;
  botRunId: string | null;
  threadIndex: number;
  threadTotal: number;
  sources: { title: string; url: string; host: string; snippet?: string }[] | null;
  mentionTarget: string | null;
  createdAt: string;
  replyCount: number;
}

export function serializeAuthor(u: XUser): TweetAuthorDTO {
  return {
    handle: u.handle,
    name: u.name,
    avatarColor: u.avatarColor,
    isBot: u.isBot,
    isVerified: u.isVerified,
    bio: u.bio,
  };
}

type TweetWithAuthor = Tweet & { author: XUser; quoted?: (Tweet & { author: XUser }) | null; _count?: { replies: number } };

export function serializeTweet(t: TweetWithAuthor): TweetDTO {
  return {
    id: t.id,
    xid: t.xid,
    author: serializeAuthor(t.author),
    content: t.content,
    imageUrl: t.imageUrl,
    parentId: t.parentId,
    quotedId: t.quotedId,
    quoted: t.quoted ? serializeTweet(t.quoted) : null,
    isBot: t.isBot,
    botModel: t.botModel,
    botCommand: t.botCommand,
    botRunId: t.botRunId,
    threadIndex: t.threadIndex,
    threadTotal: t.threadTotal,
    sources: t.sources ? safeParse(t.sources) : null,
    mentionTarget: t.mentionTarget,
    createdAt: t.createdAt.toISOString(),
    replyCount: t._count?.replies ?? 0,
  };
}

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
