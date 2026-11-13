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
    'routines': [['r1', 'Kimchi', '💊', 'Médicament', '01/11/2026', '30', 'jours', '{}'],
                 ['r2', 'Plantes', '🪴', 'Monstera', '2026-11-10', '7', 'jours', '{}'],
                 ['r3', 'Maison', '💧', 'Brita', '2026-09-01', '4', 'semaines', '{}']],
    'shop': [['w1', '🎧', 'Casque', '120,00 €', 'Personne B', 'Bientôt', '', '', '', '{}']],
    'projects': [['p1', '🔧', 'Réparer robinet', 'oui', '✓ acheter joint\nchanger joint', '{"prio":"high"}'],
                 ['p2', '🍷', 'Vin chaud', '', 'acheter vin\nacheter épices', '{"notes":"Recette https://example.com"}']],
    'courses': [],
    'voyages': [],
}
# Voyages d'exemple, datés par rapport à aujourd'hui (un voyage dans 3 jours, un voyage passé)
_d = lambda n: (datetime.date.today() + datetime.timedelta(days=n)).isoformat()
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
             'events': [{'id': 'e1', 'summary': 'Vétérinaire', 'start': {'dateTime': time.strftime('%Y-%m-%dT18:00:00Z')}}]}
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
                    assert page.locator('.k2-dock .dk').count() == 6, 'raccourcis de la vue simple'
                    page.click('[data-act=hub-go][data-v=agenda]'); page.wait_for_timeout(300)
                    assert 'Vétérinaire' in page.inner_text('.sheet-card'); page.click('.sheet-x'); page.wait_for_timeout(200)
                    page.click('#viewtg'); page.wait_for_timeout(300)
                page.screenshot(path=f'{OUT}/{name}-accueil.png')
                page.click('.tabbar [data-tab=maison]'); page.wait_for_timeout(300)
                page.screenshot(path=f'{OUT}/{name}-routines.png', full_page=True)
                if name == 'mobile':
                    assert page.locator('#l-todoall .tarow').count() == 1, 'checklist À faire'
                    page.click('#l-todoall [data-act=care-chk]'); page.wait_for_timeout(800)
                    assert state['routines'][2][4] == time.strftime('%Y-%m-%d'), state['routines'][2]
                    assert 'Tout est à jour' in page.inner_text('#l-todoall')
                    page.click('[data-act=undo-upd]'); page.wait_for_timeout(800)
                    # le rond d'une carte de routine coche directement, et le texte ouvre la fiche
                    page.click('#l-Kimchi [data-act=care-chk]'); page.wait_for_timeout(800)
                    assert state['routines'][0][4] == time.strftime('%Y-%m-%d'), state['routines'][0]
                    page.click('#l-Kimchi [data-act=care-chk]'); page.wait_for_timeout(800)
                    assert state['routines'][0][4] != time.strftime('%Y-%m-%d'), 'le 2e tap devrait annuler'
                    page.click('#l-Kimchi .row .t'); page.wait_for_timeout(300)
                    assert page.is_visible('.sheet-card .bigdone'); page.click('.sheet-x'); page.wait_for_timeout(200)
                page.click('.tabbar [data-tab=courses]'); page.wait_for_timeout(300)
                if name == 'mobile':
                    assert page.is_visible('#c-title'), 'le champ d\'ajout doit être visible dans l\'onglet Courses'
                    for item in ['2 lait', 'pain', 'tomates x3']:
                        page.fill('#c-title', item); page.keyboard.press('Enter'); page.wait_for_timeout(150)
                    page.wait_for_timeout(800)
                    assert len(state['courses']) == 3, state['courses']
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
                page.screenshot(path=f'{OUT}/{name}-quetes.png')
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
                assert 'Transports' not in txt and 'Programme' not in txt and 'Aller' not in txt, txt
                assert page.input_value('[data-trip=startT]') == '08:35'
                page.screenshot(path=f'{OUT}/{name}-voyage.png')
                if name == 'mobile':
                    page.fill('[data-trip=endT]', '19:05'); page.locator('[data-trip=endT]').dispatch_event('change'); page.wait_for_timeout(800)
                    assert [r for r in state['voyages'] if r[0] == 'v1'][0][5] == _d(7) + ' 19:05', state['voyages'][0]
                    page.click('#vv-bil'); page.wait_for_timeout(200)
                    assert 'aucun lien' in page.inner_text('.sheet-card'), page.inner_text('.sheet-card')
                    page.fill('.sheet-card [data-bil]', 'https://www.sncf-connect.com/'); page.keyboard.press('Enter'); page.wait_for_timeout(800)
                    assert [r for r in state['voyages'] if r[0] == 'v1'][0][8] == 'https://www.sncf-connect.com/'
                    assert 'lien externe' in page.inner_text('.sheet-card') and page.is_visible('.sheet-card a[data-close]')
                    page.screenshot(path=f'{OUT}/{name}-billets-popup.png')
                    page.click('.sheet-x'); page.wait_for_timeout(200)
                    page.click('.vsec-h [data-act=v-add][data-v=activite]'); page.wait_for_timeout(300)
                    page.fill('.sheet-card [data-tf=title]', 'Fado au Clube')
                    page.screenshot(path=f'{OUT}/{name}-voyage-form.png')
                    page.click('[data-act=tf-save]'); page.wait_for_timeout(800)
                    assert any(r[3] == 'Fado au Clube' and r[2] == 'Activité' for r in state['voyages'])
                    page.click('[data-act=pack-fold]'); page.wait_for_timeout(1500)
                    tp = [r for r in state['voyages'] if r[2] == 'Valise' and r[1] == '']
                    assert len(tp) == 5, tp
                    page.click('[data-act=tpl-use] >> text=Camping'); page.wait_for_timeout(900)
                    pk = [r for r in state['voyages'] if r[1] == 'v1' and r[2] == 'Valise'][0]
                    assert 'Tente' in pk[9], pk
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
                    page.fill('[data-trip=title]', 'Rome'); page.fill('[data-trip=startD]', _d(20)); page.fill('[data-trip=startT]', '07:15')
                    page.screenshot(path=f'{OUT}/{name}-voyage-nouveau.png')
                    page.click('[data-act=trip-ok]'); page.wait_for_timeout(900)
                    assert not page.is_visible('#vview'), 'Valider ne referme pas la page'
                    rome = [r for r in state['voyages'] if r[3] == 'Rome' and r[2] == 'Voyage']
                    assert rome and rome[0][4] == _d(20) + ' 07:15', rome
                    page.screenshot(path=f'{OUT}/{name}-voyages-apres.png')
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
