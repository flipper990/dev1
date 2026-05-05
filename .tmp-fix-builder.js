const fs = require('fs');
const src = 'C:/Users/AJ/AppData/Roaming/Code/User/History/-4e883d4a/HIe3.ts';
const dst = 'apps/api/src/agents/builder-agent.ts';
const raw = fs.readFileSync(src, 'utf8');
const lines = raw.split(/\r?\n/);
const idx = 1088;
const bad = lines[idx];

// The corrupted line is a JSON-encoded version of the original code
// (without surrounding quotes). Wrap and parse.
let decoded;
try {
  decoded = JSON.parse('"' + bad + '"');
} catch (e) {
  console.error('JSON.parse failed:', e.message);
  // Fallback: regex-based decode of common escapes
  decoded = bad
    .replace(/\\\\/g, '\u0000')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\u0000/g, '\\');
}

console.log('Decoded length:', decoded.length);
console.log('Decoded line count:', decoded.split('\n').length);

lines[idx] = decoded;
const result = lines.join('\r\n');
fs.writeFileSync(dst, result, 'utf8');
console.log('Wrote', result.length, 'bytes to', dst);
