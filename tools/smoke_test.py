"""Test de fumée de l'app, sans Google : le script Apps Script est simulé.

Usage (depuis la racine du dépôt) :
    pip install playwright && python -m playwright install chromium
    python tools/smoke_test.py

Le test sert l'app en local, se connecte avec un faux code, parcourt les onglets,
ajoute des articles de courses, ouvre la page des quêtes, puis enregistre des captures
dans tools/out/. Il échoue si la page affiche une erreur JavaScript.
"""
import datetime, json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'tools', 'out')
os.makedirs(OUT, exist_ok=True)
PORT = 8765
FAKE_API = 'https://script.google.com/macros/s/AKfycbFAKEfakeFAKEfake1234567890/exec'
FAKE_CODE = 'code-de-test-123'

# Données d'exemple, au format renvoyé par le script (lignes brutes du Sheet, sans l'en-tête)
state = {
    'routines': [['r1', 'Kimchi', '💊', 'Médicament', (datetime.date.today() - datetime.timedelta(days=15)).strftime('%d/%m/%Y'), '30', 'jours', '{}'],
                 ['r2', 'Plantes', '🪴', 'Monstera', (datetime.date.today() - datetime.timedelta(days=1)).isoformat(), '7', 'jours', '{}'],
                 ['r3', 'Maison', '💧', 'Brita', (datetime.date.today() - datetime.timedelta(days=60)).isoformat(), '4', 'semaines', '{}']],
    'shop': [['w1', '🎧', 'Casque', '120,00 €', 'Personne B', 'Bientôt', '', '', '', '{}']],
    'projects': [['p1', '🔧', 'Réparer robinet', 'oui', '✓ acheter joint\nchanger joint', '{"prio":"high"}'],
                 ['p2', '🍷', 'Vin chaud', '', 'acheter vin\nacheter épices', '{"notes":"Recette https://example.com"}'],
                 ['p3', '🎬', 'Aller au ciné', '', '', '{}'],
                 ['p4', '🪟', 'Changer les rideaux', '', '', '{}']],
    'courses': [],
    'voyages': [],
}
# Voyages d'exemple, datés par rapport à aujourd'hui (un voyage dans 3 jours, un voyage passé)
_d = lambda n: (datetime.date.today() + datetime.timedelta(days=n)).isoformat()
# Une date ecrite comme sur un billet francais : 25/11/2026
_fr_date = lambda iso: '%s/%s/%s' % (iso[8:10], iso[5:7], iso[0:4])
state['voyages'] = [
    ['v1', '', 'Voyage', 'Lisbonne', _d(3) + ' 08:35', _d(7) + ' 18:40', '', '', '', '', '', '{"emoji":"🏖️"}'],
    ['t1', 'v1', 'Trajet', 'Paris → Lisbonne', _d(3) + ' 08:35', _d(3) + ' 10:05', 'Orly 3', 'ABC123', 'https://example.com/billet', '', '', '{"mode":"avion","num":"TP433","seat":"14C"}'],
    ['t2', 'v1', 'Trajet', 'Lisbonne → Paris', _d(7) + ' 18:40', _d(7) + ' 22:05', 'LIS T1', 'ABC123', '', '', '', '{"mode":"avion","num":"TP438"}'],
    ['h1', 'v1', 'Hébergement', 'Casa Alfama', _d(3) + ' 15:00', _d(7) + ' 11:00', 'Rua da Rosa 12, Lisbonne', '012345', 'https://example.com/resa', 'Code porte 4821', '', '{}'],
    ['l1', 'v1', 'Transport sur place', 'Pass Viva Viagem', _d(3), _d(7), 'Aéroport', '', '', '', '', '{"mode":"metro"}'],
    ['a1', 'v1', 'Activité', 'Tram 28', _d(4) + ' 10:00', '', 'Martim Moniz', '', '', '', '', '{"emoji":"🚋","st":"idee"}'],
    ['a2', 'v1', 'Activité', 'Musée des azulejos', '', '', '', 'QX-7781', 'https://example.com/musee', '', '', '{"emoji":"🏛️","price":10,"st":"resa"}'],
    ['a3', 'v1', 'Activité', 'Pastéis de Belém', '', '', 'Belém', '', '', '', 'oui', '{"emoji":"🍽️"}'],
    ['v2', '', 'Voyage', 'Annecy', _d(-60), _d(-57), '', '', '', '', '', '{"emoji":"🏔️"}'],
    ['p2', 'v2', 'Valise', 'Valise', '', '', '', '', '', '✓ Maillot\n✓ Crème solaire', '', '{}'],
]


def handle(route):
    body = json.loads(route.request.post_data)
    if body.get('k') != FAKE_CODE:
        r = {'ok': False, 'error': 'auth'}
    elif body['a'] == 'load':
        r = {'ok': True, 'sheets': state, 'settings': {'hiddenEvents': [], 'eventNames': {}},
             'people': {'p1': 'Personne A', 'p2': 'Personne B'},
             'weather': {'city': 'Paris', 'temp': 7.2, 'cond': 'partly', 'label': 'Éclaircies', 'isDay': True, 'low': 4, 'high': 9},
             'events': [{'id': 'e1', 'summary': 'Vétérinaire', 'start': {'dateTime': (datetime.date.today() + datetime.timedelta(days=1)).strftime('%Y-%m-%dT18:00:00Z')}},
                        {'id': 'e2', 'summary': 'Train Paris → Bordeaux', 'start': {'dateTime': (datetime.date.today() + datetime.timedelta(days=26)).strftime('%Y-%m-%dT09:12:00')}},
                        {'id': 'e3', 'summary': 'Train Bordeaux → Paris', 'start': {'dateTime': (datetime.date.today() + datetime.timedelta(days=29)).strftime('%Y-%m-%dT17:40:00')}}]}
    elif body['a'] == 'put':
        rows = state[body['t']]
        for i, x in enumerate(rows):
            if x[0] == body['row'][0]:
                rows[i] = body['row']
                break
        else:
            rows.append(body['row'])
        r = {'ok': True}
    elif body['a'] == 'del':
        state[body['t']] = [x for x in state[body['t']] if x[0] != body['id']]
        r = {'ok': True}
    else:
        r = {'ok': True}
    route.fulfill(status=200, content_type='application/json', body=json.dumps(r))


class _Scope:
    """Donne à _pick un calendrier ailleurs que dans la fiche (ex. la page d'un voyage)."""
    act = 'vcal'
    def __init__(self, page, root): self._p, self._r = page, root
    def locator(self, sel): return self._p.locator(sel.replace('.sheet-card', self._r))
    def click(self, sel, **kw): return self._p.click(sel.replace('.sheet-card', self._r), **kw)
    def get_attribute(self, sel, name): return self._p.get_attribute(sel.replace('.sheet-card', self._r), name)
    def wait_for_timeout(self, ms): return self._p.wait_for_timeout(ms)


def _vcal(page): return _Scope(page, '#vv-body')


