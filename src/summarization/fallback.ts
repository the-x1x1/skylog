import { firstMeaningfulText, truncateAtWord } from '../utils/text';

/** Titles some apps assign before a conversation has a real name. */
const PLACEHOLDER_TITLES = /^(new chat|untitled|untitled conversation|new conversation|chat|conversation|\(no title\))$/i;

export interface FallbackDerivation {
  title: string;
  excerpt: string;
}

/**
 * Journal metadata derived only from the source — never invented prose. Used when no summary
 * provider is configured (and as the baseline before a summary exists).
 */
export function deriveFallback(sourceTitle: string, messages: readonly { role: string; text: string }[]): FallbackDerivation {
  const userTexts = messages.filter((m) => m.role === 'user').map((m) => m.text);
  const firstUser = firstMeaningfulText(userTexts) ?? firstMeaningfulText(messages.map((m) => m.text));
  const cleanTitle = sourceTitle.trim();
  const title =
    cleanTitle && !PLACEHOLDER_TITLES.test(cleanTitle)
      ? truncateAtWord(cleanTitle, 90)
      : firstUser
        ? truncateAtWord(firstUser, 64)
        : 'Untitled conversation';
  return { title, excerpt: firstUser ? truncateAtWord(firstUser, 200) : '' };
}
