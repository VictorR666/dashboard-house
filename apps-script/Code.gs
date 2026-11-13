/**
 * @OnlyCurrentDoc
 *
 * Script du dashboard Maison : seul intermédiaire entre l'app et Google.
 * - Il n'ouvre QUE le Google Sheet auquel il est attaché (@OnlyCurrentDoc).
 * - Il ne fait que LIRE l'agenda (calendar.readonly), jamais d'écriture.
 * - Il n'accepte qu'une liste fermée d'actions, et seulement avec le code d'accès.
 *
 * Réglages (Paramètres du projet → Propriétés du script) :
 *   ACCESS_CODE   (obligatoire) le code d'accès, 12 caractères minimum
 *   CALENDAR_IDS  (optionnel)  identifiants des agendas à afficher, séparés par des virgules
 *   PERSON_1, PERSON_2 (optionnels) les deux prénoms affichés dans la wishlist
 *   WEATHER_LAT, WEATHER_LON, WEATHER_CITY (optionnels) — Paris par défaut
 */

var TABS = {
  routines: { name: 'Entretien', width: 8 },
  shop:     { name: 'Wishlist',  width: 10 },
  projects: { name: 'Quetes',    width: 6 },
  courses:  { name: 'Courses',   width: 7, header: ['id', 'icône', 'article', 'quantité', 'rayon', 'dans le panier', '_t'] },
  // text: true = chaque cellule est gardée en texte brut (références comme « 012345 », dates « 2026-12-20 08:35 »)
  voyages:  { name: 'Voyages',   width: 12, text: true,
              header: ['id', 'voyage', 'type', 'titre', 'début', 'fin', 'lieu', 'réf', 'lien', 'notes', 'fait', '_t'] }
};
var SETTINGS_TAB = 'Reglages';
var MAX_ROWS = 500;
var MAX_BODY = 100000;
var MAX_FAILS = 10;          // essais ratés avant blocage
var LOCK_SECONDS = 900;      // blocage de 15 minutes

function doPost(e) {
  var out;
  try {
    var raw = (e && e.postData && e.postData.contents) || '';
    if (raw.length > MAX_BODY) return json_({ ok: false, error: 'size' });
    var body = JSON.parse(raw || '{}');
    if (!checkKey_(body.k)) return json_({ ok: false, error: isLocked_() ? 'locked' : 'auth' });
    switch (body.a) {
      case 'load':    out = load_(); break;
      case 'put':     out = put_(body.t, body.row); break;
      case 'del':     out = del_(body.t, body.id); break;
      case 'setting': out = setting_(body.name, body.value); break;
      default: return json_({ ok: false, error: 'action' });
    }
    out.ok = true;
    return json_(out);
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'server' });
  }
}

/* ---------- Code d'accès + blocage après plusieurs essais ratés ---------- */
function isLocked_() { return !!CacheService.getScriptCache().get('lock'); }
function checkKey_(k) {
  var cache = CacheService.getScriptCache();
  if (cache.get('lock')) return false;
  var expected = PropertiesService.getScriptProperties().getProperty('ACCESS_CODE');
  if (!expected || expected.length < 12) return false; // pas de code valide = personne n'entre
  if (typeof k === 'string' && k.length <= 200 && safeEq_(k, expected)) return true;
  var n = Number(cache.get('fails') || 0) + 1;
  cache.put('fails', String(n), 600);
  if (n >= MAX_FAILS) { cache.put('lock', '1', LOCK_SECONDS); cache.remove('fails'); }
  return false;
}
function safeEq_(a, b) {
  var ha = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, a, Utilities.Charset.UTF_8);
  var hb = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, b, Utilities.Charset.UTF_8);
  var d = 0;
  for (var i = 0; i < ha.length; i++) d |= ha[i] ^ hb[i];
  return d === 0;
}

/* ---------- Lecture ---------- */
function load_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = {};
  Object.keys(TABS).forEach(function (k) { sheets[k] = readTab_(ss, TABS[k]); });
  var props = PropertiesService.getScriptProperties();
  var people = { p1: String(props.getProperty('PERSON_1') || '').slice(0, 30), p2: String(props.getProperty('PERSON_2') || '').slice(0, 30) };
  var res = { sheets: sheets, settings: readSettings_(ss), people: people, weather: null, events: null };
  try { res.weather = weather_(); } catch (e) { console.warn(e); }
  try { res.events = events_(); } catch (e) { console.warn(e); res.calError = true; }
  return res;
}
function nonEmpty_(x) { return String(x == null ? '' : x).trim() !== ''; }
function readTab_(ss, def) {
  var sh = ss.getSheetByName(def.name);
  if (!sh) return [];
  var last = Math.min(sh.getLastRow(), MAX_ROWS + 1);
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, def.width).getDisplayValues();
  var missing = [];
  vals.forEach(function (r, i) { if (r.some(nonEmpty_) && !nonEmpty_(r[0])) missing.push(i); });
  if (missing.length) { // donne un identifiant aux lignes ajoutées à la main dans le Sheet
    withLock_(function () {
      missing.forEach(function (i) {
        var cell = sh.getRange(i + 2, 1);
        if (!nonEmpty_(cell.getDisplayValue())) cell.setValue(newId_());
        vals[i][0] = cell.getDisplayValue();
      });
    });
  }
  return vals.filter(function (r) { return r.some(nonEmpty_); });
}
function readSettings_(ss) {
  var out = { hiddenEvents: [], eventNames: {} };
  var sh = ss.getSheetByName(SETTINGS_TAB);
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, Math.min(sh.getLastRow() - 1, 50), 2).getDisplayValues().forEach(function (r) {
    if (!(r[0] in SETTING_RULES)) return;
    try { var v = JSON.parse(r[1]); if (SETTING_RULES[r[0]](v)) out[r[0]] = v; } catch (e) {}
  });
  return out;
}

