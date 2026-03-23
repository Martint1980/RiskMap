const express = require('express');
const cron = require('node-cron');
const https = require('https');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

let warningCache = { data: {}, lastUpdated: null, source: 'none', count: 0 };
let textCache    = { data: {}, lastUpdated: null };

// ── All countries to classify (level + text via Haiku) ────────────────────────
// Level 2/3 from AA-API overrides level here; text is always used.
const ALL_COUNTRIES = [
  ['AD','Andorra'],['AE','Vereinigte Arabische Emirate'],['AF','Afghanistan'],
  ['AG','Antigua und Barbuda'],['AL','Albanien'],['AM','Armenien'],
  ['AO','Angola'],['AR','Argentinien'],['AT','Österreich'],['AU','Australien'],
  ['AZ','Aserbaidschan'],['BA','Bosnien und Herzegowina'],['BB','Barbados'],
  ['BD','Bangladesch'],['BE','Belgien'],['BF','Burkina Faso'],['BG','Bulgarien'],
  ['BH','Bahrain'],['BI','Burundi'],['BJ','Benin'],['BN','Brunei'],
  ['BO','Bolivien'],['BR','Brasilien'],['BS','Bahamas'],['BT','Bhutan'],
  ['BW','Botswana'],['BY','Belarus'],['BZ','Belize'],['CA','Kanada'],
  ['CD','DR Kongo'],['CF','Zentralafrikanische Republik'],['CG','Kongo'],
  ['CH','Schweiz'],['CI','Elfenbeinküste'],['CL','Chile'],['CM','Kamerun'],
  ['CN','China'],['CO','Kolumbien'],['CR','Costa Rica'],['CU','Kuba'],
  ['CV','Kap Verde'],['CY','Zypern'],['CZ','Tschechien'],['DE','Deutschland'],
  ['DJ','Dschibuti'],['DK','Dänemark'],['DM','Dominica'],['DO','Dominikanische Republik'],
  ['DZ','Algerien'],['EC','Ecuador'],['EE','Estland'],['EG','Ägypten'],
  ['ER','Eritrea'],['ES','Spanien'],['ET','Äthiopien'],['FI','Finnland'],
  ['FJ','Fidschi'],['FK','Falklandinseln'],['FR','Frankreich'],['GA','Gabun'],
  ['GB','Großbritannien'],['GD','Grenada'],['GE','Georgien'],['GH','Ghana'],
  ['GL','Grönland'],['GM','Gambia'],['GN','Guinea'],['GQ','Äquatorialguinea'],
  ['GR','Griechenland'],['GT','Guatemala'],['GW','Guinea-Bissau'],['GY','Guyana'],
  ['HK','Hongkong'],['HN','Honduras'],['HR','Kroatien'],['HT','Haiti'],
  ['HU','Ungarn'],['ID','Indonesien'],['IE','Irland'],['IL','Israel'],
  ['IN','Indien'],['IQ','Irak'],['IR','Iran'],['IS','Island'],
  ['IT','Italien'],['JM','Jamaika'],['JO','Jordanien'],['JP','Japan'],
  ['KE','Kenia'],['KG','Kirgisistan'],['KH','Kambodscha'],['KN','St. Kitts und Nevis'],
  ['KP','Nordkorea'],['KR','Südkorea'],['KW','Kuwait'],['KZ','Kasachstan'],
  ['LA','Laos'],['LB','Libanon'],['LC','St. Lucia'],['LK','Sri Lanka'],
  ['LR','Liberia'],['LS','Lesotho'],['LT','Litauen'],['LU','Luxemburg'],
  ['LV','Lettland'],['LY','Libyen'],['MA','Marokko'],['MD','Moldau'],
  ['ME','Montenegro'],['MG','Madagaskar'],['MK','Nordmazedonien'],['ML','Mali'],
  ['MM','Myanmar'],['MN','Mongolei'],['MO','Macau'],['MR','Mauretanien'],
  ['MT','Malta'],['MU','Mauritius'],['MV','Malediven'],['MW','Malawi'],
  ['MX','Mexiko'],['MY','Malaysia'],['MZ','Mosambik'],['NA','Namibia'],
  ['NC','Neukaledonien'],['NE','Niger'],['NG','Nigeria'],['NI','Nicaragua'],
  ['NL','Niederlande'],['NO','Norwegen'],['NP','Nepal'],['NR','Nauru'],
  ['NZ','Neuseeland'],['OM','Oman'],['PA','Panama'],['PE','Peru'],
  ['PG','Papua-Neuguinea'],['PH','Philippinen'],['PK','Pakistan'],['PL','Polen'],
  ['PR','Puerto Rico'],['PS','Palästinensische Gebiete'],['PT','Portugal'],
  ['PW','Palau'],['PY','Paraguay'],['QA','Katar'],['RO','Rumänien'],
  ['RS','Serbien'],['RU','Russland'],['RW','Ruanda'],['SA','Saudi-Arabien'],
  ['SB','Salomonen'],['SC','Seychellen'],['SD','Sudan'],['SE','Schweden'],
  ['SG','Singapur'],['SI','Slowenien'],['SK','Slowakei'],['SL','Sierra Leone'],
  ['SM','San Marino'],['SO','Somalia'],['SR','Suriname'],['SS','Südsudan'],
  ['ST','São Tomé und Príncipe'],['SV','El Salvador'],['SY','Syrien'],
  ['SZ','Eswatini'],['TD','Tschad'],['TG','Togo'],['TH','Thailand'],
  ['TJ','Tadschikistan'],['TL','Osttimor'],['TM','Turkmenistan'],['TN','Tunesien'],
  ['TO','Tonga'],['TR','Türkei'],['TT','Trinidad und Tobago'],['TW','Taiwan'],
  ['TZ','Tansania'],['UA','Ukraine'],['UG','Uganda'],['US','USA'],
  ['UY','Uruguay'],['UZ','Usbekistan'],['VA','Vatikanstadt'],['VC','St. Vincent und die Grenadinen'],
  ['VE','Venezuela'],['VN','Vietnam'],['VU','Vanuatu'],['WS','Samoa'],
  ['XK','Kosovo'],['YE','Jemen'],['ZA','Südafrika'],['ZM','Sambia'],
  ['ZW','Simbabwe'],
];