def _pick(page, day):
    """Clique le jour `day` (AAAA-MM-JJ) dans le calendrier de période, en naviguant au bon mois."""
    want = int(day[:4]) * 12 + int(day[5:7])
    for _ in range(26):
        cell = page.locator(f'.sheet-card .qcal [data-date="{day}"]')
        if cell.count():
            cell.click(); return
        shown = page.get_attribute('.sheet-card .qcal [data-date]', 'data-date')
        cur = int(shown[:4]) * 12 + int(shown[5:7])
        act = getattr(page, 'act', 'qcal')
        page.click('.sheet-card [data-act=%s-%s]' % (act, 'next' if want > cur else 'prev')); page.wait_for_timeout(120)
    raise AssertionError(f'jour {day} introuvable dans le calendrier')



def _billet_pdf(path, lignes):
    """Un PDF minimal, texte non compresse : sert de faux billet de train."""
    flux = "BT /F1 11 Tf 1 0 0 1 56 780 Tm 15 TL\n"
    for l in lignes:
        flux += "(" + l.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)") + ") Tj T*\n"
    flux += "ET"
    objs = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        "<< /Length %d >>\nstream\n%s\nendstream" % (len(flux), flux),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ]
    out, offs = "%PDF-1.4\n", []
    for i, o in enumerate(objs, 1):
        offs.append(len(out.encode('latin-1')))
        out += "%d 0 obj\n%s\nendobj\n" % (i, o)
    xref = len(out.encode('latin-1'))
    out += "xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for o in offs:
        out += "%010d 00000 n \n" % o
    out += "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    with open(path, 'wb') as f:
        f.write(out.encode('latin-1'))
    return path


