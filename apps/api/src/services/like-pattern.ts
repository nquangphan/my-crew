/** Escapes LIKE wildcards so user text is matched literally. */
export const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