/* ---------- Écritures (liste fermée) ---------- */
function put_(t, row) {
  var def = TABS[t];
  if (!def) throw new Error('tab');
  if (!Array.isArray(row) || row.length !== def.width) throw new Error('row');
  var id = String(row[0] == null ? '' : row[0]);
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new Error('id');
  var clean = row.map(def.text ? textCell_ : cell_);
  withLock_(function () {
    var sh = sheet_(def);
    var n = findRow_(sh, def, id, true);
    if (n > MAX_ROWS + 1) throw new Error('full');
    sh.getRange(n, 1, 1, def.width).setValues([clean]);
  });
  return {};
}
function del_(t, id) {
  var def = TABS[t];
  if (!def) throw new Error('tab');
  id = String(id == null ? '' : id);
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new Error('id');
  withLock_(function () {
    var sh = sheet_(def);
    var n = findRow_(sh, def, id, false);
    if (n) sh.getRange(n, 1, 1, def.width).clearContent();
  });
  return {};
}
var SETTING_RULES = {
  hiddenEvents: function (v) {
    return Array.isArray(v) && v.length <= 500 && v.every(function (x) { return typeof x === 'string' && x.length <= 100; });
  },
  eventNames: function (v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    var ks = Object.keys(v);
    return ks.length <= 300 && ks.every(function (k) { return k.length <= 100 && typeof v[k] === 'string' && v[k].length <= 80; });
  }
};
function setting_(name, value) {
  if (!Object.prototype.hasOwnProperty.call(SETTING_RULES, name)) throw new Error('name');
  if (!SETTING_RULES[name](value)) throw new Error('value');
  var txt = JSON.stringify(value);
  if (txt.length > 40000) throw new Error('size');
  withLock_(function () {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(SETTINGS_TAB);
    if (!sh) { sh = ss.insertSheet(SETTINGS_TAB); sh.getRange(1, 1, 1, 2).setValues([['nom', 'valeur']]); }
    var last = sh.getLastRow(), n = 0;
    if (last >= 2) {
      var names = sh.getRange(2, 1, last - 1, 1).getDisplayValues();
      for (var i = 0; i < names.length; i++) if (names[i][0] === name) { n = i + 2; break; }
    }
    if (!n) n = Math.max(last, 1) + 1;
    sh.getRange(n, 1, 1, 2).setValues([[name, "'" + txt]]);
  });
  return {};
}

