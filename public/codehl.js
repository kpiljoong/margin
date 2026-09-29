// Tiny, dependency-free code highlighter for fenced blocks in the preview.
// Deliberately approximate: comments, strings, numbers, keywords, literals.

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const KW = {
  js: 'await async break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield interface type enum implements private public protected readonly as',
  py: 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case self',
  sh: 'if then else elif fi for while do done case esac function in return local export echo exit set unset source',
  go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var',
  rs: 'as async await break const continue crate else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while',
  c: 'auto break case char const continue default do double else enum extern float for goto if int long register return short signed sizeof static struct switch typedef union unsigned void volatile while class public private protected new delete namespace template using virtual bool',
  java: 'abstract boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long new package private protected public return short static super switch this throw throws try void while var record',
  sql: 'select from where and or not insert into values update set delete create table index view drop alter join left right inner outer on group by order having limit offset as distinct union all case when then else end primary key foreign references null is in like between exists',
  css: 'important media supports keyframes import from to',
};
const ALIAS = {
  javascript: 'js', jsx: 'js', ts: 'js', typescript: 'js', tsx: 'js', mjs: 'js', json: 'js',
  python: 'py', bash: 'sh', shell: 'sh', zsh: 'sh', console: 'sh', golang: 'go', rust: 'rs',
  cpp: 'c', 'c++': 'c', h: 'c', cs: 'java', csharp: 'java', kotlin: 'java', kt: 'java', swift: 'rs', scss: 'css', less: 'css',
  yaml: 'sh', yml: 'sh', toml: 'sh', ini: 'sh', dockerfile: 'sh', rb: 'py', ruby: 'py',
};
const HASH_COMMENT = new Set(['py', 'sh']);
const LITERALS = /^(true|false|null|undefined|None|True|False|nil|NaN|Infinity)$/;

const cache = new Map();
function tokenizer(lang) {
  if (cache.has(lang)) return cache.get(lang);
  const kw = new Set((KW[lang] || '').split(' ').filter(Boolean));
  const comment = lang === 'sql' ? '--[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/'
    : HASH_COMMENT.has(lang) ? '#[^\\n]*' : lang === 'css' ? '\\/\\*[\\s\\S]*?\\*\\/' : '\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/';
  const re = new RegExp(`(${comment})|("(?:\\\\.|[^"\\\\\\n])*"|'(?:\\\\.|[^'\\\\\\n])*'|\`(?:\\\\.|[^\`\\\\])*\`)|(\\b\\d[\\d_]*(?:\\.\\d+)?(?:e[+-]?\\d+)?\\b|\\b0x[0-9a-f]+\\b)|([A-Za-z_$][\\w$]*)`, 'gi');
  const t = { re, kw };
  cache.set(lang, t);
  return t;
}

export function highlightCode(code, langRaw) {
  const lang = ALIAS[(langRaw || '').toLowerCase()] || (langRaw || '').toLowerCase();
  if (!KW[lang] || code.length > 100_000) return esc(code);
  const { re, kw } = tokenizer(lang);
  let out = '';
  let pos = 0;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(code))) {
    out += esc(code.slice(pos, m.index));
    const [tok, com, str, num, word] = m;
    if (com) out += `<span class="tk-com">${esc(tok)}</span>`;
    else if (str) out += `<span class="tk-str">${esc(tok)}</span>`;
    else if (num) out += `<span class="tk-num">${esc(tok)}</span>`;
    else if (word && (kw.has(word) || (lang === 'sql' && kw.has(word.toLowerCase())))) out += `<span class="tk-kw">${esc(tok)}</span>`;
    else if (word && LITERALS.test(word)) out += `<span class="tk-lit">${esc(tok)}</span>`;
    else if (word && code[re.lastIndex] === '(') out += `<span class="tk-fn">${esc(tok)}</span>`;
    else out += esc(tok);
    pos = re.lastIndex;
  }
  return out + esc(code.slice(pos));
}