const BATCH_SIZE = 10;

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function httpsGet(options, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      // Follow redirects (301/302/307/308)
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 5) {
        const loc = new URL(res.headers.location, `https://${options.hostname}`);
        return httpsGet({
          hostname: loc.hostname,
          path: loc.pathname + (loc.search || ''),
          method: options.method || 'GET',
          headers: options.headers
        }, redirects + 1).then(resolve).catch(reject);
      }
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

// ── AA warnings (Level 2 + 3) ─────────────────────────────────────────────────
async function fetchWarnings() {
  const res = await httpsGet({
    hostname: 'www.auswaertiges-amt.de',
    path: '/opendata/travelwarning',
    method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0 travel-warning-map/1.0', 'Accept': 'application/json' }
  });

  console.log(`[AA] HTTP ${res.status}, Body-Anfang: ${res.body.substring(0, 300)}`);

  if (res.status !== 200) throw new Error(`AA API HTTP ${res.status}`);

  const json = JSON.parse(res.body);
  const result = {};

  // Handle multiple possible response structures from the AA API
  let entries = null;

  if (Array.isArray(json)) {
    // Format: [{iso2CountryCode, warning, ...}, ...]
    entries = json;
  } else if (Array.isArray(json.response)) {
    entries = json.response;
  } else if (json.response && typeof json.response === 'object') {
    entries = Object.values(json.response);
  } else if (typeof json === 'object') {
    entries = Object.values(json);
  }

  if (!entries) throw new Error('Unbekanntes AA-API Format');

  for (const item of entries) {
    if (!item || typeof item !== 'object') continue;
    const iso2 = item.iso2CountryCode || item.countryCode;
    if (!iso2 || iso2.length !== 2) continue;
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
    console.log(`[${ts}] Warnstufen OK: ${warningCache.count} Länder`);
  } catch (e) {
    console.error(`[${ts}] Warnstufen-Fehler: ${e.message}`);
    if (warningCache.count > 0) warningCache.source = 'cached_after_error';
    else warningCache.source = 'error';
  }
}

