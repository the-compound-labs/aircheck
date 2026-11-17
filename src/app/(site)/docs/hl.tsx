import { Fragment } from 'react';

/* Colours a code sample without changing a character of it: JSON keys and TOML keys in red, strings
 * in a pale ink, comments dimmed. Everything else is left as it was written. */
const TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)|("(?:[^"\\]|\\.)*")|(#[^\n]*)|(^\s*\[[^\]\n]+\])|(^\s*[A-Za-z_][\w.]*)(?=\s*=)/gm;

export function hl(src: string) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of src.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(src.slice(last, at));
    if (m[1]) out.push(<Fragment key={n++}><span className="k">{m[1]}</span>{m[2]}</Fragment>);
    else if (m[3]) out.push(<span key={n++} className="s">{m[3]}</span>);
    else if (m[4]) out.push(<span key={n++} className="c">{m[4]}</span>);
    else if (m[5]) out.push(<span key={n++} className="k">{m[5]}</span>);
    else if (m[6]) out.push(<span key={n++} className="k">{m[6]}</span>);
    last = at + m[0].length;
  }
  if (last < src.length) out.push(src.slice(last));
  return out;
}
