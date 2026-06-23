import axios from 'axios';
import * as cheerio from 'cheerio';

// Tor gateways that work from Vercel
const GATEWAYS = [
  'https://onion.ws/',
  'https://onion.ly/',
  'https://onion.sh/',
];

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function sanitizeOnion(o) {
  return o.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

function gatewayUrl(gw, onion) {
  return gw + onion;
}

// fetch with optional cookies & referer
async function fetchPage(url, cookies = '', referer = '') {
  const headers = {
    'User-Agent': randomUA(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
  };
  if (cookies) headers.Cookie = cookies;
  if (referer) headers.Referer = referer;

  return axios.get(url, {
    headers,
    timeout: 15000,
    maxRedirects: 0, // manual follow
    validateStatus: status => status < 400 || status === 301 || status === 302,
    decompress: true,
  });
}

// extract form (id = signup / login)
function extractForm(html, regex) {
  const $ = cheerio.load(html);
  const form = $(`form[id*="${regex}"], form[class*="${regex}"], form[action*="${regex}"]`).first();
  if (!form.length) return null;
  const action = form.attr('action') || '';
  const method = (form.attr('method') || 'post').toLowerCase();
  const inputs = [];
  form.find('input, select, textarea').each((i, el) => {
    const name = $(el).attr('name');
    if (!name) return;
    const type = $(el).attr('type') || 'text';
    if (type === 'submit') return;
    inputs.push({ name, type, value: $(el).attr('value') || '' });
  });
  return { action, method, inputs };
}

// generate fake registration data
function generateFakeData() {
  const id = Math.random().toString(36).substring(2, 10);
  return {
    username: 'bypass_' + id,
    email: 'bypass_' + id + '@mailinator.com',
    password: 'P' + id + '!x',
    confirm_password: 'P' + id + '!x',
  };
}

// fill form fields with fake data
function fillFields(inputs) {
  const fake = generateFakeData();
  const data = {};
  inputs.forEach(f => {
    const l = f.name.toLowerCase();
    if (l.includes('user') || l.includes('nick')) data[f.name] = fake.username;
    else if (l.includes('email')) data[f.name] = fake.email;
    else if (l.includes('pass')) {
      data[f.name] = l.includes('confirm') ? fake.confirm_password : fake.password;
    } else if (f.type === 'hidden') data[f.name] = f.value; // preserve hidden
    else data[f.name] = f.value || '';
  });
  return data;
}

// perform signup POST
async function doSignup(baseUrl, form, cookies) {
  const actionUrl = form.action.startsWith('http') ? form.action : new URL(form.action, baseUrl).href;
  const payload = fillFields(form.inputs);
  const headers = {
    'User-Agent': randomUA(),
    'Content-Type': 'application/x-www-form-urlencoded',
    'Referer': baseUrl,
  };
  if (cookies) headers.Cookie = cookies;

  try {
    const resp = await axios.post(actionUrl, new URLSearchParams(payload).toString(), {
      headers,
      timeout: 15000,
      maxRedirects: 0,
      validateStatus: () => true,
    });
    // harvest Set-Cookie
    const sc = resp.headers['set-cookie'];
    let newCookies = '';
    if (sc) {
      newCookies = (Array.isArray(sc) ? sc : [sc]).map(c => c.split(';')[0]).join('; ');
    }
    const success = resp.status === 200 || (resp.status >= 300 && resp.status < 400);
    return { cookies: newCookies, success };
  } catch (e) {
    return { cookies: '', success: false };
  }
}

// try premium cookies (paid, subscriber, etc.)
async function tryPremiumCookies(baseUrl, cookies) {
  const paymentCookies = [
    'paid=1',
    'premium=1',
    'subscriber=true',
    'membership=active',
    'has_paid=1',
    'unlocked=1',
  ];
  for (let pc of paymentCookies) {
    const combined = cookies ? `${cookies}; ${pc}` : pc;
    try {
      const resp = await fetchPage(baseUrl, combined, baseUrl);
      if (!/(payment|subscribe|unlock|premium)/i.test(resp.data)) {
        return { cookies: combined, html: resp.data };
      }
    } catch (e) {}
  }
  return null;
}

// hit fake payment success URLs
async function fakePaymentCallbacks(baseUrl, cookies) {
  const paths = [
    '/payment/success',
    '/pay/complete',
    '/order/confirm',
    '/callback.php?status=ok',
    '/api/payment/verify',
    '/return/success',
  ];
  for (let p of paths) {
    try {
      const target = baseUrl + p;
      const resp = await axios.get(target, {
        headers: {
          'User-Agent': randomUA(),
          Cookie: cookies,
          Referer: baseUrl,
        },
        timeout: 10000,
        maxRedirects: 2,
      });
      if (resp.status === 200 && !/(payment|error)/i.test(resp.data)) {
        return { cookies, html: resp.data };
      }
    } catch (e) {}
  }
  return null;
}

// scrape all media sources
function extractMedia(html, baseUrl) {
  const $ = cheerio.load(html);
  const sources = [];

  // video / source tags
  $('video').each((i, el) => {
    const src = $(el).attr('src');
    if (src) sources.push({ url: new URL(src, baseUrl).href, type: 'video/mp4' });
    $(el).find('source').each((j, s) => {
      const ssrc = $(s).attr('src');
      if (ssrc) sources.push({ url: new URL(ssrc, baseUrl).href, type: $(s).attr('type') || 'video/mp4' });
    });
  });

  // iframes pointing to known embedders
  $('iframe').each((i, el) => {
    const src = $(el).attr('src');
    if (src && /(tube|embed|stream|video)/i.test(src)) {
      sources.push({ url: new URL(src, baseUrl).href, type: 'iframe' });
    }
  });

  // direct links to video files
  $('a[href]').each((i, el) => {
    const href = $(el).attr('href');
    if (/\.(mp4|webm|m3u8|mpd)(\?|$)/i.test(href)) {
      sources.push({
        url: new URL(href, baseUrl).href,
        type: href.includes('.m3u8') ? 'application/x-mpegURL' : 'video/mp4',
      });
    }
  });

  // inline scripts
  const scripts = $('script').map((i, el) => $(el).html()).get().join('\n');
  const regex = /(https?:\/\/[^\s"']+\.(?:m3u8|mpd|mp4|webm)[^\s"']*)/gi;
  let m;
  while ((m = regex.exec(scripts)) !== null) {
    sources.push({ url: m[1], type: m[1].includes('.m3u8') ? 'application/x-mpegURL' : 'video/mp4' });
  }

  return sources;
}

// main bypass logic for a single gateway
async function bypassOnion(onionClean, gateway) {
  const baseUrl = gatewayUrl(gateway, onionClean);
  let cookies = '';
  let html = '';

  // 1. first fetch
  try {
    const resp = await fetchPage(baseUrl);
    if (resp.headers['set-cookie']) {
      cookies = (Array.isArray(resp.headers['set-cookie']) ? resp.headers['set-cookie'] : [resp.headers['set-cookie']])
        .map(c => c.split(';')[0])
        .join('; ');
    }
    html = resp.data;
  } catch (e) {
    throw new Error('Cannot fetch page');
  }

  // 2. detect and execute signup / login
  const signup = extractForm(html, 'signup|register');
  const login = extractForm(html, 'login|signin');
  if (signup) {
    const res = await doSignup(baseUrl, signup, cookies);
    if (res.cookies) cookies = res.cookies;
    // refetch after signup
    try { const ref = await fetchPage(baseUrl, cookies, baseUrl); html = ref.data; } catch (e) {}
  } else if (login) {
    // try generic admin/admin login; alternatively could do signup if there is a link
    // but most sites require signup first, so skip simple login block
  }

  // 3. check payment wall
  if (/(payment|subscribe|unlock|premium|order)/i.test(html)) {
    let payBypass = await tryPremiumCookies(baseUrl, cookies);
    if (payBypass) {
      html = payBypass.html;
      cookies = payBypass.cookies;
    } else {
      payBypass = await fakePaymentCallbacks(baseUrl, cookies);
      if (payBypass) {
        html = payBypass.html;
        cookies = payBypass.cookies;
      }
    }
  }

  // 4. final media extraction
  const media = extractMedia(html, baseUrl);
  if (media.length > 0) {
    const direct = media.find(el => el.type !== 'iframe') || media[0];
    return { type: direct.type, url: direct.url };
  }

  return null;
}

// API handler
export default async function handler(req, res) {
  const { onion } = req.query;
  if (!onion) {
    return res.status(400).json({ error: 'Onion link do' });
  }
  const clean = sanitizeOnion(onion);

  for (const gw of GATEWAYS) {
    try {
      const result = await bypassOnion(clean, gw);
      if (result) {
        return res.json(result);
      }
    } catch (e) {
      // next gateway
    }
  }

  return res.status(404).json({ error: 'Direct media nahi mila. Strong protection ho sakta hai.' });
            }