// ── Haiku batch classification (Level 0/1 + texts) ───────────────────────────
// Returns array of {i, l, s, e} — short keys to minimize output tokens.
async function classifyBatch(countries) {
  if (!ANTHROPIC_API_KEY) throw new Error('Kein ANTHROPIC_API_KEY');

  const list = countries.map(([iso2, name]) => `${iso2} ${name}`).join(', ');

  const system =
    'Du bist ein präziser Reisesicherheits-Experte mit aktuellem Wissensstand (2025). ' +
    'Du kennst die Reise- und Sicherheitshinweise des Deutschen Auswärtigen Amts genau. ' +
    'Wichtige aktuelle Einreiseregeln für Deutsche (Stand 2024/2025): ' +
    'China: visumfrei 30 Tage (seit Nov. 2023). ' +
    'Japan: visumfrei 90 Tage. ' +
    'USA: ESTA erforderlich, kein Visum. ' +
    'Großbritannien: Reisepass erforderlich, kein Visum (6 Monate). ' +
    'Sei bei Visa-Angaben immer sehr präzise – nenne Dauer und ob Visum, eVisa oder visumfrei. ' +
    'Wichtig für den security-Text: Wenn ein Land nur wegen indirekter Auswirkungen eine AA-Warnung hat (z.B. Japan: Teilwarnung wegen Nahost-Flugrouten, aber Japan selbst ist sicher), dann erkläre das explizit – z.B. "Japan selbst ist sicher; Teilwarnung betrifft nur eingeschränkte Flugrouten über den Nahen Osten." ' +
    'Antworte AUSSCHLIESSLICH mit einem JSON-Array, kein Markdown, kein Text davor oder danach.';

  const user =
    'Erstelle für jedes Land exakte Reiseinformationen basierend auf den aktuellen AA-Hinweisen.\n' +
    'Level: 0=kein besonderes Risiko laut AA, 1=AA empfiehlt erhöhte Vorsicht oder regionale Einschränkungen (kein offizieller Warning).\n' +
    'Format: [{"i":"ISO2","l":0,"s":"Sicherheitslage 1-2 Sätze präzise","e":"Einreise für Deutsche: Visum/visumfrei, Dauer, Besonderheiten – 1 Satz"}]\n' +
    'Länder: ' + list;

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
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1800,
      system,
      messages: [{ role: 'user', content: user }]
    }
  );

  if (res.status !== 200) throw new Error(`API ${res.status}: ${res.body.substring(0, 200)}`);

  const data = JSON.parse(res.body);
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');

  // Extract JSON array from response (strip potential markdown fences)
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('Kein JSON-Array in Antwort');

  const parsed = JSON.parse(match[0]);
  return parsed; // [{i, l, s, e}, ...]
}

async function updateTextsAndLevels() {
  if (!ANTHROPIC_API_KEY) {
    console.log('[TEXT] Kein API Key – übersprungen');
    return;
  }

  const ts = new Date().toISOString();
  console.log(`[${ts}] Text+Level-Update (${ALL_COUNTRIES.length} Länder, Haiku, Batches à ${BATCH_SIZE})...`);

  let success = 0, errors = 0;

  for (let i = 0; i < ALL_COUNTRIES.length; i += BATCH_SIZE) {
    const batch = ALL_COUNTRIES.slice(i, i + BATCH_SIZE);
    try {
      const results = await classifyBatch(batch);
      for (const entry of results) {
        if (!entry.i || entry.l === undefined) continue;
        textCache.data[entry.i] = {
          level:     entry.l,
          security:  entry.s || '',
          entry:     entry.e || '',
          updatedAt: ts
        };
        success++;
      }
      console.log(`[TEXT] Batch ${Math.floor(i / BATCH_SIZE) + 1}: OK (${batch.map(c => c[0]).join(',')})`);
    } catch (e) {
      errors += batch.length;
      console.warn(`[TEXT] Batch-Fehler: ${e.message}`);
    }

    // Pause between batches to respect rate limits
    if (i + BATCH_SIZE < ALL_COUNTRIES.length) {
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  textCache.lastUpdated = ts;
  console.log(`[${ts}] Text+Level fertig: ${success} OK, ${errors} Fehler`);
}

// ── Express ───────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  next();
});

app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/api/warnings', (req, res) => {
  res.json({
    lastUpdated: warningCache.lastUpdated,
    source: warningCache.source,
    count: warningCache.count,
    data: warningCache.data
  });
});

app.get('/api/texts', (req, res) => {
  res.json({
    lastUpdated: textCache.lastUpdated,
    count: Object.keys(textCache.data).length,
    data: textCache.data
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    warnings: { lastUpdated: warningCache.lastUpdated, source: warningCache.source, count: warningCache.count },
    texts: { lastUpdated: textCache.lastUpdated, count: Object.keys(textCache.data).length },
    apiKeyPresent: !!ANTHROPIC_API_KEY,
    model: 'claude-haiku-4-5-20251001',
    batchSize: BATCH_SIZE,
    totalCountries: ALL_COUNTRIES.length,
    schedule: 'Warnstufen: tägl. 06:00 + 12:00 UTC | Texte+Level: Mo 07:00 UTC'
  });
});

// ── Cron ──────────────────────────────────────────────────────────────────────
cron.schedule('0 0 6 * * *',  () => updateWarnings(),        { timezone: 'UTC' });
cron.schedule('0 0 12 * * *', () => updateWarnings(),        { timezone: 'UTC' });
cron.schedule('0 0 7 * * 1',  () => updateTextsAndLevels(),  { timezone: 'UTC' });

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`Server Port ${PORT} | API Key: ${ANTHROPIC_API_KEY ? 'OK' : 'FEHLT'} | Modell: claude-haiku-4-5-20251001`);
  await updateWarnings();
  if (ANTHROPIC_API_KEY && Object.keys(textCache.data).length === 0) {
    console.log('Erster Start – generiere Texte+Level im Hintergrund...');
    updateTextsAndLevels();
  }
});
