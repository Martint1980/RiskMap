const express = require('express');
const cron = require('node-cron');
const https = require('https');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

let warningCache = { data: {}, lastUpdated: null, source: 'none', count: 0 };
let textCache = { data: {}, lastUpdated: null };

function httpsGet(options) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('Timeout')));
    req.end();
  });
}

function httpsPost(options, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    options.headers = {
      ...options.headers,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('Timeout')));
    req.write(body);
    req.end();
  });
}

async function fetchWarnings() {
  const res = await httpsGet({
    hostname: 'www.auswaertiges-amt.de',
    path: '/opendata/travelwarning',
    method: 'GET',
    headers: { 'User-Agent': 'travel-warning-map/1.0', 'Accept': 'application/json' }
  });
  const json = JSON.parse(res.body);
  const items = json.response || json;
  const result = {};
  for (const [, item] of Object.entries(items)) {
    const iso2 = item.iso2CountryCode;
    if (!iso2) continue;
    result[iso2] = {
      level: item.warning ? 3 : item.partialWarning ? 2 : 0,
      warning: item.warning || false,
      partialWarning: item.partialWarning || false,
      countryName: item.countryName || ''
    };
  }
  return result;
}

async function updateWarnings() {
  const ts = new Date().toISOString();
  console.log(`[${ts}] Warnstufen-Update...`);
  try {
    const data = await fetchWarnings();
    warningCache = { data, lastUpdated: ts, source: 'live', count: Object.keys(data).length };
    console.log(`[${ts}] Warnstufen OK: ${warningCache.count} Laender`);
  } catch (e) {
    console.error(`[${ts}] Warnstufen-Fehler: ${e.message}`);
    if (warningCache.count > 0) warningCache.source = 'cached_after_error';
    else warningCache.source = 'error';
  }
}

async function generateCountryText(iso2, countryNameDE) {
  if (!ANTHROPIC_API_KEY) throw new Error('Kein ANTHROPIC_API_KEY');

  const prompt = `Suche nach den aktuellen offiziellen Reise- und Sicherheitshinweisen des Deutschen Auswaertigen Amts fuer ${countryNameDE} (ISO2: ${iso2}). Antworte NUR mit einem JSON-Objekt ohne Markdown oder Backticks: {"security":"<Sicherheitstext des AA, max 3 Saetze, Deutsch>","entry":"<Aktuelle Einreisebestimmungen fuer Deutsche: Visum ja/nein, Dauer, Besonderheiten. Max 2 Saetze, Deutsch>"}`;

  const res = await httpsPost(
    {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      }
    },
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }]
    }
  );

  if (res.status !== 200) throw new Error(`API Status ${res.status}: ${res.body.substring(0,200)}`);

  const data = JSON.parse(res.body);
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const match = text.match(/\{[\s\S]*?\}/);
  if (!match) throw new Error('Kein JSON in Antwort');
  const parsed = JSON.parse(match[0]);
  if (!parsed.security || !parsed.entry) throw new Error('JSON unvollstaendig');
  return parsed;
}

