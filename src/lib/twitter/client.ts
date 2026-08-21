// Twitter API v2 client wrapper (uses twitter-api-v2).
// - Bearer token (app-only) for READS: search mentions, fetch tweet context, fetch users.
// - OAuth 1.0a user context (access token + secret) for WRITES: post reply tweets.
// Posting is automatically disabled when access tokens are absent (read-only mode).

import { TwitterApi, type TweetV2, type UserV2 } from 'twitter-api-v2';

const BEARER = process.env.TWITTER_BEARER_TOKEN || '';
const API_KEY = process.env.TWITTER_API_KEY || '';
const API_SECRET = process.env.TWITTER_API_KEY_SECRET || '';
const ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN || '';
const ACCESS_SECRET = process.env.TWITTER_ACCESS_TOKEN_SECRET || '';
export const BOT_HANDLE = (process.env.TWITTER_BOT_HANDLE || '').trim().replace(/^@/, '');

export function twitterConfigured(): boolean {
  return !!BEARER && !!API_KEY && !!API_SECRET;
}

export function postingEnabled(): boolean {
  return twitterConfigured() && !!ACCESS_TOKEN && !!ACCESS_SECRET && !!BOT_HANDLE;
}

export function twitterStatus() {
  return {
    configured: twitterConfigured(),
    botHandle: BOT_HANDLE || null,
    postingEnabled: postingEnabled(),
    hasBearer: !!BEARER,
    hasUserContext: !!ACCESS_TOKEN && !!ACCESS_SECRET,
  };
}

function bearerClient(): TwitterApi {
  return new TwitterApi(BEARER);
}

function userClient(): TwitterApi {
  if (!postingEnabled()) {
    throw new Error('Twitter posting disabled: set TWITTER_ACCESS_TOKEN + TWITTER_ACCESS_TOKEN_SECRET + TWITTER_BOT_HANDLE');
  }
  return new TwitterApi({
    appKey: API_KEY,
    appSecret: API_SECRET,
    accessToken: ACCESS_TOKEN,
    accessSecret: ACCESS_SECRET,
  });
}

export async function getBotUser(): Promise<UserV2 | null> {
  if (!BOT_HANDLE) return null;
  const c = bearerClient();
  const u = await c.v2.userByUsername(BOT_HANDLE, {
    'user.fields': ['id', 'name', 'username', 'verified', 'profile_image_url', 'description'],
  });
  return (u.data as UserV2) || null;
}

export async function searchMentions(
  sinceId?: string,
): Promise<{ tweets: TweetV2[]; newestId: string | null }> {
  if (!BOT_HANDLE) return { tweets: [], newestId: null };
  const c = bearerClient();
  const query = `@${BOT_HANDLE} -is:retweet`;
  const params: Record<string, unknown> = {
    max_results: 25,
    'tweet.fields': [
      'id',
      'text',
      'author_id',
      'created_at',
      'in_reply_to_user_id',
      'referenced_tweets',
      'entities',
      'attachments',
    ],
    expansions: ['author_id', 'referenced_tweets.id', 'attachments.media_keys'],
    'user.fields': ['id', 'name', 'username', 'verified', 'profile_image_url'],
    // NOTE: Twitter API rejects 'media_url' in media.fields. Use 'url' (which maps to media_url_https)
    // and 'preview_image_url' instead.
    'media.fields': ['url', 'preview_image_url', 'type', 'media_key'],
  };
  if (sinceId) params.since_id = sinceId;
  const res = await c.v2.search(query, params as any);
  const tweets = (res.tweets as TweetV2[]) || [];
  let newestId: string | null = sinceId || null;
  for (const t of tweets) {
    if (!newestId || BigInt(t.id) > BigInt(newestId)) newestId = t.id;
  }
  return { tweets, newestId };
}

export async function getTweetWithContext(
  id: string,
): Promise<{
  tweet: TweetV2;
  author: UserV2 | null;
  referenced: TweetV2[];
  users: UserV2[];
  includes: any;
}> {
  const c = bearerClient();
  const res: any = await c.v2.singleTweet(id, {
    'tweet.fields': [
      'id',
      'text',
      'author_id',
      'created_at',
      'in_reply_to_user_id',
      'referenced_tweets',
      'entities',
      'attachments',
    ],
    expansions: ['author_id', 'referenced_tweets.id', 'attachments.media_keys'],
    'user.fields': ['id', 'name', 'username', 'verified', 'profile_image_url'],
    'media.fields': ['url', 'preview_image_url', 'type', 'media_key'],
  } as any);
  const tweet = (res.data as TweetV2) || res;
  const includes = res.includes || {};
  const users = (includes.users as UserV2[]) || [];
  const author = users.find((u) => u.id === tweet.author_id) || null;
  const refTweets = (includes.tweets as TweetV2[]) || [];
  return { tweet, author, referenced: refTweets, users, includes };
}

export async function postReplyTweet(
  text: string,
  replyToId?: string,
): Promise<string | null> {
  if (!postingEnabled()) return null;
  const c = userClient();
  const payload: Record<string, unknown> = { text };
  if (replyToId) {
    payload.reply = { in_reply_to_tweet_id: replyToId };
  }
  const res: any = await c.v2.tweet(payload as any);
  return res?.data?.id || null;
}

export function extractImageUrl(tweet: TweetV2, includes?: any): string | null {
  const mediaKeys = tweet.attachments?.media_keys;
  if (!mediaKeys || mediaKeys.length === 0) return null;
  const media = includes?.media || [];
  for (const m of media) {
    const url = m.media_url || m.url || m.media_url_https;
    if (url && (m.type === 'photo' || m.type === 'image')) return url;
  }
  return null;
}

export function extractReferenced(
  tweet: TweetV2,
  refTweets: TweetV2[],
  users: UserV2[],
): {
  quoted?: TweetV2;
  repliedTo?: TweetV2;
  quotedAuthor?: UserV2;
  repliedToAuthor?: UserV2;
} {
  const refs = tweet.referenced_tweets || [];
  const quotedRef = refs.find((r) => r.type === 'quoted');
  const replyRef = refs.find((r) => r.type === 'replied_to');
  const quoted = quotedRef ? refTweets.find((t) => t.id === quotedRef.id) : undefined;
  const repliedTo = replyRef ? refTweets.find((t) => t.id === replyRef.id) : undefined;
  const quotedAuthor = quoted ? users.find((u) => u.id === quoted.author_id) : undefined;
  const repliedToAuthor = repliedTo ? users.find((u) => u.id === repliedTo.author_id) : undefined;
  return { quoted, repliedTo, quotedAuthor, repliedToAuthor };
}
