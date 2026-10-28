/**
 * Animated illustrations inside a news post. The owner places one on its own line of the post body as
 * `[[cena:nome]]`; the site draws the scene there and every other surface (system modal, list excerpts)
 * simply drops the line. Pure helpers, shared by the site and the system.
 */
const SCENE_LINE = /^\s*\[\[cena:([a-z0-9-]+)\]\]\s*$/;

export type NewsSegment = { type: 'text'; text: string } | { type: 'scene'; name: string };

export function splitNewsBody(body: string): NewsSegment[] {
  const segments: NewsSegment[] = [];
  let buffer: string[] = [];
  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text) segments.push({ type: 'text', text });
    buffer = [];
  };
  for (const line of body.split('\n')) {
    const match = SCENE_LINE.exec(line);
    if (match) {
      flush();
      segments.push({ type: 'scene', name: match[1] });
    } else {
      buffer.push(line);
    }
  }
  flush();
  return segments;
}

export function stripSceneMarkers(body: string) {
  return body
    .split('\n')
    .filter((line) => !SCENE_LINE.test(line))
    .join('\n');
}