const COUNTRIES_TO_UPDATE = [
  ['AF','Afghanistan'],['AE','Vereinigte Arabische Emirate'],['BH','Bahrain'],
  ['BY','Belarus'],['HT','Haiti'],['IR','Iran'],['IQ','Irak'],['IL','Israel'],
  ['JO','Jordanien'],['QA','Katar'],['KW','Kuwait'],['LB','Libanon'],
  ['LY','Libyen'],['ML','Mali'],['MM','Myanmar'],['NE','Niger'],['OM','Oman'],
  ['PS','Palaestinensische Gebiete'],['SA','Saudi-Arabien'],['SO','Somalia'],
  ['SD','Sudan'],['SS','Suedsudan'],['SY','Syrien'],['UA','Ukraine'],
  ['YE','Jemen'],['CF','Zentralafrikanische Republik'],['RU','Russland'],
  ['BF','Burkina Faso'],['PK','Pakistan'],['ET','Aethiopien'],['NG','Nigeria'],
  ['CD','Demokratische Republik Kongo'],['TD','Tschad'],['KP','Nordkorea'],
  ['MX','Mexiko'],['CO','Kolumbien'],['TH','Thailand'],['PH','Philippinen'],
  ['CM','Kamerun'],['KE','Kenia'],['VE','Venezuela'],['GE','Georgien'],
  ['AZ','Aserbaidschan'],['TJ','Tadschikistan'],['BD','Bangladesch'],
  ['LK','Sri Lanka'],['MR','Mauretanien'],['MZ','Mosambik'],['AO','Angola'],
  ['UG','Uganda'],['TZ','Tansania'],['GH','Ghana'],['KH','Kambodscha'],
  ['TR','Tuerkei'],['EG','Aegypten'],['TN','Tunesien'],['MA','Marokko'],
  ['IN','Indien'],['CN','China'],['BR','Brasilien'],['ZA','Suedafrika'],
  ['ID','Indonesien'],['MY','Malaysia'],['NP','Nepal'],['EC','Ecuador'],
  ['GT','Guatemala'],['HN','Honduras'],['SV','El Salvador'],['NI','Nicaragua'],
  ['CU','Kuba'],['CI','Elfenbeinkueste'],['LR','Liberia'],['SL','Sierra Leone'],
  ['GN','Guinea'],['TG','Togo'],['BJ','Benin'],['ZW','Simbabwe'],['ZM','Sambia'],
  ['MW','Malawi'],['ER','Eritrea'],['DJ','Dschibuti'],['AM','Armenien'],
  ['KG','Kirgisistan'],['MD','Moldau'],['BI','Burundi'],['RW','Ruanda'],
  ['GW','Guinea-Bissau'],['DE','Deutschland'],['FR','Frankreich'],
  ['GB','Grossbritannien'],['US','USA'],['CA','Kanada'],['JP','Japan'],
  ['KR','Suedkorea'],['AU','Australien'],['NZ','Neuseeland'],['SG','Singapur'],
  ['VN','Vietnam'],['AR','Argentinien'],
];

async function updateTexts() {
  if (!ANTHROPIC_API_KEY) {
    console.log('[TEXT] Kein API Key – uebersprungen');
    return;
  }
  const ts = new Date().toISOString();
  console.log(`[${ts}] Text-Update gestartet (${COUNTRIES_TO_UPDATE.length} Laender)...`);
  let success = 0, errors = 0;

  for (const [iso2, name] of COUNTRIES_TO_UPDATE) {
    try {
      const result = await generateCountryText(iso2, name);
      textCache.data[iso2] = { ...result, updatedAt: ts };
      success++;
      console.log(`[TEXT] OK: ${name}`);
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      errors++;
      console.warn(`[TEXT] FEHLER ${name}: ${e.message}`);
    }
  }
  textCache.lastUpdated = ts;
  console.log(`[${ts}] Text-Update fertig: ${success} OK, ${errors} Fehler`);
}

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  next();
});

app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/api/warnings', (req, res) => {
  res.json({ lastUpdated: warningCache.lastUpdated, source: warningCache.source, count: warningCache.count, data: warningCache.data });
});

app.get('/api/texts', (req, res) => {
  res.json({ lastUpdated: textCache.lastUpdated, count: Object.keys(textCache.data).length, data: textCache.data });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    warnings: { lastUpdated: warningCache.lastUpdated, source: warningCache.source, count: warningCache.count },
    texts: { lastUpdated: textCache.lastUpdated, count: Object.keys(textCache.data).length },
    apiKeyPresent: !!ANTHROPIC_API_KEY,
    schedule: 'Warnstufen: taeglich 06:00 + 12:00 UTC | Texte: montags 07:00 UTC'
  });
});

// Warnstufen: täglich 06:00 + 12:00 UTC
cron.schedule('0 0 6 * * *',  () => updateWarnings(), { timezone: 'UTC' });
cron.schedule('0 0 12 * * *', () => updateWarnings(), { timezone: 'UTC' });
// Texte: jeden Montag 07:00 UTC
cron.schedule('0 0 7 * * 1',  () => updateTexts(),    { timezone: 'UTC' });

app.listen(PORT, async () => {
  console.log(`Server Port ${PORT} | API Key: ${ANTHROPIC_API_KEY ? 'OK' : 'FEHLT'}`);
  await updateWarnings();
  if (ANTHROPIC_API_KEY && Object.keys(textCache.data).length === 0) {
    console.log('Erster Start – generiere Texte im Hintergrund...');
    updateTexts();
  }
});