def main():
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '-d', ROOT],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    errors = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            for name, vp in [('mobile', {'width': 390, 'height': 844}), ('desktop', {'width': 1440, 'height': 900})]:
                ctx = browser.new_context(viewport=vp, is_mobile=name == 'mobile', has_touch=name == 'mobile')
                page = ctx.new_page()
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
                page.route('https://script.google.com/**', handle)
                page.goto(f'http://localhost:{PORT}/#setup={FAKE_API}')
                page.fill('#login-code', FAKE_CODE)
                page.click('#login-go')
                page.wait_for_timeout(1000)
                # vue simple par défaut sur téléphone, détaillée sur ordinateur
                assert page.get_attribute('body', 'data-view') == ('simple' if name == 'mobile' else 'detail')
                page.screenshot(path=f'{OUT}/{name}-accueil-simple.png') if name == 'mobile' else None
                if name == 'mobile':
                    assert page.is_visible('.scene') and page.is_visible('.sc-trip'), 'vue simple (scène météo)'
                    # ranger l'accueil soi-même : appui long sur un bloc, puis glisser vers le haut
                    hb = lambda: page.locator('#hub3 .sc-rows .hbk').evaluate_all('es=>es.map(e=>e.dataset.hb)')
                    avant = hb()
                    assert len(avant) >= 3, avant
                    src = page.locator('#hub3 .sc-rows .hbk').nth(len(avant) - 1).bounding_box()
                    dst = page.locator('#hub3 .sc-rows .hbk').nth(0).bounding_box()
                    x, y = src['x'] + src['width'] / 2, src['y'] + 12
                    page.mouse.move(x, y)
                    page.mouse.down(); page.wait_for_timeout(500)      # l'appui long arme le glisser
                    assert page.locator('#hub3 .hbk.hdrag').count() == 1, 'le bloc se soulève'
                    while y > dst['y'] + 6:
                        y -= 20; page.mouse.move(x, y); page.wait_for_timeout(40)
                    page.screenshot(path=f'{OUT}/{name}-accueil-rangement.png')
                    page.mouse.up(); page.wait_for_timeout(500)
                    apres = hb()
                    assert apres[0] == avant[-1] and apres != avant, (avant, apres)
                    assert page.evaluate("localStorage.getItem('maison-home-ord')").split(',')[0] == apres[0]
                    page.reload(); page.wait_for_timeout(1800)
                    assert hb() == apres, ('l\'ordre choisi tient au rechargement', hb(), apres)
                    page.screenshot(path=f'{OUT}/{name}-accueil-range.png')
                    # un bouton de remise à zéro, visible seulement quand l'accueil a été rangé
                    assert page.locator('#hub3 .hreset').count() == 1, 'bouton d\'origine présent'
                    page.click('#hub3 .hreset'); page.wait_for_timeout(500)
                    assert hb() == avant, ('retour à l\'ordre d\'origine', hb(), avant)
                    assert page.locator('#hub3 .hreset').count() == 0, 'le bouton disparaît une fois remis'
                    assert not page.evaluate("localStorage.getItem('maison-home-ord')")
                    page.click('.sc-ev'); page.wait_for_timeout(300)
                    assert page.get_attribute('body', 'data-tab') == 'agenda' and 'Vétérinaire' in page.inner_text('#agtab') and 'Départ · Lisbonne' in page.inner_text('#agtab'), 'onglet Agenda'
                    page.screenshot(path=f'{OUT}/{name}-agenda.png')
                    txt = page.inner_text('#agtab').lower()
                    assert 'cette semaine' in txt and 'semaine prochaine' in txt and "semaine d'après" in txt and 'lun.' in txt, 'agenda par semaines'
                    page.click('.tabbar [data-tab=home]'); page.wait_for_timeout(300)
                    page.click('.head .calb'); page.wait_for_timeout(300)
                    assert page.get_attribute('body', 'data-tab') == 'agenda', 'bouton agenda en haut'
                    page.click('.tabbar [data-tab=home]'); page.wait_for_timeout(300)
                    page.click('.viewbot >> visible=true'); page.wait_for_timeout(300)
                page.screenshot(path=f'{OUT}/{name}-accueil.png')
                page.evaluate("(()=>{const b=document.createElement('button');b.dataset.act='tab';b.dataset.tab='maison';document.body.appendChild(b);b.click();b.remove()})()"); page.wait_for_timeout(300)
                page.screenshot(path=f'{OUT}/{name}-routines.png', full_page=True)
                if name == 'mobile':
                    assert page.locator('#l-todoall .tarow').count() == 1, 'checklist À faire'
                    page.click('#l-todoall [data-act=care-chk]'); page.wait_for_timeout(800)
                    assert state['routines'][2][4] == time.strftime('%Y-%m-%d'), state['routines'][2]
                    assert 'Tout est à jour' in page.inner_text('#l-todoall')
                    # faite aujourd'hui : elle reste barrée dans « À faire » jusqu'à minuit
                    assert page.locator('#l-todoall .tarow.done').count() == 1, 'la tâche faite reste listée'
                    assert 'Brita' in page.inner_text('#l-todoall .tarow.done')
                    assert 'line-through' in page.eval_on_selector(
                        '#l-todoall .tarow.done .t', 'e=>getComputedStyle(e).textDecorationLine')
                    assert page.locator('#l-todoall .tarow.done .chk.on').count() == 1, 'son rond reste coché'
                    page.screenshot(path=f'{OUT}/{name}-routines-faite.png')
                    page.click('[data-act=undo-upd]'); page.wait_for_timeout(800)
                    assert page.locator('#l-todoall .tarow.done').count() == 0, 'annuler la retire des faites'
                    # le rond d'une carte de routine coche directement, et le texte ouvre la fiche
                    page.click('#l-Kimchi [data-act=care-chk]'); page.wait_for_timeout(800)
                    assert state['routines'][0][4] == time.strftime('%Y-%m-%d'), state['routines'][0]
                    page.click('#l-Kimchi [data-act=care-chk]'); page.wait_for_timeout(800)
                    assert state['routines'][0][4] != time.strftime('%Y-%m-%d'), 'le 2e tap devrait annuler'
                    page.click('#l-Kimchi .row .t'); page.wait_for_timeout(300)
                    assert page.is_visible('.sheet-card .bigdone'); page.click('.sheet-x'); page.wait_for_timeout(200)
                    # déjà fait aujourd'hui : plus de gros bouton vert, un bouton discret qui annule
                    page.click('#l-Kimchi [data-act=care-chk]'); page.wait_for_timeout(800)
                    page.click('#l-Kimchi .row .t'); page.wait_for_timeout(300)
                    assert not page.is_visible('.sheet-card .bigdone') and page.is_visible('.sheet-card .donetoday')
                    page.click('.sheet-card .donetoday'); page.wait_for_timeout(800)
                    assert state['routines'][0][4] != time.strftime('%Y-%m-%d'), 'le bouton « fait aujourd\'hui » annule'
                    assert page.is_visible('.sheet-card .bigdone'), 'le gros bouton revient'
                    page.click('.sheet-x'); page.wait_for_timeout(200)
                    # mise en pause d'une tâche : elle quitte « À faire », puis revient avec Annuler
                    page.click('#l-Maison .row .t'); page.wait_for_timeout(300)
                    page.click('.sheet-card .snzc >> text=1 semaine'); page.wait_for_timeout(800)
                    assert 'snoozeUntil' in state['routines'][2][7], state['routines'][2]
                    assert page.locator('#l-todoall .tarow').count() == 0, 'tâche en pause masquée de À faire'
                    page.click('[data-act=undo-upd]'); page.wait_for_timeout(800)
                    assert page.locator('#l-todoall .tarow').count() == 1, 'la pause annulée remet la tâche'
                    # historique : page dédiée, jours faits marqués, on peut en ajouter et en retirer
                    page.click('#l-Kimchi .row .t'); page.wait_for_timeout(300)
                    page.click('.sheet-card [data-act=hist-open]'); page.wait_for_timeout(400)
                    assert page.is_visible('.hpage') and 'Historique' in page.inner_text('.hpage .qp-tt')
                    marked = page.locator('.hcal .cd.sel').count()
                    page.click(f'.hcal [data-date="{_d(-3)}"]'); page.wait_for_timeout(800)
                    assert _d(-3) in state['routines'][0][7], 'jour ajouté à l\'historique'
                    assert page.locator('.hcal .cd.sel').count() == marked + 1
                    page.click(f'.hcal [data-date="{_d(-3)}"]'); page.wait_for_timeout(800)
                    assert _d(-3) not in state['routines'][0][7], 'jour retiré de l\'historique'
                    page.click('.hpage [data-act=hist-close]'); page.wait_for_timeout(400)
                    assert page.is_visible('.sheet-card .panel') and not page.is_visible('.hpage'), 'retour sur la fiche'
                    page.click('.sheet-x'); page.wait_for_timeout(300)
                    # fiche d'une routine : icône + titre tout en haut, Rappel seul, Pause dans sa propre section
                    page.click('#l-Maison .row .t'); page.wait_for_timeout(300)
                    assert page.eval_on_selector('.sheet-card .panel', 'p => p.firstElementChild.classList.contains("ifield")'), 'icône et titre en haut'
                    assert page.locator('.sheet-card [data-field=name]').count() == 1, "un seul champ de titre"
                    assert page.locator('.sheet-card .lab').all_inner_texts() == ['Rappel', 'Pause'], page.locator('.sheet-card .lab').all_inner_texts()
                    assert page.locator('.sheet-card .thr:not(.snzrow) [data-snzn]').count() == 0, 'la pause ne doit pas être dans Rappel'
                    assert page.locator('.sheet-card .snzc').count() == 4, 'boutons rapides de pause'
                    page.click('.sheet-card [data-act=snz-other]'); page.wait_for_timeout(200)
                    page.fill('[data-snzn]', '5'); page.keyboard.press('Enter'); page.wait_for_timeout(600)
                    assert 'snoozeUntil' in state['routines'][2][7], 'Entrée dans le champ « Autre » valide la pause'
                    page.click('#l-Maison .row .t'); page.wait_for_timeout(300)
                    assert page.is_visible('.sheet-card [data-act=snooze-clear]'), 'bouton Reprendre quand la tâche est en pause'
                    page.click('.sheet-card [data-act=snooze-clear]'); page.wait_for_timeout(700)
                    assert 'snoozeUntil' not in state['routines'][2][7] or '"snoozeUntil":null' in state['routines'][2][7], state['routines'][2]
                    # une nouvelle tâche « tous les 1 jour » apparaît dans À faire (et les missions de l'accueil)
                    nb = page.locator('#l-todoall .tarow').count()
                    page.click('[data-act=care-add][data-group=Maison]'); page.wait_for_timeout(200)
                    page.fill('form.care-add[data-group=Maison] input', 'Vider le lave-vaisselle'); page.keyboard.press('Enter'); page.wait_for_timeout(500)
                    page.click('#l-Maison .row:has-text("Vider le lave-vaisselle") .t'); page.wait_for_timeout(300)
                    page.fill('.sheet-card [data-field=everyN]', '1'); page.keyboard.press('Tab'); page.wait_for_timeout(500)
                    page.click('.sheet-card [data-act=sheet-close].btn'); page.wait_for_timeout(500)
                    assert page.locator('#l-todoall .tarow').count() == nb + 1, ('tâche tous les 1 jour dans À faire', nb)
                    page.click('.tabbar [data-tab=home]'); page.wait_for_timeout(300)
                    assert 'Vider le lave-vaisselle' in page.inner_text('#l-main') + page.inner_text('#hub3'), 'missions maison sur l\'accueil'
                    page.evaluate("(()=>{const b=document.createElement('button');b.dataset.act='tab';b.dataset.tab='maison';document.body.appendChild(b);b.click();b.remove()})()"); page.wait_for_timeout(300)
                    # nouvelle section de routines : nom + icône, puis des tâches comme Kimchi / Maison
                    page.click('[data-act=grp-new]'); page.wait_for_timeout(300)
                    page.fill('.sheet-card [data-grp=name]', '🚲 Vélo'); page.click('.sheet-card [data-act=grp-save]'); page.wait_for_timeout(800)
                    grow = [r for r in state['routines'] if r[1] == 'Vélo']
                    assert grow and '"grp":1' in grow[0][7], state['routines']
                    page.click('.cgrp [data-act=care-add]'); page.wait_for_timeout(200)
                    page.fill('.cgrp form.care-add input', 'Gonfler les pneus'); page.keyboard.press('Enter'); page.wait_for_timeout(800)
                    assert any(r[1] == 'Vélo' and r[3] == 'Gonfler les pneus' for r in state['routines']), state['routines']
                    assert 'Gonfler les pneus' in page.inner_text('.cgrp'), 'la tâche s\'affiche dans sa section'
                    page.click('.cgrp .row .t'); page.wait_for_timeout(300)
                    page.fill('.sheet-card [data-field=everyN]', '7'); page.locator('.sheet-card [data-field=everyN]').dispatch_event('change'); page.wait_for_timeout(700)
                    page.click('.sheet-x'); page.wait_for_timeout(400)
                    assert 'Gonfler les pneus' in page.inner_text('#l-todoall'), 'avec un rappel, elle passe dans À faire'
                    assert 'Vélo' in page.inner_text('#l-todoall'), 'le nom de la section s\'affiche'
                    # renommer la section renomme ses tâches
                    page.click('.cgrp [data-act=grp-edit]'); page.wait_for_timeout(300)
                    page.fill('.sheet-card [data-grp=name]', 'Vélos'); page.click('.sheet-card [data-act=grp-save]'); page.wait_for_timeout(900)
                    assert all(r[1] == 'Vélos' for r in state['routines'] if r[3] == 'Gonfler les pneus' or '"grp":1' in r[7]), state['routines']
                page.click('.tabbar [data-tab=courses]'); page.wait_for_timeout(300)
                if name == 'mobile':
                    assert page.is_visible('#c-title'), 'le champ d\'ajout doit être visible dans l\'onglet Courses'
                    for item in ['2 lait', 'pain', 'tomates x3']:
                        page.fill('#c-title', item); page.keyboard.press('Enter'); page.wait_for_timeout(150)
                    page.wait_for_timeout(800)
                    assert len(state['courses']) == 3, state['courses']
                    first = page.eval_on_selector_all('#l-courses .crow:not(.done) .ct', 'e => e.map(x => x.textContent)')
                    assert first == ['tomates', 'pain', 'lait'], ('le dernier ajouté doit être en haut', first)
                    # appui long + glisser : « tomates » passe en dernier
                    rows = page.locator('#l-courses .crow:not(.done)')
                    r0 = rows.nth(0).bounding_box(); r2 = rows.nth(2).bounding_box()
                    page.mouse.move(r0['x'] + 60, r0['y'] + r0['height'] / 2); page.mouse.down(); page.wait_for_timeout(500)
                    for k in range(1, 11):
                        page.mouse.move(r0['x'] + 60, r0['y'] + r0['height'] / 2 + (r2['y'] + r2['height'] * .8 - r0['y'] - r0['height'] / 2) * k / 10); page.wait_for_timeout(40)
                    page.mouse.up(); page.wait_for_timeout(900)
                    order = page.eval_on_selector_all('#l-courses .crow:not(.done) .ct', 'e => e.map(x => x.textContent)')
                    assert order == ['pain', 'lait', 'tomates'], order
                    assert not any(r[5] for r in state['courses']), 'le glisser ne doit pas cocher'
                    assert '"ord"' in [r for r in state['courses'] if r[2] == 'tomates'][0][6], state['courses']
                if name == 'mobile':
                    # glisser un article au-delà de l'en-tête « Exceptionnel » : il change de catégorie
                    assert page.locator('#l-courses .csec').count() == 2, 'en-têtes Quotidien / Exceptionnel'
                    assert page.locator('#f-course .ccat').count() == 0, 'plus de sélecteur de catégorie à l\'ajout'
                    rows = page.locator('#l-courses .crow:not(.done)')
                    r2b = rows.nth(2).bounding_box()
                    hdr = page.locator('#l-courses .csec[data-sec=exc]').bounding_box()
                    y0 = r2b['y'] + r2b['height'] / 2; y1 = hdr['y'] + hdr['height'] + 12
                    page.mouse.move(r2b['x'] + 60, y0); page.mouse.down(); page.wait_for_timeout(500)
                    for k in range(1, 11):
                        page.mouse.move(r2b['x'] + 60, y0 + (y1 - y0) * k / 10); page.wait_for_timeout(40)
                    page.mouse.up(); page.wait_for_timeout(900)
                    tom = [r for r in state['courses'] if r[2] == 'tomates'][0]
                    assert '"cat":"exc"' in tom[6], tom
                    exc_rows = page.eval_on_selector_all('#l-courses .csec[data-sec=exc] ~ .crow:not(.done) .ct', 'e => e.map(x => x.textContent)')
                    assert exc_rows == ['tomates'], exc_rows
                    # filtre d'affichage : l'une, l'autre, ou les deux
                    page.click('#l-courses .cfil [data-v=exc]'); page.wait_for_timeout(300)
                    assert page.eval_on_selector_all('#l-courses .crow:not(.done) .ct', 'e => e.map(x => x.textContent)') == ['tomates']
                    page.click('#l-courses .cfil [data-v=std]'); page.wait_for_timeout(300)
                    assert page.eval_on_selector_all('#l-courses .crow:not(.done) .ct', 'e => e.map(x => x.textContent)') == ['pain', 'lait']
                    page.click('#l-courses .cfil [data-v=all]'); page.wait_for_timeout(300)
                    assert page.locator('#l-courses .csec').count() == 2
                page.screenshot(path=f'{OUT}/{name}-courses.png', full_page=True)
                page.click('.tabbar [data-tab=home]'); page.wait_for_timeout(300)
                if name == 'mobile':
                    before0 = state['projects'][0][4]
                    page.click('#l-main .tq-step:not(.done) .chk'); page.wait_for_timeout(800)
                    assert state['projects'][0][4] != before0, 'rond de la quête principale'
                    page.click('[data-act=undo-upd]'); page.wait_for_timeout(800)
                    assert state['projects'][0][4] == before0
                    page.click('#l-main .tq-st >> nth=0'); page.wait_for_timeout(300)
                    assert page.is_visible('.sheet-card .pj'), 'le texte doit ouvrir la quête'
                    page.click('.sheet-x'); page.wait_for_timeout(200)
                page.click('.h2btn'); page.wait_for_timeout(400)
                if name == 'mobile':
                    before = state['projects'][0][4]
                    page.click('#qt-list .qcard >> nth=0 >> .chk >> nth=1'); page.wait_for_timeout(700)
                    assert state['projects'][0][4] != before, 'étape non cochée'
                    page.click('[data-act=undo-upd]'); page.wait_for_timeout(700)
                    assert state['projects'][0][4] == before, 'annulation ratée'
                    # renommer une mini-quête en touchant son texte (Échap annule, Entrée enregistre)
                    orig_t = page.inner_text('#qt-list .qcard >> nth=0 >> .st-t >> nth=0')
                    page.click('#qt-list .qcard >> nth=0 >> .st-t >> nth=0'); page.wait_for_timeout(200)
                    assert page.is_visible('#qt-list .st-edit'), 'le texte doit devenir un champ'
                    page.fill('#qt-list .st-edit', 'Abandonnée'); page.keyboard.press('Escape'); page.wait_for_timeout(500)
                    assert 'Abandonnée' not in state['projects'][0][4] and orig_t in state['projects'][0][4], 'Échap doit annuler'
                    assert page.is_visible('#qt-list .qcard >> nth=0'), 'Échap ne doit pas fermer la page'
                    page.click('#qt-list .qcard >> nth=0 >> .st-t >> nth=0'); page.wait_for_timeout(200)
                    page.fill('#qt-list .st-edit', 'Étape renommée'); page.keyboard.press('Enter'); page.wait_for_timeout(700)
                    assert 'Étape renommée' in state['projects'][0][4] and orig_t not in state['projects'][0][4], state['projects'][0][4]
                    assert page.inner_text('#qt-list .qcard >> nth=0 >> .st-t >> nth=0') == 'Étape renommée'
                    page.click('#qt-list .qcard >> nth=0 >> .st-t >> nth=0'); page.wait_for_timeout(200)
                    page.fill('#qt-list .st-edit', orig_t); page.keyboard.press('Enter'); page.wait_for_timeout(700)
                    assert orig_t in state['projects'][0][4], 'retour au nom d\'origine'
                page.screenshot(path=f'{OUT}/{name}-quetes.png')
                if name == 'mobile':
                    # filtres par catégorie (devinées d'après le titre, puis choisies dans la quête)
                    page.click('.qfil [data-v=maison]'); page.wait_for_timeout(300)
                    titles = page.eval_on_selector_all('#qt-list .qv-list .qc-t', 'e => e.map(x => x.textContent)')
                    assert titles == ['Changer les rideaux'], titles
                    page.screenshot(path=f'{OUT}/{name}-quetes-filtre.png')
                    page.click('#qt-list .qv-list .qc-t'); page.wait_for_timeout(300)
                    page.select_option('.sheet-card [data-field=pcat]', 'date'); page.wait_for_timeout(700)
                    assert '"cat": "date"' in [r for r in state['projects'] if r[0] == 'p4'][0][5].replace('":"', '": "'), state['projects']
                    page.click('.sheet-x'); page.wait_for_timeout(300)
                    assert 'Rien dans' in page.inner_text('#qt-list'), 'filtre Maison vide'
                    page.click('.qfil [data-v=date]'); page.wait_for_timeout(300)
                    titles = page.eval_on_selector_all('#qt-list .qv-list .qc-t', 'e => e.map(x => x.textContent)')
                    assert sorted(titles) == ['Aller au ciné', 'Changer les rideaux'], titles
                    page.click('.qfil [data-v=all]'); page.wait_for_timeout(300)
                    # urgence : émoji + petit menu ; bouton Terminer
                    card = page.locator('#qt-list .qv-list .qcard', has_text='Aller au ciné')
                    card.locator('.prb').click(); page.wait_for_timeout(200)
                    assert page.is_visible('#prm'), 'menu urgence'
                    page.screenshot(path=f'{OUT}/{name}-quetes-prio.png')
                    page.click('#prm [data-v=high]'); page.wait_for_timeout(700)
                    assert '"prio": "high"' in [r for r in state['projects'] if r[0] == 'p3'][0][5].replace('":"', '": "'), state['projects']
                    assert not page.is_visible('#prm')
                    assert card.locator('.prb').inner_text() == '🔥'
                    assert page.locator('#qt-list .seg.status').count() == 0, 'plus de sélecteur de statut dans les cartes'
                    # carte compacte : pas d'éditeur, le rond termine une quête sans étape
                    assert card.locator('.stepform').count() == 0 and card.locator('.qc-f').count() == 0, 'carte compacte'
                    assert page.locator('#qt-list .qv-list .qc-pin').count() == 0, 'plus d\'épinglage sur les cartes'
                    card.locator('.qc-chk').click(); page.wait_for_timeout(700)
                    assert '"status": "done"' in [r for r in state['projects'] if r[0] == 'p3'][0][5].replace('":"', '": "')
                    page.click('[data-act=undo-upd]'); page.wait_for_timeout(700)
                if name == 'mobile':
                    # jusqu'à 3 quêtes principales, pas une de plus
                    page.click('#qt-list .qv-list .qc-t >> text=Vin chaud'); page.wait_for_timeout(300)
                    # la quête s'ouvre en page à part, avec des menus déroulants
                    assert page.is_visible('.sheet-card.page .qp-head') and page.locator('.sheet-card.page select').count() == 3
                    page.select_option('.sheet-card [data-field=pstatus]', 'doing'); page.wait_for_timeout(700)
                    assert '"status": "doing"' in [r for r in state['projects'] if r[2] == 'Vin chaud'][0][5].replace('":"', '": "')
                    page.select_option('.sheet-card [data-field=pstatus]', 'todo'); page.wait_for_timeout(700)
                    page.click('.sheet-card [data-act=pmain]'); page.wait_for_timeout(700)
                    assert page.get_attribute('.sheet-card .sw', 'aria-checked') == 'true', 'l\'interrupteur reste visible et coché'
                    # mise en pause depuis le détail : hors accueil, hors mise en avant, estompée dans la liste
                    assert page.inner_text('.sheet-card .qp-head .qpz') == 'En cours', 'bouton pause en haut à droite'
                    page.click('.sheet-card .qp-head .qpz'); page.wait_for_timeout(700)
                    assert '"paused"' in [r for r in state['projects'] if r[2] == 'Vin chaud'][0][5], state['projects']
                    assert page.inner_text('.sheet-card .qp-head .qpz') == 'En pause', 'le bouton devient Reprendre'
                    assert page.locator('.sheet-card .qp-sw').count() == 1, 'la pause n\'est plus dans les réglages'
                    page.click('.sheet-x'); page.wait_for_timeout(400)
                    assert page.locator('.qhero .qc-t >> text=Vin chaud').count() == 0, 'une quête en pause quitte la mise en avant'
                    zz = page.locator('#qt-list .qv-list .qcard.idle')
                    assert zz.count() == 1 and 'Vin chaud' in zz.inner_text() and 'En pause' in zz.inner_text()
                    assert page.eval_on_selector('#qt-list .qcard.idle', 'e => +getComputedStyle(e).opacity') < 1, 'carte estompée'
                    page.click('.tabbar [data-tab=home]'); page.wait_for_timeout(400)
                    assert 'Vin chaud' not in page.inner_text('#l-main'), 'absente de l\'accueil'
                    page.click('.h2btn'); page.wait_for_timeout(400)
                    page.click('#qt-list .qv-list .qc-t >> text=Vin chaud'); page.wait_for_timeout(300)
                    page.click('.sheet-card .qp-head .qpz'); page.wait_for_timeout(700)   # reprendre
                    page.click('.sheet-x'); page.wait_for_timeout(400)
                    assert page.locator('.qhero .qc-t >> text=Vin chaud').count() == 1, 'reprise : elle revient en avant'
                    page.click('#qt-list .qv-list .qc-t >> text=Changer les rideaux'); page.wait_for_timeout(300)
                    page.click('.sheet-card [data-act=pmain]'); page.wait_for_timeout(700)
                    page.click('.sheet-x'); page.wait_for_timeout(300)
                    assert sum(1 for r in state['projects'] if r[3] == 'oui') == 3, state['projects']
                    assert page.locator('.qhero .qcard').count() == 3, 'trois quêtes principales en avant'
                    assert 'Quêtes principales' in page.inner_text('.qhero-h')
                    page.click('#qt-list .qv-list .qc-t >> text=Aller au ciné'); page.wait_for_timeout(300)
                    page.click('.sheet-card [data-act=pmain]'); page.wait_for_timeout(500)
                    assert sum(1 for r in state['projects'] if r[3] == 'oui') == 3, 'pas de 4e quête principale'
                    page.click('.sheet-x'); page.wait_for_timeout(300)
                    # sur l'accueil, les 3 quêtes principales et leurs mini-quêtes
                    page.click('.tabbar [data-tab=home]'); page.wait_for_timeout(400)
                    assert page.locator('#l-main .tq').count() == 3, 'accueil : 3 quêtes principales'
                    page.click('.h2btn'); page.wait_for_timeout(400)
                    # on dépingle les 2 ajouts pour la suite du test
                    for t in ['Vin chaud', 'Changer les rideaux']:
                        page.click(f'.qhero .qc-t >> text={t}'); page.wait_for_timeout(300)
                        page.click('.sheet-card [data-act=pmain]'); page.wait_for_timeout(700)
                        page.click('.sheet-x'); page.wait_for_timeout(300)
                    assert sum(1 for r in state['projects'] if r[3] == 'oui') == 1, state['projects']
                    # période : pas encore commencée -> badge, absente de l'accueil
                    page.click('.qhero .qc-t >> text=Réparer robinet'); page.wait_for_timeout(300)
                    # un seul champ : « Choisir une date », puis un calendrier début → fin
                    assert page.inner_text('.sheet-card .qdbtn') == 'Choisir une date'
                    assert page.locator('.sheet-card [data-field=qfrom]').count() == 0, 'plus de deux champs date'
                    page.click('.sheet-card [data-act=qcal]'); page.wait_for_timeout(300)
                    assert page.is_visible('.sheet-card .qcal'), 'le calendrier s\'ouvre'
                    _pick(page, _d(5)); page.wait_for_timeout(700)
                    assert state['projects'][0][5].count('qfrom') == 1 and 'quntil' not in state['projects'][0][5], state['projects'][0]
                    assert page.is_visible('.sheet-card .qcal'), 'le calendrier reste ouvert pour une fin éventuelle'
                    assert page.locator('.sheet-card .cd.r0.only').count() == 1, 'un seul jour sélectionné'
                    assert '→' not in page.inner_text('.sheet-card .qdbtn'), 'une seule date : pas de flèche'
                    _pick(page, _d(8)); page.wait_for_timeout(700)   # un second jour plus tard = la fin
                    assert '"quntil"' in state['projects'][0][5], state['projects'][0]
                    assert not page.is_visible('.sheet-card .qcal'), 'le calendrier se referme une fois la fin choisie'
                    assert '→' in page.inner_text('.sheet-card .qdbtn')
                    page.click('.sheet-card [data-act=qdclear]'); page.wait_for_timeout(700)
                    assert page.inner_text('.sheet-card .qdbtn') == 'Choisir une date', 'la croix efface la période'
                    page.click('.sheet-card [data-act=qcal]'); page.wait_for_timeout(300)
                    _pick(page, _d(5)); page.wait_for_timeout(700)
                    assert '"qfrom"' in state['projects'][0][5], state['projects'][0]
                    page.click('.sheet-x'); page.wait_for_timeout(300)
                    assert page.locator('.qhero .qc-t >> text=Réparer robinet').count() == 0, 'pas encore commencée : quitte la mise en avant'
                    idle = page.locator('#qt-list .qv-list .qcard.idle >> nth=0')
                    assert 'Réparer robinet' in idle.inner_text() and 'à partir du' in idle.inner_text(), idle.inner_text()
                    assert page.eval_on_selector('#qt-list .qcard.idle', 'e => +getComputedStyle(e).opacity') < 1, 'estompée comme une quête en pause'
                    page.click('.tabbar [data-tab=home]'); page.wait_for_timeout(400)
                    assert page.locator('#l-main .tq:not(.tq-none)').count() == 0, 'pas encore commencée : pas sur l\'accueil'
                    page.click('.h2btn'); page.wait_for_timeout(400)
                    # période : terminée hier -> la quête est considérée comme faite
                    page.click('#qt-list .qv-list .qc-t >> text=Réparer robinet'); page.wait_for_timeout(300)
                    page.click('.sheet-card [data-act=qdclear]'); page.wait_for_timeout(600)
                    page.click('.sheet-card [data-act=qcal]'); page.wait_for_timeout(300)
                    _pick(page, _d(-3)); page.wait_for_timeout(600)
                    _pick(page, _d(-1)); page.wait_for_timeout(700)   # période terminée hier
                    page.click('.sheet-x'); page.wait_for_timeout(400)
                    assert page.locator('.qhero .qcard').count() == 0, 'la période passée sort la quête du héros'
                    assert 'Terminées' in page.inner_text('#qt-list'), 'la quête passée est dans Terminées'
                    page.click('#qt-list .donetog'); page.wait_for_timeout(400)
                    page.click('#qt-list .qcard.done .qc-t >> text=Réparer robinet'); page.wait_for_timeout(300)
                    page.click('.sheet-card [data-act=qdclear]'); page.wait_for_timeout(700)
                    page.click('.sheet-x'); page.wait_for_timeout(400)
                    assert page.locator('.qhero .qcard').count() == 1, 'période effacée : la quête revient'
                assert page.is_visible('.qhero'), 'onglet Quêtes'; page.click('.tabbar [data-tab=home]'); page.wait_for_timeout(300)
                # ---- Voyages ----
                assert page.is_visible('#trip-next'), 'pas de compte à rebours sur l\'accueil'
                page.screenshot(path=f'{OUT}/{name}-accueil-voyage.png')
                page.click('.tabbar [data-tab=voyage]'); page.wait_for_timeout(300)
                page.screenshot(path=f'{OUT}/{name}-voyages.png', full_page=True)
                assert page.is_visible('.thero .flap'), 'pas de compte à rebours dans la liste'
                sec = lambda: page.inner_text('.thero .fg >> nth=3')
                a = sec(); page.wait_for_timeout(1300); assert sec() != a, 'les secondes ne défilent pas'
                page.screenshot(path=f'{OUT}/{name}-voyages.png')
                page.click('.ttile >> nth=0'); page.wait_for_timeout(400)
                txt = page.inner_text('#vv-body')
                assert 'Transports' not in txt and 'Programme' not in txt, txt
                assert 'aller' in txt.lower() and 'retour' in txt.lower(), txt
                assert page.input_value('[data-trip=startT]') == '08:35'
                page.screenshot(path=f'{OUT}/{name}-voyage.png')
                if name == 'mobile':
                    # départ et retour dans le même calendrier
                    assert page.locator('[data-trip=startD]').count() == 0, 'plus de champs date séparés'
                    assert page.locator('#vv-body .vleg').count() == 2
                    assert 'aller' in page.inner_text('#vv-body .vleg >> nth=0').lower()
                    assert 'retour' in page.inner_text('#vv-body .vleg >> nth=1').lower()
                    page.click('#vv-body .vleg >> nth=0 >> [data-act=vcal]'); page.wait_for_timeout(300)
                    assert 'part' in page.inner_text('#vv-body .cal-t'), page.inner_text('#vv-body .cal-t')
                    _pick(_vcal(page), _d(9)); page.wait_for_timeout(700)
                    assert [r for r in state['voyages'] if r[0] == 'v1'][0][4].startswith(_d(9)), state['voyages'][0]
                    assert page.is_visible('#vv-body .qcal'), 'le calendrier reste ouvert pour le retour'
                    _pick(_vcal(page), _d(12)); page.wait_for_timeout(700)
                    assert [r for r in state['voyages'] if r[0] == 'v1'][0][5].startswith(_d(12)), state['voyages'][0]
                    assert not page.is_visible('#vv-body .qcal'), 'le calendrier se referme une fois le retour choisi'
                    jours = page.inner_text('#vv-body .vtrip')
                    assert page.locator('#vv-body .vfd.set').count() == 2 and 'Choisir' not in jours, jours
                    assert page.locator('#vv-body .vft.off').count() == 0, jours
                    # le champ date du retour ouvre le calendrier directement sur le retour
                    page.click('#vv-body .vleg >> nth=1 >> [data-act=vcal]'); page.wait_for_timeout(300)
                    assert 'retour' in page.inner_text('#vv-body .cal-t'), page.inner_text('#vv-body .cal-t')
                    page.click('#vv-body .vleg >> nth=1 >> [data-act=vcal]'); page.wait_for_timeout(300)
                    assert not page.is_visible('#vv-body .qcal'), 'retoucher le champ referme le calendrier'
                    page.fill('[data-trip=endT]', '19:05'); page.locator('[data-trip=endT]').dispatch_event('change'); page.wait_for_timeout(800)
                    assert [r for r in state['voyages'] if r[0] == 'v1'][0][5] == _d(12) + ' 19:05', state['voyages'][0]
                    page.click('#vv-bil'); page.wait_for_timeout(200)
                    assert 'aucun lien' in page.inner_text('.sheet-card'), page.inner_text('.sheet-card')
                    page.fill('.sheet-card [data-bil]', 'https://www.sncf-connect.com/'); page.keyboard.press('Enter'); page.wait_for_timeout(800)
                    assert [r for r in state['voyages'] if r[0] == 'v1'][0][8] == 'https://www.sncf-connect.com/'
                    assert 'lien externe' in page.inner_text('.sheet-card') and page.is_visible('.sheet-card a[data-close]')
                    page.screenshot(path=f'{OUT}/{name}-billets-popup.png')
                    page.click('.sheet-x'); page.wait_for_timeout(200)
                    # hébergement « chez quelqu'un » : juste un nom, pas d'adresse obligatoire
                    page.click('[data-act=v-add][data-v=logement]'); page.wait_for_timeout(300)
                    page.click('.sheet-card [data-act=tf-set][data-f=hk][data-v=ami]'); page.wait_for_timeout(300)
                    page.fill('.sheet-card [data-tf=title]', 'Chez Tonton'); page.click('[data-act=tf-save]'); page.wait_for_timeout(800)
                    r = [r for r in state['voyages'] if r[3] == 'Chez Tonton']
                    assert r and r[0][2] == 'Hébergement' and '"hk": "ami"' in r[0][11].replace('":"', '": "'), r
                    assert '🏡' in page.inner_text('#vv-body'), 'icône maison pour « chez quelqu\'un »'
                    assert page.is_visible('.vtodo .qc-prog'), 'barre de progression des trucs à faire'
                    if name == 'mobile':
                        page.click('[data-act=vview-close]'); page.wait_for_timeout(500)
                        # un trajet déjà dans l'agenda : l'app propose le voyage
                        g = page.locator('.tguess')
                        assert g.count() == 1 and 'Bordeaux' in g.inner_text(), g.inner_text() if g.count() else 'pas de proposition'
                        page.click('.tguess [data-act=tguess-add]'); page.wait_for_timeout(1200)
                        bx = [r for r in state['voyages'] if r[3] == 'Bordeaux']
                        assert bx and bx[0][4].endswith('09:12') and bx[0][5].endswith('17:40'), bx
                        assert page.locator('.tguess').count() == 0, 'la proposition disparaît une fois le voyage créé'
                        assert page.is_visible('#vview'), 'le voyage créé s\'ouvre'
                        assert 'Bordeaux' in page.inner_text('#vv-title')
                        # les heures sont lisibles, une ligne par trajet
                        assert page.locator('#vv-body .vleg').count() == 2
                        assert 'aller' in page.inner_text('#vv-body .vleg >> nth=0').lower()
                        page.click('[data-act=vview-close]'); page.wait_for_timeout(400)
                        # importer un billet PDF : tout est lu sur l'appareil, puis on valide
                        da, dr = _fr_date(_d(40)), _fr_date(_d(44))
                        pdf = _billet_pdf(f'{OUT}/billet.pdf', [
                            'Confirmation de voyage', 'Dossier : ZZTOP9',
                            'ALLER', da,
                            'PARIS MONTPARNASSE 1 ET 2 06h52',
                            'QUIMPER 11h04',
                            'TGV INOUI 8611 - Voiture 7 - Place 21',
                            'RETOUR', dr,
                            'QUIMPER 17h20', 'PARIS MONTPARNASSE 1 ET 2 21h35',
                            'TGV INOUI 8686 - Voiture 2 - Place 55'])
                        page.set_input_files('[data-billet]', pdf); page.wait_for_timeout(1800)
                        assert page.is_visible('.sheet-card'), 'la feuille de validation s\'ouvre'
                        txt = page.inner_text('.sheet-card')
                        assert 'billet' in txt.lower(), txt
                        assert page.input_value('[data-imp=dest]') == 'Quimper', page.input_value('[data-imp=dest]')
                        assert page.input_value('[data-imp="go.date"]') == _d(40)
                        assert page.input_value('[data-imp="go.dep"]') == '06:52'
                        assert page.input_value('[data-imp="go.arr"]') == '11:04'
                        assert page.input_value('[data-imp="back.date"]') == _d(44)
                        assert page.input_value('[data-imp="back.dep"]') == '17:20'
                        assert 'TGV INOUI 8611' in txt
                        page.screenshot(path=f'{OUT}/{name}-billet-lu.png')
                        page.click('[data-act=imp-create]'); page.wait_for_timeout(1400)
                        q = [r for r in state['voyages'] if r[3] == 'Quimper']
                        assert q, [r[3] for r in state['voyages']]
                        assert q[0][4] == f'{_d(40)} 06:52' and q[0][5] == f'{_d(44)} 17:20', q[0][4:6]
                        assert '8611' in q[0][11] and '11:04' in q[0][11], q[0][11]
                        assert page.is_visible('#vview') and 'Quimper' in page.inner_text('#vv-title')
                        tk = page.inner_text('#vv-body .vl-tk >> nth=0')
                        assert 'Quimper' in tk and '11:04' in tk and '8611' in tk, tk
                        page.screenshot(path=f'{OUT}/{name}-billet-voyage.png')
                        page.click('[data-act=vview-close]'); page.wait_for_timeout(400)
                        page.click('.ttile >> nth=0'); page.wait_for_timeout(500)
                    page.click('.vt-when [data-v=apres]'); page.fill('#vt-in', 'Développer les photos'); page.keyboard.press('Enter'); page.wait_for_timeout(800)
                    r = [r for r in state['voyages'] if r[3] == 'Développer les photos']
                    assert r and r[0][2] == 'Activité' and '"when": "apres"' in r[0][11].replace('":"', '": "'), r
                    assert 'au retour' in page.inner_text('.vtodo').lower()
                    page.click('.vtodo .tq-st >> text=Développer les photos'); page.wait_for_timeout(300)
                    page.click('.sheet-card [data-act=tf-set][data-v=avant]'); page.fill('.sheet-card [data-tf=title]', 'Fado au Clube')
                    page.screenshot(path=f'{OUT}/{name}-voyage-form.png')
                    page.click('[data-act=tf-save]'); page.wait_for_timeout(800)
                    r = [r for r in state['voyages'] if r[3] == 'Fado au Clube']
                    assert r and '"when": "avant"' in r[0][11].replace('":"', '": "'), r
                    page.screenshot(path=f'{OUT}/{name}-voyage-todo.png', full_page=True)
                    page.click('[data-act=pack-fold]'); page.wait_for_timeout(1500)
                    tp = [r for r in state['voyages'] if r[2] == 'Valise' and r[1] == '']
                    assert len(tp) == 5, tp
                    assert all('# ' in x[9] for x in tp), 'les listes types ont des titres de catégories'
                    page.click('[data-act=tpl-use] >> text=Camping'); page.wait_for_timeout(900)
                    pk = [r for r in state['voyages'] if r[1] == 'v1' and r[2] == 'Valise'][0]
                    assert 'Tente' in pk[9] and '# ' in pk[9], pk
                    assert page.locator('.vpack .pk-g').count() >= 3, 'titres de catégories dans la valise'
                    page.evaluate("document.getElementById('vview').scrollTop=99999"); page.wait_for_timeout(200)
                    page.screenshot(path=f'{OUT}/{name}-voyage-valise.png')
                    page.click('[data-act=tpl-from-pack]'); page.wait_for_timeout(300)
                    page.fill('.sheet-card [data-tpl=title]', 'Ski')
                    page.fill('.sheet-card [data-tplinput]', 'Gants'); page.keyboard.press('Enter'); page.wait_for_timeout(200)
                    page.screenshot(path=f'{OUT}/{name}-tpl-edit.png')
                    page.click('[data-act=tpl-save]'); page.wait_for_timeout(900)
                    ski = [r for r in state['voyages'] if r[3] == 'Ski' and r[1] == '']
                    assert ski and 'Gants' in ski[0][9] and 'Tente' in ski[0][9], ski
                    page.screenshot(path=f'{OUT}/{name}-tpl-mgr.png')
                    page.click('.trow >> nth=1 >> [data-act=tpl-del]'); page.wait_for_timeout(900)
                    assert len([r for r in state['voyages'] if r[2] == 'Valise' and r[1] == '']) == 5
                    page.click('.sheet-x'); page.wait_for_timeout(200)
                    page.click('[data-act=vview-close]'); page.wait_for_timeout(300)
                    page.click('[data-act=trip-new]'); page.wait_for_timeout(500)
                    page.fill('[data-trip=title]', 'Rome')
                    assert page.locator('#vv-body .vft.off').count() == 2, 'sans date, pas d\'heure \u00e0 saisir'
                    page.click('#vv-body .vleg >> nth=0 >> [data-act=vcal]'); page.wait_for_timeout(300)
                    _pick(_vcal(page), _d(20)); page.wait_for_timeout(600)   # la date d'abord, l'heure ensuite
                    page.fill('[data-trip=startT]', '07:15'); page.locator('[data-trip=startT]').dispatch_event('change'); page.wait_for_timeout(600)
                    page.screenshot(path=f'{OUT}/{name}-voyage-nouveau.png')
                    page.click('[data-act=trip-ok]'); page.wait_for_timeout(900)
                    assert not page.is_visible('#vview'), 'Valider ne referme pas la page'
                    rome = [r for r in state['voyages'] if r[3] == 'Rome' and r[2] == 'Voyage']
                    assert rome and rome[0][4] == _d(20) + ' 07:15', rome
                    page.screenshot(path=f'{OUT}/{name}-voyages-apres.png')
                ctx.close()

            # Passage de minuit : une tâche quotidienne faite le soir doit être à refaire
            # dès le lendemain, sans attendre 24 h.
            ctx = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
            page = ctx.new_page(); page.route('https://script.google.com/**', handle)
            soir = datetime.datetime.combine(datetime.date.today(), datetime.time(19, 30))
            page.clock.install(time=soir)
            state['routines'].append(['q1', 'Maison', '🗑️', 'Sortir les poubelles', '', '1', 'jours', '{}'])
            page.goto(f'http://localhost:{PORT}/#setup={FAKE_API}')
            page.fill('#login-code', FAKE_CODE); page.click('#login-go'); page.wait_for_timeout(1500)
            page.evaluate("(()=>{const b=document.createElement('button');b.dataset.act='tab';b.dataset.tab='maison';document.body.appendChild(b);b.click();b.remove()})()")
            page.wait_for_timeout(400)
            page.click('#l-Maison .row:has-text("Sortir les poubelles") .care-chk'); page.wait_for_timeout(900)
            pb = 'Sortir les poubelles'
            due = lambda: page.locator(f'#l-todoall .tarow:not(.done):has-text("{pb}")').count()
            fait = lambda: page.locator(f'#l-todoall .tarow.done:has-text("{pb}")').count()
            assert due() == 0 and fait() == 1, 'faite le soir : barrée, plus à faire'
            page.clock.fast_forward('04:40:00')        # on passe minuit (00:10)
            page.wait_for_timeout(1200)
            assert due() == 1 and fait() == 0, 'le lendemain : de nouveau à faire, et plus dans les faites'
            ctx.close()

            # Sécurité : un lien #setup= ne doit pas rediriger l'app vers un autre script
            # en gardant le code d'accès (il serait envoyé à ce script).
            OTHER = 'https://script.google.com/macros/s/AKfycbAUTREautreAUTRE0987654321/exec'
            ctx = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
            page = ctx.new_page(); page.route('https://script.google.com/**', handle)
            page.goto(f'http://localhost:{PORT}/#setup={FAKE_API}')
            page.fill('#login-code', FAKE_CODE); page.click('#login-go'); page.wait_for_timeout(1200)
            assert page.is_hidden('#login'), 'connexion initiale'
            page.on('dialog', lambda d: d.dismiss())          # on refuse le changement
            page.goto(f'http://localhost:{PORT}/#setup={OTHER}'); page.wait_for_timeout(1200)
            assert page.evaluate("localStorage.getItem('maison-api')") == FAKE_API, 'refus : le script ne change pas'
            assert page.evaluate("localStorage.getItem('maison-key')") == FAKE_CODE, 'refus : la session est gardée'
            page2 = ctx.new_page(); page2.route('https://script.google.com/**', handle)
            page2.on('dialog', lambda d: d.accept())          # on accepte le changement
            page2.goto(f'http://localhost:{PORT}/#setup={OTHER}'); page2.wait_for_timeout(1200)
            assert page2.evaluate("localStorage.getItem('maison-api')") == OTHER, 'accepté : le script change'
            assert page2.evaluate("localStorage.getItem('maison-key')") is None, 'accepté : le code est effacé, jamais envoyé au nouveau script'
            assert page2.is_visible('#login'), 'accepté : le code est redemandé'
            ctx.close()
            browser.close()
    finally:
        srv.terminate()
    if errors:
        print('ERREURS :', *errors, sep='\n  ')
        sys.exit(1)
    print('OK, captures dans', OUT)


if __name__ == '__main__':
    main()
