"""Test de fumée de l'app, sans Google : le script Apps Script est simulé.

Usage (depuis la racine du dépôt) :
    pip install playwright && python -m playwright install chromium
    python tools/smoke_test.py

Le test sert l'app en local, se connecte avec un faux code, parcourt les onglets,
ajoute des articles de courses, ouvre la page des quêtes, puis enregistre des captures
dans tools/out/. Il échoue si la page affiche une erreur JavaScript.
"""
import json, os, subprocess, sys, time
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
}


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
                page.screenshot(path=f'{OUT}/{name}-accueil.png')
                page.click('.tabbar [data-tab=maison]'); page.wait_for_timeout(300)
                page.screenshot(path=f'{OUT}/{name}-routines.png', full_page=True)
                page.click('.tabbar [data-tab=courses]'); page.wait_for_timeout(300)
                if name == 'mobile':
                    for item in ['2 lait', 'pain', 'tomates x3']:
                        page.fill('#c-title', item); page.keyboard.press('Enter'); page.wait_for_timeout(150)
                    page.wait_for_timeout(800)
                    assert len(state['courses']) == 3, state['courses']
                page.screenshot(path=f'{OUT}/{name}-courses.png', full_page=True)
                page.click('.tabbar [data-tab=home]'); page.wait_for_timeout(300)
                page.click('.h2btn'); page.wait_for_timeout(400)
                if name == 'mobile':
                    before = state['projects'][0][4]
                    page.click('#qv-list .qcard >> nth=0 >> .chk >> nth=1'); page.wait_for_timeout(700)
                    assert state['projects'][0][4] != before, 'étape non cochée'
                    page.click('[data-act=undo-upd]'); page.wait_for_timeout(700)
                    assert state['projects'][0][4] == before, 'annulation ratée'
                page.screenshot(path=f'{OUT}/{name}-quetes.png')
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
