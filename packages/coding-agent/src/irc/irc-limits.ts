/**
 * IRC is for coordination references, not bulk content. Direct messages allow a
 * short explanation; broadcasts are tighter because every recipient inherits
 * the body in durable model context.
 */
export const IRC_BODY_MAX_CHARS = 1_200;
export const IRC_BROADCAST_BODY_MAX_CHARS = 400;
