/**
 * Thrown by parsers for records that cannot become a journal entry. The batch continues.
 * `warning` = skipped (e.g. an empty conversation); `error` = malformed record, reported as failed.
 */
export class SkipConversation extends Error {
  constructor(
    message: string,
    readonly level: 'warning' | 'error' = 'error',
  ) {
    super(message);
  }
}