/* Neutralise toute valeur qui pourrait devenir une formule dans le Sheet. */
function cell_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : '';
  if (typeof v === 'boolean') return v ? 'oui' : '';
  var s = String(v == null ? '' : v).slice(0, 5000);
  if (/^[=+\-@\t\r|]/.test(s)) s = "'" + s;
  return s;
}
/* Texte brut : l'apostrophe initiale empêche toute formule ET toute conversion en nombre ou en date. */
function textCell_(v) {
  if (typeof v === 'number') v = isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') v = v ? 'oui' : '';
  var s = String(v == null ? '' : v).slice(0, 5000);
  return s ? "'" + s : '';
}
function sheet_(def) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(def.name);
  if (!sh && def.header) { // onglet créé automatiquement (ex. Courses)
    sh = ss.insertSheet(def.name);
    sh.getRange(1, 1, 1, def.width).setValues([def.header]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  if (!sh) throw new Error('missing tab');
  return sh;
}
function findRow_(sh, def, id, orFree) {
  var last = sh.getLastRow();
  if (last >= 2) {
    var vals = sh.getRange(2, 1, Math.min(last - 1, MAX_ROWS), def.width).getDisplayValues();
    for (var i = 0; i < vals.length; i++) if (String(vals[i][0]).trim() === id) return i + 2;
    if (orFree) {
      for (var j = 0; j < vals.length; j++) if (!vals[j].some(nonEmpty_)) return j + 2;
      return vals.length + 2;
    }
    return 0;
  }
  return orFree ? 2 : 0;
}
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function newId_() { return 'g' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

/* ---------- Agenda (lecture seule, strict minimum) ---------- */
function events_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('events');
  if (hit) return JSON.parse(hit);
  var ids = (PropertiesService.getScriptProperties().getProperty('CALENDAR_IDS') || '')
    .split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  var tz = Session.getScriptTimeZone();
  var now = new Date();
  var start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var end = new Date(start.getTime() + 35 * 864e5);
  var out = [], seen = {};
  ids.forEach(function (id) {
    var c = CalendarApp.getCalendarById(id);
    if (!c) { console.warn('Agenda introuvable : ' + id); return; }
    c.getEvents(start, end).forEach(function (ev) {
      var allDay = ev.isAllDayEvent();
      var st = allDay ? { date: Utilities.formatDate(ev.getAllDayStartDate(), tz, 'yyyy-MM-dd') }
                      : { dateTime: ev.getStartTime().toISOString() };
      var title = String(ev.getTitle() || '').slice(0, 120);
      var key = title + '|' + (st.date || st.dateTime);
      if (seen[key]) return;
      seen[key] = 1;
      out.push({ id: shortHash_(ev.getId() + '|' + (st.date || st.dateTime)), summary: title, start: st });
    });
  });
  out.sort(function (a, b) {
    return (a.start.dateTime || a.start.date + 'T00:00') < (b.start.dateTime || b.start.date + 'T00:00') ? -1 : 1;
  });
  out = out.slice(0, 80);
  cache.put('events', JSON.stringify(out), 300);
  return out;
}
function shortHash_(s) {
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(d).slice(0, 16);
}

/* ---------- Météo (Open-Meteo, seules les coordonnées sont envoyées) ---------- */
function weather_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('weather');
  if (hit) return JSON.parse(hit);
  var p = PropertiesService.getScriptProperties();
  var lat = Number(p.getProperty('WEATHER_LAT') || 48.8566), lon = Number(p.getProperty('WEATHER_LON') || 2.3522);
  var city = String(p.getProperty('WEATHER_CITY') || 'Paris').slice(0, 40);
  var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
    '&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min&timezone=Europe%2FParis&forecast_days=1';
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: false });
  if (res.getResponseCode() !== 200) return null;
  var j = JSON.parse(res.getContentText());
  var code = j.current.weather_code, cond, label;
  if (code === 0) { cond = 'clear'; label = j.current.is_day ? 'Ensoleillé' : 'Dégagé'; }
  else if (code <= 2) { cond = 'partly'; label = 'Éclaircies'; }
  else if (code === 3) { cond = 'cloudy'; label = 'Nuageux'; }
  else if (code === 45 || code === 48) { cond = 'fog'; label = 'Brouillard'; }
  else if ((code >= 71 && code <= 77) || code === 85 || code === 86) { cond = 'snow'; label = 'Neige'; }
  else if (code >= 95) { cond = 'storm'; label = 'Orage'; }
  else { cond = 'rain'; label = 'Pluie'; }
  var w = { city: city, temp: j.current.temperature_2m, cond: cond, label: label, isDay: !!j.current.is_day,
            low: j.daily.temperature_2m_min[0], high: j.daily.temperature_2m_max[0] };
  cache.put('weather', JSON.stringify(w), 1800);
  return w;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- À lancer une fois depuis l'éditeur : autorise le script et vérifie les réglages ---------- */
function verifier() {
  var p = PropertiesService.getScriptProperties();
  var code = p.getProperty('ACCESS_CODE') || '';
  console.log(code.length >= 12 ? '✅ Code d\'accès défini' : '❌ ACCESS_CODE manquant ou trop court (12 caractères minimum)');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABS).forEach(function (k) {
    var sh = ss.getSheetByName(TABS[k].name) || (TABS[k].header ? sheet_(TABS[k]) : null);
    console.log(sh ? '✅ Onglet ' + TABS[k].name + ' : ' + Math.max(sh.getLastRow() - 1, 0) + ' lignes' : '❌ Onglet ' + TABS[k].name + ' introuvable');
  });
  var ids = (p.getProperty('CALENDAR_IDS') || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (!ids.length) console.log('ℹ️ Aucun agenda configuré (CALENDAR_IDS)');
  ids.forEach(function (id, i) {
    var c = CalendarApp.getCalendarById(id);
    console.log(c ? '✅ Agenda n°' + (i + 1) + ' accessible' : '❌ Agenda n°' + (i + 1) + ' introuvable : accepte le partage reçu par e-mail sur le compte dédié');
  });
  CacheService.getScriptCache().removeAll(['events', 'weather']);
  try { console.log(weather_() ? '✅ Météo OK' : '❌ Météo indisponible'); } catch (e) { console.log('❌ Météo : ' + e); }
}
