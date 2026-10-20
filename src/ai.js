// "Swipe up": ask an AI whether something can go. Three optional backends, all off if none is available:
//   claude-cli – the Claude Code CLI (`claude -p`), uses the user's existing login
//   anthropic  – Anthropic API with an API key (official SDK)
//   ollama     – a local model via Ollama, nothing leaves the machine
const { spawn } = require('child_process');
const os = require('os');
const { settings } = require('./config');
const { run } = require('./platform');

const MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'];
const CLI_ALIAS = { 'claude-opus-5': 'opus', 'claude-sonnet-5': 'sonnet', 'claude-haiku-4-5': 'haiku' };
const OLLAMA = process.env.OLLAMA_HOST ? process.env.OLLAMA_HOST.replace(/\/$/, '') : 'http://127.0.0.1:11434';

let cache = null, cacheAt = 0;
async function status(force = false) {
  if (!force && cache && Date.now() - cacheAt < 30000) return cache;
  const [cli, ollama] = await Promise.all([
    run(process.platform === 'win32' ? 'where' : 'sh', process.platform === 'win32' ? ['claude'] : ['-c', 'command -v claude']).then(r => r.ok),
    fetch(OLLAMA + '/api/tags', { signal: AbortSignal.timeout(1500) }).then(r => r.json()).then(j => (j.models || []).map(m => m.name)).catch(() => null),
  ]);
  cache = { 'claude-cli': cli, anthropic: !!(settings.apiKey || process.env.ANTHROPIC_API_KEY), ollama: !!ollama, ollamaModels: ollama || [] };
  cacheAt = Date.now();
  return cache;
}

async function provider() {
  const s = await status();
  if (settings.ai === 'off') return null;
  if (settings.ai !== 'auto') return s[settings.ai] ? settings.ai : null;
  return ['claude-cli', 'anthropic', 'ollama'].find(p => s[p]) || null;
}

function buildPrompt(info, lang) {
  return `I'm cleaning up my disk (${process.platform}). Is this safe to delete?\n\n${info}\n\n` +
    `Start your answer with exactly one word: DELETE, KEEP or CAREFUL. Then give at most two short sentences ` +
    `in ${lang === 'de' ? 'German' : 'English'} explaining what it is and why. Do not use tools; rely on the information given and your knowledge.`;
}

async function ask(info, lang) {
  const p = await provider();
  if (!p) return { error: 'noai' };
  const prompt = buildPrompt(info, lang);
  try {
    if (p === 'claude-cli') return { text: await viaCli(prompt), provider: p };
    if (p === 'anthropic') return { text: await viaApi(prompt), provider: p };
    return { text: await viaOllama(prompt), provider: p };
  } catch (e) {
    return { error: 'failed', detail: String(e.message || e).slice(0, 300), provider: p };
  }
}

function viaCli(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', '--model', CLI_ALIAS[settings.model] || 'opus'], { shell: true, cwd: os.tmpdir(), windowsHide: true });
    let out = '', err = '';
    const t = setTimeout(() => { child.kill(); reject(new Error('timeout')); }, 120000);
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('close', () => { clearTimeout(t); out.trim() ? resolve(out.trim()) : reject(new Error(err.trim() || 'no answer')); });
    child.stdin.end(prompt);
  });
}

let client = null, clientKey = null;
async function viaApi(prompt) {
  const mod = require('@anthropic-ai/sdk');
  const Anthropic = mod.default || mod;
  const apiKey = settings.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!client || clientKey !== apiKey) { client = new Anthropic({ apiKey }); clientKey = apiKey; }
  const model = MODELS.includes(settings.model) ? settings.model : 'claude-opus-5';
  const params = { model, max_tokens: 4000, messages: [{ role: 'user', content: prompt }] };
  if (model !== 'claude-haiku-4-5') params.output_config = { effort: 'low' }; // a short verdict needs little thinking
  let resp;
  try {
    resp = model === 'claude-opus-5'
      ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : await client.messages.create(params);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('API key rejected');
    if (e instanceof Anthropic.RateLimitError) throw new Error('rate limited, try again in a moment');
    if (e instanceof Anthropic.APIError) throw new Error(`API error ${e.status}: ${e.message}`);
    throw e;
  }
  if (resp.stop_reason === 'refusal') return 'CAREFUL';
  return resp.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
}

async function viaOllama(prompt) {
  const s = await status();
  const model = settings.ollamaModel || s.ollamaModels[0];
  if (!model) throw new Error('no Ollama model installed');
  const r = await fetch(OLLAMA + '/api/generate', {
    method: 'POST', body: JSON.stringify({ model, prompt, stream: false }), signal: AbortSignal.timeout(180000),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return String(j.response || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

module.exports = { status, provider, ask, MODELS };
