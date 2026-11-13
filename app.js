/* Dashboard Maison — app autonome.
   Les données vivent dans le Google Sheet de la maison. L'app ne parle qu'au script Google (Apps Script)
   du Sheet, avec un code d'accès. Aucun identifiant (Sheet, agenda, code) n'est écrit dans ce fichier. */
(function(){
  'use strict';
  var COL={projects:'projects',routines:'routines',shop:'shopping'};
  var S={projects:[],routines:[],shop:[]};
  var GROUPS=['Kimchi','Plantes','Maison'];
  var PRIO={high:'Urgent',med:'Pas urgent',low:'Optionnel'}, PW={high:3,med:2,low:1};
  var NEXT={todo:'doing',doing:'done',done:'todo'};
  var loaded={};
  var cal={status:'loading',events:[]};
  var CHECK='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function $(id){return document.getElementById(id)}
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function pad(n){return String(n).padStart(2,'0')}
  function iso(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())}
  function parse(s){var p=s.split('-').map(Number);return new Date(p[0],p[1]-1,p[2])}
  function t0(){var d=new Date();d.setHours(0,0,0,0);return d}
  function diff(s){return Math.round((parse(s)-t0())/864e5)}
  function cap(s){return s.charAt(0).toUpperCase()+s.slice(1)}
  function safeUrl(u){u=String(u||'').trim();if(!u)return '';if(!/^https?:\/\//i.test(u))u='https://'+u;return /^https?:\/\/[^\s<>"']+$/i.test(u)?u:''}

  /* ---- Connexion au script Google ---- */
  var LS_API='maison-api',LS_KEY='maison-key',CK='maison-cache-v2';
  var API_RE=/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/;
  function lsGet(k){try{return localStorage.getItem(k)}catch(e){return null}}
  function lsSet(k,v){try{if(v==null)localStorage.removeItem(k);else localStorage.setItem(k,v)}catch(e){}}
  var API=lsGet(LS_API),KEY=lsGet(LS_KEY);
  if(API&&!API_RE.test(API))API=null;
  /* accepte l'adresse du script seule, encodée, ou le lien d'installation complet */
  function normApi(v){v=String(v||'').trim();var m=v.match(/#setup=(.+)$/);if(m)v=m[1];
    for(var i=0;i<2&&/%2F/i.test(v);i++){try{v=decodeURIComponent(v)}catch(e){break}}
    v=v.replace(/\s+/g,'').replace(/\/exec[?#].*$/,'/exec');return v}
  (function(){ /* lien d'installation : …/#setup=<adresse du script> (le # n'est jamais envoyé à un serveur) */
    var m=location.hash.match(/^#setup=(.+)$/);
    if(m){var u=normApi(m[1]);
      if(API_RE.test(u)){API=u;lsSet(LS_API,u)}
      try{history.replaceState(null,'',location.pathname+location.search)}catch(e){}}
  })();

  function AuthError(code){this.code=code}
  async function api(action,data){
    if(!API||!KEY)throw new AuthError('auth');
    var ctl=new AbortController(),tm=setTimeout(function(){ctl.abort()},30000);
    try{
      var res=await fetch(API,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(Object.assign({k:KEY,a:action},data||{})),
        redirect:'follow',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:ctl.signal});
      var j=await res.json();
      if(!j||j.ok!==true){if(j&&(j.error==='auth'||j.error==='locked'))throw new AuthError(j.error);throw new Error((j&&j.error)||'erreur')}
      return j;
    }finally{clearTimeout(tm)}
  }
  function showLogin(msg){
    var L=$('login');L.hidden=false;
    $('login-url').hidden=!!API;$('login-url').required=!API;
    $('login-err').textContent=msg||'';
    setTimeout(function(){(API?$('login-code'):$('login-url')).focus()},50);
  }
  function logout(msg){
    KEY=null;lsSet(LS_KEY,null);lsSet(CK,null);
    S={projects:[],routines:[],shop:[]};PEOPLE={p1:'',p2:''};cal={status:'loading',events:[]};W=null;HID=[];EVN={};sig='';
    render();renderCal();renderWeather();
    showLogin(msg);
  }
  function authFail(e){
    if(e&&e.code==='locked'){logout('Trop d\'essais ratés. Réessaie dans 15 minutes.');return true}
    if(e&&e.code==='auth'){logout(KEY?'Code d\'accès refusé ou changé.':'');return true}
    return false;
  }
  $('login-form').addEventListener('submit',async function(e){
    e.preventDefault();
    var u=normApi($('login-url').value),c=$('login-code').value;
    if(!API){if(!API_RE.test(u)){$('login-err').textContent='Adresse du script invalide.';return}API=u;lsSet(LS_API,u)}
    KEY=c;$('login-go').disabled=true;$('login-err').textContent='';
    try{var j=await api('load');lsSet(LS_KEY,c);$('login-code').value='';$('login').hidden=true;applyLoad(j);startPolling()}
    catch(err){KEY=null;
      $('login-err').textContent=err&&err.code==='locked'?'Trop d\'essais ratés. Réessaie dans 15 minutes.':err&&err.code==='auth'?'Code incorrect.':'Le script ne répond pas. Vérifie ta connexion.'}
    $('login-go').disabled=false;
  });

  /* ---- Google Sheet : conversion lignes <-> objets ---- */
  var SHT={
    routines:{cols:['id','group','emoji','title','lastDone','everyN','everyUnit','_t']},
    shop:{cols:['id','emoji','title','budget','who','urgency','link','note','done','_t']},
    projects:{cols:['id','emoji','title','main','steps','_t']}
  };
  function nrm(v){return String(v==null?'':v).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')}
  function nDate(v){v=String(v==null?'':v).trim();if(!v)return null;var m;
    if((m=v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)))return m[1]+'-'+pad(m[2])+'-'+pad(m[3]);
    if((m=v.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/))){var y=m[3].length===2?'20'+m[3]:m[3];return y+'-'+pad(m[2])+'-'+pad(m[1])}
    if(/^\d{5}(\.\d+)?$/.test(v)){var d=new Date(Date.UTC(1899,11,30)+Math.floor(+v)*864e5);return d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+pad(d.getUTCDate())}
    return null}
  function yes(v){return /^(oui|yes|x|vrai|true|1|ok|fait|✓|✔|✅)$/i.test(String(v==null?'':v).trim())}
  var URG={'un jour':'low',low:'low',bientot:'med',med:'med',vite:'high',high:'high',urgent:'high'};
  var URGL={low:'Un jour',med:'Bientôt',high:'Vite'};
  var DONE_RE=/^(✓|✔|✅|\[x\]|x\s)\s*/i;
  var PEOPLE={p1:'',p2:''}; /* prénoms : réglés dans le script Google, jamais dans le code */
  function setPeople(pp){pp=pp||{};PEOPLE={p1:String(pp.p1||'').slice(0,30),p2:String(pp.p2||'').slice(0,30)}}
  function fromRow(k,r,i){var c=SHT[k].cols,o={},t={};
    try{t=JSON.parse(r[c.indexOf('_t')]||'{}')||{}}catch(e){t={}}
    if(typeof t!=='object'||Array.isArray(t))t={};
    Object.assign(o,t);
    c.forEach(function(f,j){if(f!=='_t')o[f]=r[j]==null?'':String(r[j]).trim()});
    if(!o.createdAt)o.createdAt=9e12+i;
    if(k==='routines'){o.lastDone=nDate(o.lastDone);o.everyN=o.everyN?(Number(String(o.everyN).replace(',','.'))||''):'';o.everyUnit=/^s/i.test(o.everyUnit)?'sem':'j';o.mode='rec';
      var g=nrm(o.group);o.group=g.indexOf('plant')===0?'Plantes':g.indexOf('kim')===0||g.indexOf('chien')===0?'Kimchi':'Maison'}
    if(k==='shop'){o.budget=o.budget?(Number(String(o.budget).replace(/[^\d.,]/g,'').replace(',','.'))||''):'';
      var w=nrm(o.who);o.who=(PEOPLE.p1&&w===nrm(PEOPLE.p1))?'p1':(PEOPLE.p2&&w===nrm(PEOPLE.p2))?'p2':'couple';o.urgency=URG[nrm(o.urgency)]||'med';o.done=yes(o.done)}
    if(k==='projects'){o.main=yes(o.main);o.steps=String(o.steps||'').split(/\n/).map(function(x){return x.trim()}).filter(Boolean).map(function(x){return {t:x.replace(DONE_RE,''),done:DONE_RE.test(x)}})}
    return o}
  function toRow(k,o){var c=SHT[k].cols,t={};
    Object.keys(o).forEach(function(f){if(c.indexOf(f)<0&&f!=='mode'&&o[f]!=null&&!(f==='createdAt'&&o[f]>=9e12))t[f]=o[f]});
    return c.map(function(f){var v=o[f];
      if(f==='_t')return JSON.stringify(t);
      if(k==='routines'&&f==='everyUnit')return v==='sem'?'semaines':'jours';
      if(k==='shop'&&f==='who')return (v==='p1'||v==='p2')&&PEOPLE[v]?PEOPLE[v]:'Couple';
      if(k==='shop'&&f==='urgency')return URGL[v]||'Bientôt';
      if((k==='shop'&&f==='done')||(k==='projects'&&f==='main'))return v?'oui':'';
      if(k==='projects'&&f==='steps')return (v||[]).map(function(x){return (x.done?'✓ ':'')+x.t}).join('\n');
      if(typeof v==='number')return v;
      return v==null?'':String(v)})}

  /* ---- Chargement et écritures ---- */
  var sig='',busy=false,Q=Promise.resolve(),soonT=null,pollT=null;
  function applyLoad(j){
    var s=JSON.stringify([j.sheets,j.settings,j.events,j.weather,j.calError||null,j.people||null]);
    if(fromCache){fromCache=false;$('banner').innerHTML=''}
    loaded.projects=loaded.routines=loaded.shop=true;
    if(s===sig)return;sig=s;
    setPeople(j.people);
    Object.keys(SHT).forEach(function(k){var list=[];
      ((j.sheets&&j.sheets[k])||[]).forEach(function(r,i){if(!Array.isArray(r))return;var o=fromRow(k,r,i);if(!o.title||!o.id)return;list.push(o)});
      S[k]=list});
    var st=j.settings||{};HID=Array.isArray(st.hiddenEvents)?st.hiddenEvents.map(String):[];EVN=(st.eventNames&&typeof st.eventNames==='object')?st.eventNames:{};
    W=j.weather||null;
    if(Array.isArray(j.events))cal={status:'ok',events:j.events};else if(cal.status!=='ok')cal={status:'error',events:[]};
    renderWeather();renderCal();render();
  }
  async function load(){
    if(busy||!KEY)return;busy=true;
    try{applyLoad(await api('load'))}
    catch(e){if(!authFail(e)){if(cal.status!=='ok'){cal={status:'error',events:[]};renderCal()}if(!fromCache)$('banner').innerHTML='<div class="note">Le script ne répond pas pour le moment.</div>'}}
    busy=false;
  }
  function startPolling(){clearInterval(pollT);pollT=setInterval(function(){if(!document.hidden)load()},60000)}
  function queue(fn){var run=function(){return Promise.resolve().then(fn)};
    Q=Q.then(run).catch(function(e){if(e instanceof AuthError)throw e;return new Promise(function(ok){setTimeout(ok,1500)}).then(run)})
      .then(soon,function(e){if(!authFail(e)){sig='';fail()}soon()});return Q}
  function soon(){clearTimeout(soonT);soonT=setTimeout(load,2500)}
  function shWrite(k,o){var row=toRow(k,o);return queue(function(){return api('put',{t:k,row:row})})}
  function shDel(k,id){return queue(function(){return api('del',{t:k,id:id})})}
  function saveSetting(name,value){return queue(function(){return api('setting',{name:name,value:value})})}

  function upd(key,id,data){var it=find(key,id);if(!it)return;Object.assign(it,data);render();return shWrite(key,it)}
  function fail(){$('banner').innerHTML='<div class="note">Enregistrement impossible. Recharge la page.</div>'}
  function steps(o){return (o.steps||[]).map(function(x){return {t:x.t,done:!!x.done}})}
  function find(key,id){return S[key].find(function(x){return x.id===id})}
  function empty(key,txt){return '<p class="empty">'+(loaded[key]?txt:'Chargement…')+'</p>'}

  /* care cards: "Fait il y a X jours", tinted by each item's own thresholds */
  var openId=null,confirmDel=null,projId=null;
  function splitEmoji(v){
    var m=String(v).match(/^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)\s*([\s\S]*)$/u);
    return m?{emoji:m[1],title:m[2].trim().slice(0,80)}:{emoji:'',title:String(v).trim().slice(0,80)};
  }
  var calFor=null,calMonth=null;
  function calHtml(r){
    var m=calMonth,y=m.getFullYear(),mo=m.getMonth();
    var startDow=(new Date(y,mo,1).getDay()+6)%7,days=new Date(y,mo+1,0).getDate(),today=iso(new Date()),sel=r.lastDone||'';
    var nowM=new Date(),isLast=(y>nowM.getFullYear()||(y===nowM.getFullYear()&&mo>=nowM.getMonth()));
    var h='<div class="cal"><div class="cal-h"><button class="lnk" data-act="cal-prev" aria-label="Mois précédent">‹</button><b>'+esc(cap(m.toLocaleDateString('fr-FR',{month:'long',year:'numeric'})))+'</b><button class="lnk" data-act="cal-next" aria-label="Mois suivant"'+(isLast?' disabled':'')+'>›</button></div><div class="cal-g">';
    ['L','M','M','J','V','S','D'].forEach(function(d){h+='<i>'+d+'</i>'});
    for(var k=0;k<startDow;k++)h+='<span></span>';
    for(var d=1;d<=days;d++){
      var di=y+'-'+pad(mo+1)+'-'+pad(d);
      h+='<button class="cd'+(di===sel?' sel':'')+(di===today?' today':'')+'" data-act="cal-pick" data-id="'+esc(r.id)+'" data-date="'+di+'"'+(di>today?' disabled':'')+'>'+d+'</button>';
    }
    return h+'</div></div>';
  }
  function everyDays(r){var n=Number(r.everyN);if(!(n>0))return 0;return r.everyUnit==='sem'?n*7:n}
  var iconOpen=false;
  var AUTO=[[/vin|biere|apero|cocktail|cidre/,'🍷'],[/noel|sapin/,'🎄'],[/cadeau|anniv|surprise|fete/,'🎁'],[/kimchi|chou|cuisin|recette|repas|gateau|pizza|soupe|manger|diner|dejeuner|four\b/,'🍳'],[/joint|bricol|repar|perceu|visser|monter|plomb|robinet|serrure|colle/,'🔧'],[/peintur|peindre|deco|cadre|tableau|mur\b/,'🎨'],[/douche|bain|toilett/,'🛁'],[/linge|lessive|drap/,'🧺'],[/menage|nettoy|aspir|vitre|poussiere|balai|serpill/,'🧹'],[/plante|arros|rempot|jardin|fleur|monstera|lierre|pachira/,'🪴'],[/medic|veto|croquette|promen|laisse|chien|chat\b/,'💊'],[/brita|filtre|eau\b/,'💧'],[/voyage|vacances|vol\b|avion|week-?end|billet|hotel|train/,'✈️'],[/livre|lire|roman|bd\b/,'📚'],[/film|serie|cine|netflix/,'🎬'],[/musique|concert|guitare|piano/,'🎵'],[/sport|courir|gym|velo|yoga|piscine/,'🏃'],[/casque|ecouteur|enceinte|audio/,'🎧'],[/telephone|iphone|portable/,'📱'],[/ordi|clavier|ecran|souris|laptop/,'💻'],[/chaussure|basket|botte/,'👟'],[/pull|veste|manteau|robe|chemise|pantalon|vetement/,'👕'],[/canape|meuble|lampe|etagere|table|chaise|lit\b|armoire/,'🛋️'],[/impot|admin|facture|dossier|assurance|banque|papier|contrat/,'🗂️'],[/docteur|medecin|dentiste|rdv|sante|ordonnance/,'🩺'],[/voiture|garage|permis|pneu/,'🚗'],[/course|supermarche/,'🛒'],[/photo|album/,'📷'],[/jeu\b|jeux|console|switch|jouer/,'🎮'],[/ranger|tri\b|trier|rangement|cave|grenier/,'📦']];
  function autoEmoji(t){var n=nrm(t);for(var i=0;i<AUTO.length;i++)if(AUTO[i][0].test(n))return AUTO[i][1];return '✨'}
  function iconField(emoji,fieldAttr,title,place,pickAct,list,cur){
    return '<div class="ifield"><button type="button" class="ibtn'+(iconOpen?' open':'')+'" data-act="icon-toggle" aria-label="Choisir l\'icône" title="Icône">'+esc(emoji||'🙂')+'</button><input class="in" maxlength="80" '+fieldAttr+' value="'+esc(title)+'" placeholder="'+place+'" aria-label="Titre"></div>'+
      (iconOpen?'<div class="emos pop">'+list.map(function(e){return '<button type="button" class="emo'+(cur===e?' on':'')+'" '+pickAct+' data-e="'+e+'" data-v="'+e+'" aria-label="Icône '+e+'">'+e+'</button>'}).join('')+'</div>':'');
  }
  var QEMO=['🔧','🍷','🥬','🎁','🏠','🪴','🧹','🎨','📦','🛒','✈️','🎄','🍳','📚','🛠️','🎉'];
  var EMO=['🛁','💊','🦴','🐕','🪴','🌿','💧','🚿','🧹','🧺','🍽️','🗑️','🔧','🧴'];
  function careState(r){
    var has=!!r.lastDone, d=has?-diff(r.lastDone):null, c='n', txt='À renseigner';
    if(has){
      txt=d<=0?"Aujourd'hui":d===1?'Hier':(d>=14&&d%7===0)?'Il y a '+(d/7)+' semaines':'Il y a '+d+' jours';
      var g=Number(r.green),o=Number(r.orange),ev=everyDays(r);if(ev>0){o=ev;g=ev-(ev>=14?3:ev>=5?2:1)}
      if(g>0){c=d<=g?'g':(o>0&&d<=o)?'o':(o>0?'r':'g')}
    }
    if(r.forceColor&&/^[gorn]$/.test(r.forceColor))c=r.forceColor;
    if(r.customText)txt=String(r.customText).replace(/^\S+ (il y a)/i,function(){return 'Il y a'});
    var IC={g:'✅',o:'🟠',r:'🚨'};if(IC[c])txt=IC[c]+' '+txt;
    return {c:c,txt:txt};
  }
  function careRow(r){
    var st=careState(r);
    return '<div class="row '+st.c+' care" role="button" tabindex="0" aria-haspopup="dialog" data-act="care-open" data-id="'+esc(r.id)+'">'+
      (r.emoji?'<span class="em" aria-hidden="true">'+esc(r.emoji)+'</span>':'<span class="dot"></span>')+
      '<div class="main"><span class="t">'+esc(r.title)+'</span><span class="sub">'+esc(st.txt)+'</span></div></div>';
  }
  function panelHtml(r){
    var st=careState(r),un=r.everyUnit==='sem'?'sem':'j';
    return '<div class="panel" data-id="'+esc(r.id)+'">'+
      '<div class="ph">'+(r.emoji?'<span class="phem">'+esc(r.emoji)+'</span>':'')+'<div><div class="phn">'+esc(r.title)+'</div><div class="pstate">'+esc(st.txt)+'</div></div></div>'+
      '<button class="bigdone" data-act="done-today" data-id="'+esc(r.id)+'">✓ FAIT</button>'+
      '<div class="plinks"><button class="lnk" data-act="cal-toggle" data-id="'+esc(r.id)+'">📅 Fait une autre date</button>'+(r.hasPrev?'<button class="lnk" data-act="undo" data-id="'+esc(r.id)+'">↶ Annuler</button>':'')+'</div>'+
      (calFor===r.id?calHtml(r):'')+
      '<hr class="sep">'+
      '<div class="lab">Rappel</div>'+
      '<div class="thr">Tous les <input class="in" type="number" min="1" max="999" data-field="everyN" value="'+esc(r.everyN||'')+'" aria-label="Fréquence"> <select class="in" data-field="everyUnit" aria-label="Unité"><option value="j"'+(un==='j'?' selected':'')+'>jours</option><option value="sem"'+(un==='sem'?' selected':'')+'>semaines</option></select></div>'+
      '<hr class="sep">'+
      '<div class="lab">Icône et titre</div>'+
      iconField(r.emoji,'data-field="name"',r.title,'Titre','data-act="pick-emoji" data-id="'+esc(r.id)+'"',EMO,r.emoji)+
      '<div class="prow"><button class="lnk del" data-act="del" data-id="'+esc(r.id)+'">Supprimer</button><button class="btn valid" data-act="sheet-close">Valider</button></div></div>';
  }
  function renderSheet(soft){
    var sh=$('sheet');if(!sh)return;
    if(soft&&(wishOpen||evEdit))return;
    var ae=document.activeElement,refocus=false;
    if(ae&&(ae.tagName==='INPUT'||ae.tagName==='TEXTAREA')&&sh.contains(ae)){
      if(soft&&ae.value)return;
      refocus=ae.hasAttribute('data-stepinput');
    }
    if(evEdit){sh.innerHTML='<div class="sheet-bg" data-act="sheet-close"></div><div class="sheet-card" role="dialog" aria-modal="true" aria-label="Renommer"><button class="sheet-x" data-act="sheet-close" aria-label="Fermer">×</button><div class="panel"><div class="pj-title">Renommer l\'événement</div><div class="lab">Nom affiché</div><input class="in" maxlength="80" data-evn value="'+esc(evEdit.v)+'" aria-label="Nom affiché"><div class="hint">Nom d\'origine : '+esc(evEdit.orig)+'<br>Le changement ne modifie que le dashboard, pas Google Agenda.</div><div class="prow"><button class="lnk" data-act="ev-reset">Nom d\'origine</button><button class="btn valid" data-act="ev-save">Valider</button></div></div></div>';sh.hidden=false;var ei=sh.querySelector('[data-evn]');if(ei){ei.focus();ei.select()}return}
    if(wishOpen){sh.innerHTML='<div class="sheet-bg" data-act="sheet-close"></div><div class="sheet-card wide" role="dialog" aria-modal="true" aria-label="Envie"><button class="sheet-x" data-act="sheet-close" aria-label="Fermer">×</button>'+wishPanel()+'</div>';sh.hidden=false;return}
    var r=openId?find('routines',openId):null,pj=projId?find('projects',projId):null;
    if(!r&&!pj){sh.hidden=true;sh.innerHTML='';return}
    var lbl=r?r.title:pj.title;
    sh.innerHTML='<div class="sheet-bg" data-act="sheet-close"></div><div class="sheet-card'+(pj?' wide':'')+'" role="dialog" aria-modal="true" aria-label="'+esc(lbl)+'"><button class="sheet-x" data-act="sheet-close" aria-label="Fermer">×</button>'+(r?panelHtml(r):projPanel(pj))+'</div>';
    sh.hidden=false;
    if(refocus){var si=sh.querySelector('[data-stepinput]');if(si)si.focus()}
  }

  var PL={
    monstera:'<path d="M50 118V70" stroke="#5E9B6B" stroke-width="3"/><path d="M50 72C28 70 14 52 20 30c18-2 34 10 30 42z" fill="#7DBB86"/><path d="M50 78C74 78 88 58 80 36c-20 0-34 14-30 42z" fill="#5FA56C"/><path d="M50 60C40 48 42 32 52 20c10 12 8 28-2 40z" fill="#8CCB95"/><path d="M26 44l12 8M34 36l10 10M70 48l-12 8M74 40l-12 8" stroke="#E8F6EA" stroke-width="3" stroke-linecap="round"/>',
    lierre:'<path d="M20 0C30 30 14 50 34 70S70 90 60 118" stroke="#5E9B6B" stroke-width="2.5" fill="none"/><g fill="#7DBB86"><path d="M20 20l14-4-4 14z"/><path d="M30 52l-16 2 8 12z"/><path d="M42 70l16-6-2 16z"/><path d="M62 90l-14 2 6 14z"/><path d="M52 28l14 6-12 8z"/><path d="M70 62l12 4-10 10z"/></g><g fill="#5FA56C"><path d="M24 36l12 2-6 12z"/><path d="M46 52l-14 4 10 8z"/><path d="M58 100l14-2-6 14z"/></g>',
    pachira:'<path d="M50 118V56" stroke="#9A7B5E" stroke-width="5" stroke-linecap="round"/><g fill="#7DBB86"><ellipse cx="50" cy="26" rx="6" ry="18"/><ellipse cx="32" cy="34" rx="6" ry="17" transform="rotate(-45 32 34)"/><ellipse cx="68" cy="34" rx="6" ry="17" transform="rotate(45 68 34)"/></g><g fill="#5FA56C"><ellipse cx="22" cy="52" rx="5" ry="15" transform="rotate(-70 22 52)"/><ellipse cx="78" cy="52" rx="5" ry="15" transform="rotate(70 78 52)"/><ellipse cx="42" cy="46" rx="5" ry="15" transform="rotate(-25 42 46)"/><ellipse cx="58" cy="46" rx="5" ry="15" transform="rotate(25 58 46)"/></g>',
    autre:'<path d="M50 118V60" stroke="#5E9B6B" stroke-width="3"/><g fill="#7DBB86"><ellipse cx="34" cy="50" rx="10" ry="18" transform="rotate(-35 34 50)"/><ellipse cx="66" cy="50" rx="10" ry="18" transform="rotate(35 66 50)"/><ellipse cx="50" cy="34" rx="9" ry="20"/></g>'
  };
  function plantArt(r){var t=(r.title||'').toLowerCase(),k=t.indexOf('monstera')>=0?'monstera':t.indexOf('lierre')>=0?'lierre':t.indexOf('pachira')>=0?'pachira':'autre';
    return '<svg class="pa" viewBox="0 0 100 120" preserveAspectRatio="xMidYMax meet" aria-hidden="true">'+PL[k]+'<path d="M32 104h36l-4 16H36z" fill="#E7B896"/></svg>'}
  function plantTile(r){
    var st=careState(r),lab={g:'Ça va, merci !',o:"J'ai un peu soif…",r:"J'ai soooif !",n:'À renseigner'}[st.c],
      d=r.lastDone?st.txt.replace(/^\S+\s/,''):'';
    var ic={g:'😌',o:'😅',r:'🥵',n:''}[st.c];
    return '<div class="ptile '+st.c+'" role="button" tabindex="0" aria-haspopup="dialog" data-act="care-open" data-id="'+esc(r.id)+'">'+plantArt(r)+
      '<div class="pt"><span class="pn">'+esc(r.title)+'</span><span class="ps">'+(ic?'<i aria-hidden="true">'+ic+'</i> ':'')+lab+'</span><span class="pd">'+esc(d||'')+'</span></div></div>';
  }
  function renderCare(){
    GROUPS.forEach(function(g){
      var list=S.routines.filter(function(r){var gg=GROUPS.indexOf(r.group)>=0?r.group:'Maison';return gg===g}).sort(function(a,b){var R={r:0,o:1,n:2,g:3},ca=careState(a).c,cb=careState(b).c;if(R[ca]!==R[cb])return R[ca]-R[cb];var da=a.lastDone||'9999',db_=b.lastDone||'9999';if(da!==db_)return da<db_?-1:1;return (a.createdAt||0)-(b.createdAt||0)});
      $('l-'+g).innerHTML=list.length?list.map(g==='Plantes'?plantTile:careRow).join(''):empty('routines','Rien ici pour le moment.');
    });
  }
  function setDate(id,val){
    var r=find('routines',id);if(!r)return;
    upd('routines',id,{lastDone:val||null,hasPrev:true,prevDone:r.lastDone||null,prevForce:r.forceColor||null,prevCustom:r.customText||null,forceColor:null,customText:null});
  }
  function undoDate(id){
    var r=find('routines',id);if(!r)return;
    upd('routines',id,{lastDone:r.prevDone||null,forceColor:r.prevForce||null,customText:r.prevCustom||null,hasPrev:false});
  }
  function delDoc(key,id){S[key]=S[key].filter(function(x){return x.id!==id});render();return shDel(key,id)}
  var lastDel=null,toastT=null;
  function hideToast(){clearTimeout(toastT);var el=$('toast');if(el){el.hidden=true;el.innerHTML=''}}
  function delUndo(key,id,label){
    var it=find(key,id);if(!it)return;
    lastDel={key:key,item:JSON.parse(JSON.stringify(it))};delDoc(key,id);
    var el=$('toast');if(!el)return;
    el.innerHTML='<span>'+esc(label)+'</span><button type="button" data-act="undo-del">Annuler</button>';el.hidden=false;
    clearTimeout(toastT);toastT=setTimeout(function(){lastDel=null;hideToast()},6000);
  }
  function restoreDel(){
    if(!lastDel)return;var k=lastDel.key,o=lastDel.item;lastDel=null;hideToast();
    if(!find(k,o.id)){S[k].push(o);render()}return shWrite(k,o);
  }
  function newId(){var a=new Uint8Array(6);crypto.getRandomValues(a);return 'g'+Date.now().toString(36)+Array.from(a,function(b){return (b%36).toString(36)}).join('')}
  function addDoc(key,data){
    data.createdAt=Date.now();var nid=newId();data.id=nid;
    S[key].push(data);render();shWrite(key,data);return nid;
  }
  function newCare(grp,sp){var nr={title:sp.title||sp.emoji,emoji:sp.title?(sp.emoji||autoEmoji(sp.title)):'',autoIcon:!sp.emoji,group:grp,lastDone:null};
    if(grp==='Plantes'){nr.emoji=sp.emoji||'🪴';nr.everyN=7;nr.everyUnit='j';nr.verb='Arrosé'}return nr}
  function newProj(sp){return {title:sp.title||sp.emoji,emoji:sp.title?(sp.emoji||autoEmoji(sp.title)):'',autoIcon:!sp.emoji,prio:'med',status:'todo',steps:[]}}
  var showDone=lsGet('maison-show-done')==='1';
  function renderTodo(){
    var ae=document.activeElement;
    if(ae&&ae.hasAttribute&&ae.hasAttribute('data-stepinput')&&ae.value)return;
    if(ae&&ae.matches&&ae.matches('select.pr'))return;
    var list=S.projects.filter(function(o){return !o.main}).sort(function(a,b){
      if((a.status==='done')!==(b.status==='done'))return a.status==='done'?1:-1;
      var p=(PW[b.prio]||2)-(PW[a.prio]||2);if(p)return p;
      return (a.createdAt||0)-(b.createdAt||0)});
    var isFin=function(o){var ss=o.steps||[];return o.status==='done'||(ss.length&&ss.every(function(x){return x.done}))};
    var rowH=function(o){
      var st=o.steps||[],nx=st.filter(function(x){return !x.done})[0],fin=o.status==='done'||(st.length&&!nx);
      var dots=st.length?'<span class="dots" aria-label="'+st.filter(function(x){return x.done}).length+' sur '+st.length+'">'+st.map(function(x){return '<i'+(x.done?' class="on"':'')+'></i>'}).join('')+'</span>':'';
      var sub=fin?'✨ Terminé':nx?'<span class="nx">→ '+esc(nx.t)+'</span>':'Pas encore d\'étape';
      var p=PRIO[o.prio]?o.prio:'med';
      return '<div class="row projrow'+(fin?' done':'')+'" role="button" tabindex="0" aria-haspopup="dialog" data-act="proj-open" data-id="'+esc(o.id)+'">'+
        (o.emoji?'<span class="em" aria-hidden="true">'+esc(o.emoji)+'</span>':'<span class="dot"></span>')+
        '<div class="main"><span class="t">'+esc(o.title)+'</span><span class="sub">'+sub+'</span></div>'+
        '<select class="pr '+p+'" data-prio="'+esc(o.id)+'" aria-label="Urgence">'+['high','med','low'].map(function(k){return '<option value="'+k+'"'+(k===p?' selected':'')+'>'+PRIO[k]+'</option>'}).join('')+'</select></div>';
    };
    var act=list.filter(function(o){return !isFin(o)}),fin=list.filter(isFin);
    $('l-todo').innerHTML=(act.length?act.map(rowH).join(''):(fin.length?'<p class="empty">Tout est terminé ✨</p>':empty('projects','Une idée ? Ajoute-la ci-dessus.')))+
      (fin.length?'<button type="button" class="lnk donetog" data-act="done-tog" aria-expanded="'+showDone+'">'+(showDone?'▾':'▸')+' Terminées ('+fin.length+')</button>'+(showDone?fin.map(rowH).join(''):''):'');
    fitTodo();
  }
  function fitTodo(){
    var L=$('l-todo');if(!L)return;var rs=L.querySelectorAll('.projrow');
    L.style.overflowX='hidden';
    if(!matchMedia('(max-width:899px),(orientation:portrait)').matches){L.style.maxHeight='';L.style.overflowY='';return}
    if(rs.length>3){var r=rs[2];L.style.maxHeight=(r.offsetTop+r.offsetHeight+22)+'px';L.style.overflowY='auto'}
    else{L.style.maxHeight='';L.style.overflowY=''}
  }
  window.addEventListener('resize',fitTodo);
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(fitTodo);
  function projPanel(o){
    var st=o.status||'todo',ss=o.steps||[],done=ss.filter(function(x){return x.done}).length,pc=ss.length?Math.round(done/ss.length*100):0,id=esc(o.id);
    var sg=function(f,opts,cur){return '<div class="seg '+f+'">'+opts.map(function(x){return '<button type="button" class="'+(cur===x[0]?'on ':'')+x[0]+'" data-act="pset" data-id="'+id+'" data-f="'+f+'" data-v="'+x[0]+'">'+x[1]+'</button>'}).join('')+'</div>'};
    var us=String(o.notes||'').match(/https?:\/\/[^\s<>"']+/g)||[];
    return '<div class="panel pj" data-id="'+id+'">'+
      iconField(o.emoji,'data-field="pname"',o.title,'Titre de la quête','data-act="ppick" data-id="'+id+'"',QEMO,o.emoji)+
      '<div class="lab">Urgence</div>'+sg('prio',[['high','Urgent'],['med','Pas urgent'],['low','Optionnel']],PRIO[o.prio]?o.prio:'med')+
      '<div class="lab">Avancement</div>'+sg('status',[['todo','À faire'],['doing','En cours'],['done','Terminé']],st)+
      '<div class="lab">Mini-quêtes'+(ss.length?' · '+done+'/'+ss.length:'')+'</div>'+
      (ss.length?'<div class="bar"><i style="width:'+pc+'%"></i></div>':'')+
      (ss.length?'<ul class="steps">'+ss.map(function(x,i){return '<li class="step'+(x.done?' done':'')+'"><button class="chk" data-act="ps" data-id="'+id+'" data-i="'+i+'" aria-label="Mini-quête : '+esc(x.t)+'">'+CHECK+'</button><span>'+esc(x.t)+'</span><button class="sx" data-act="sd" data-id="'+id+'" data-i="'+i+'" aria-label="Supprimer : '+esc(x.t)+'" title="Supprimer">×</button></li>'}).join('')+'</ul>':'<div class="sub">Pas encore de mini-quête.</div>')+
      '<form class="stepform" data-form="step" data-id="'+id+'"><input class="in" maxlength="120" data-stepinput required placeholder="Nouvelle mini-quête" aria-label="Nouvelle mini-quête"><button class="btn" type="submit">+</button></form>'+
      '<div class="lab">Liens et notes</div><textarea class="in notes" maxlength="2000" data-field="pnotes" rows="3" placeholder="Un lien, une idée, une remarque…" aria-label="Liens et notes">'+esc(o.notes||'')+'</textarea>'+
      (us.length?'<div class="nlinks">'+us.map(function(u){return '<a class="btn ghost" href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">↗ '+esc(u.replace(/^https?:\/\/(www\.)?/,'').split('/')[0])+'</a>'}).join('')+'</div>':'')+
      '<button class="btn ghost pin" data-act="pmain" data-id="'+id+'">'+(o.main?'📌 Retirer de la quête principale':'📌 Mettre en quête principale')+'</button>'+
      '<div class="prow"><button class="lnk del" data-act="pdel" data-id="'+id+'">Supprimer la quête</button><button class="btn valid" data-act="proj-save" data-id="'+id+'">Valider</button></div></div>';
  }
  function whoLabel(k){return k==='couple'?'Couple':(PEOPLE[k]||(k==='p1'?'Personne 1':k==='p2'?'Personne 2':''))}
  var UW={high:3,med:2,low:1};
  function fitTotal(){var te=$('w-total');if(!te)return;te.style.visibility='';requestAnimationFrame(function(){if(te.scrollWidth>te.clientWidth+1)te.style.visibility='hidden'})}
  window.addEventListener('resize',fitTotal);
  function renderShop(){
    var list=S.shop.slice().sort(function(a,b){if(!!a.done!==!!b.done)return a.done?1:-1;var u=(UW[b.urgency]||2)-(UW[a.urgency]||2);if(u)return u;return (a.createdAt||0)-(b.createdAt||0)});
    var el=$('l-wish');if(!el)return;
    var tot=S.shop.filter(function(w){return !w.done&&Number(w.budget)>0}).reduce(function(t,w){return t+Number(w.budget)},0);
    var te=$('w-total');if(te){te.textContent=tot?'≈ '+Math.round(tot).toLocaleString('fr-FR')+' €':'';fitTotal()}
    el.innerHTML=list.length?list.map(function(w){
      var meta=[];if(Number(w.budget)>0)meta.push('<b>'+Math.round(Number(w.budget))+' €</b>');if(whoLabel(w.who))meta.push(esc(whoLabel(w.who)));if(w.urgency==='high')meta.push('🔥 Vite');else if(w.urgency==='low')meta.push('🌱 Un jour');
      return '<button class="wrow'+(w.done?' done':'')+(w.urgency==='high'?' hot':'')+'" data-act="wish-open" data-id="'+esc(w.id)+'"><span class="em" aria-hidden="true">'+esc(w.emoji||'🎁')+'</span><span class="main"><span class="t">'+esc(w.title)+'</span>'+(meta.length?'<span class="sub">'+meta.join(' · ')+'</span>':'')+'</span></button>';
    }).join(''):'<span class="empty" style="padding:0">'+(loaded.shop?'Rien pour le moment, ajoute une envie !':'Chargement…')+'</span>';
  }

  /* Wishlist: fiche détaillée en pop-up */
  var wishOpen=null,wd={};
  var WEMO=['🎧','📱','👟','👕','📚','🎮','🏠','🍳','🪴','🎁','✈️','💄','⌚','🛋️','🎨','🧸'];
  function wishPanel(){
    var isNew=wishOpen==='new',amz='https://www.amazon.fr/s?k='+encodeURIComponent(wd.title||''),lk=safeUrl(wd.link);
    var seg=function(f,opts,cur){return '<div class="seg">'+opts.map(function(o){return '<button type="button" class="'+(cur===o[0]?'on':'')+'" data-act="wf-set" data-f="'+f+'" data-v="'+o[0]+'">'+o[1]+'</button>'}).join('')+'</div>'};
    return '<div class="panel wish">'+
      '<div class="pj-title">'+(isNew?'Nouvelle envie ✨':'Modifier l\'envie')+'</div>'+
      '<div class="lab">Icône et titre</div>'+iconField(wd.emoji||(wd.title?autoEmoji(wd.title):''),'data-wf="title"',wd.title||'','Ex. casque sans fil','data-act="wf-set" data-f="emoji"',WEMO,wd.emoji)+
      '<div class="wgrid"><div><div class="lab">Pour qui ?</div>'+seg('who',[['p1',esc(whoLabel('p1'))],['p2',esc(whoLabel('p2'))],['couple','💑 Couple']],wd.who)+'</div>'+
      '<div><div class="lab">Urgence</div>'+seg('urgency',[['low','🌱 Un jour'],['med','⏳ Bientôt'],['high','🔥 Vite']],wd.urgency)+'</div></div>'+
      '<div class="wgrid"><div><div class="lab">Budget</div><div class="eur"><input class="in" type="number" min="0" max="1000000" step="1" inputmode="decimal" data-wf="budget" value="'+esc(wd.budget||'')+'" placeholder="0" aria-label="Budget"><span>€</span></div></div>'+
      '<div><div class="lab">Idée de prix</div><a class="btn ghost wamz" id="wf-amz" href="'+esc(amz)+'" target="_blank" rel="noopener noreferrer">🔎 Chercher sur Amazon</a></div></div>'+
      '<div class="lab">Lien</div><div class="lrow"><input class="in" maxlength="500" data-wf="link" value="'+esc(wd.link||'')+'" placeholder="https://…" aria-label="Lien">'+(lk?'<a class="btn ghost" href="'+esc(lk)+'" target="_blank" rel="noopener noreferrer">Ouvrir ↗</a>':'')+'</div>'+
      '<div class="lab">Note</div><input class="in" maxlength="200" data-wf="note" value="'+esc(wd.note||'')+'" placeholder="Taille, couleur, magasin…" aria-label="Note">'+
      '<div class="prow">'+(isNew?'':'<button class="lnk del" data-act="wf-del">Supprimer</button><button class="lnk" data-act="wf-got">'+(wd.done?'↺ Pas encore':'✓ Obtenu')+'</button>')+'<button class="btn valid" data-act="wf-save">'+(isNew?'Ajouter':'Valider')+'</button></div></div>';
  }
  function wishSave(){
    var sp=splitEmoji(wd.title||'');var title=sp.title||'';if(!title){var ti=document.querySelector('[data-wf="title"]');if(ti)ti.focus();return}
    var b=parseFloat(String(wd.budget).replace(',','.'));
    var data={title:title,emoji:sp.emoji||wd.emoji||autoEmoji(title),budget:b>0?b:null,urgency:wd.urgency||'med',who:wd.who||'couple',link:safeUrl(wd.link),note:String(wd.note||'').trim().slice(0,200)};
    if(wishOpen==='new'){data.done=false;addDoc('shop',data)}else upd('shop',wishOpen,data);
    wishOpen=null;renderSheet();
  }

  /* À venir : événements Google Agenda (lus par le script, en lecture seule) */
  function evInfo(e){
    var s=e.start||{},d,allDay=false;
    if(s.dateTime){d=new Date(s.dateTime)}else if(s.date){d=parse(s.date);allDay=true}else return null;
    if(isNaN(d.getTime()))return null;
    var day=new Date(d);day.setHours(0,0,0,0);
    return {d:d,allDay:allDay,n:Math.round((day-t0())/864e5)};
  }
  function renderCal(){
    var el=$('l-cal'),st=cal.status,crr=$('cal-r');if(crr&&st!=='ok')crr.hidden=true;
    if(st==='ok'){
      var nHid=cal.events.filter(function(e){return e&&HID.indexOf(e.id)>=0}).length;
      var all=cal.events.filter(function(e){return e&&e.status!=='cancelled'&&((HID.indexOf(e.id)>=0)===showHid)}).map(function(e){return {e:e,i:evInfo(e)}}).filter(function(x){return x.i&&x.i.n>=0});
      var toSun=(7-new Date().getDay())%7,lim={week:toSun,weeks:toSun+14,month:Math.max(30,toSun)}[calRange];if(lim==null)lim=toSun;
      var wk=all.filter(function(x){return x.i.n<=toSun}),later=all.filter(function(x){return x.i.n>toSun&&x.i.n<=lim}).slice(0,30);
      var tfmt=function(i){return i.allDay?'Toute la journée':i.d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})};
      var wdn=function(d){return cap(d.toLocaleDateString('fr-FR',{weekday:'short'}).replace('.',''))};
      var big=wk.map(function(x){
        var i=x.i,d=i.d,day=i.n<=0?"Aujourd'hui":i.n===1?'Demain':cap(d.toLocaleDateString('fr-FR',{weekday:'long'}));
        return '<div class="row evrow"'+(showHid?'':' role="button" tabindex="0" data-act="ev-edit" data-id="'+esc(x.e.id)+'" title="Renommer"')+'><div class="date-badge"><b>'+d.getDate()+'</b><span>'+esc(d.toLocaleDateString('fr-FR',{month:'short'}).replace('.',''))+'</span></div>'+
          '<div class="main"><span class="t">'+esc((EVN[x.e.id]||x.e.summary||'Sans titre'))+'</span><span class="sub"><strong>'+esc(day)+'</strong> · '+esc(tfmt(i))+'</span></div>'+hideBtn(x.e.id,showHid)+'</div>';
      }).join('');
      var small=later.map(function(x){
        var i=x.i;
        return '<div class="mini-ev evrow"'+(showHid?'':' role="button" tabindex="0" data-act="ev-edit" data-id="'+esc(x.e.id)+'" title="Renommer"')+'><b>'+esc(wdn(i.d)+' '+i.d.getDate()+' '+i.d.toLocaleDateString('fr-FR',{month:'short'}).replace('.',''))+'</b><span>'+esc((EVN[x.e.id]||x.e.summary||'Sans titre'))+'</span><i>'+(i.allDay?'':esc(tfmt(i)))+'</i>'+hideBtn(x.e.id,showHid)+'</div>';
      }).join('');
      el.innerHTML=(big||'<p class="empty">'+(showHid?'Aucun événement masqué.':'Rien de prévu cette semaine.')+'</p>')+(small?'<div class="sec-label">'+(calRange==='month'?'Plus tard ce mois-ci':'Semaines suivantes')+'</div>'+small:'')+((nHid||showHid)?'<button class="lnk" data-act="ev-toggle">'+(showHid?'← Retour':'Masqués ('+nHid+')')+'</button>':'');
      var cr=$('cal-r');if(cr){cr.hidden=showHid;cr.innerHTML=[['week','En cours'],['weeks','3 semaines'],['month','1 mois']].map(function(o){return '<button type="button" class="'+(calRange===o[0]?'on':'')+'" data-act="cal-range" data-v="'+o[0]+'" aria-pressed="'+(calRange===o[0])+'">'+o[1]+'</button>'}).join('')}
      el.scrollTop=0;
    }else if(st==='loading'){el.innerHTML='<p class="empty">Chargement…</p>'}
    else{el.innerHTML='<p class="empty">L\'agenda ne répond pas pour le moment.<br><button class="btn" data-act="cal-go">Réessayer</button></p>'}
  }
  var calRange=lsGet('maison-cal-range')||'week',HID=[],showHid=false,EVN={},evEdit=null;
  function hideBtn(id,on){return '<button class="evx" data-act="ev-hide" data-id="'+esc(id)+'" aria-label="'+(on?'Réafficher':'Masquer')+'" title="'+(on?'Réafficher':'Masquer')+'">'+(on?'↺':'×')+'</button>'}
  function evSave(reset){if(!evEdit)return;var v=String(evEdit.v||'').trim().slice(0,80);if(reset||!v||v===evEdit.orig)delete EVN[evEdit.id];else EVN[evEdit.id]=v;saveSetting('eventNames',EVN);evEdit=null;renderSheet();renderCal()}
  function setHid(list){HID=list;saveSetting('hiddenEvents',list);renderCal()}

  var W=null;
  function wIcon(c,day){
    var cloud='<path d="M15 35a7 7 0 0 1-.6-13.97A11 11 0 0 1 35.3 19.4 7.8 7.8 0 0 1 34 35z" fill="#F3F0FF" stroke="#B9AEF5" stroke-width="2" stroke-linejoin="round"/>';
    var sun='<g stroke="#FFB84D" stroke-width="3" stroke-linecap="round"><path d="M24 5v4M24 39v4M5 24h4M39 24h4M10.6 10.6l2.8 2.8M34.6 34.6l2.8 2.8M10.6 37.4l2.8-2.8M34.6 13.4l2.8-2.8"/></g><circle cx="24" cy="24" r="9" fill="#FFC857"/>';
    var moon='<path d="M31 8a15 15 0 1 0 9 26A13 13 0 0 1 31 8z" fill="#FFD76A"/>';
    var g;
    if(c==='sunny'||c==='clear')g=day===false?moon:sun;
    else if(c==='partly')g=(day===false?'<g transform="translate(-6 -6) scale(.7)">'+moon+'</g>':'<g transform="translate(-6 -6) scale(.7)">'+sun+'</g>')+'<g transform="translate(2 4)">'+cloud+'</g>';
    else if(c==='rain')g='<g transform="translate(0 -3)">'+cloud+'</g><g stroke="#6FB1FF" stroke-width="3" stroke-linecap="round"><path d="M17 38l-2 5M25 38l-2 5M33 38l-2 5"/></g>';
    else if(c==='snow')g='<g transform="translate(0 -3)">'+cloud+'</g><g fill="#9CCBFF"><circle cx="16" cy="40" r="2.2"/><circle cx="24" cy="42" r="2.2"/><circle cx="32" cy="40" r="2.2"/></g>';
    else if(c==='storm')g='<g transform="translate(0 -3)">'+cloud+'</g><path d="M25 32l-5 8h5l-2 6 8-10h-5l2-4z" fill="#FFC857"/>';
    else if(c==='fog')g='<g transform="translate(0 -4)">'+cloud+'</g><g stroke="#C9C2EE" stroke-width="3" stroke-linecap="round"><path d="M12 39h24M16 44h18"/></g>';
    else g=cloud;
    return '<svg viewBox="0 0 48 48" aria-hidden="true">'+g+'</svg>';
  }
  function renderWeather(){
    var el=$('weather');
    if(!W||typeof W.temp!=='number'){el.hidden=true;return}
    var t=function(n){return Math.round(n)+'°'};
    el.innerHTML='<span class="w-ic">'+wIcon(W.cond,W.isDay)+'</span><span class="w-temp">'+t(W.temp)+'</span><span class="w-main"><span class="w-lab">'+esc(W.label||'')+'</span><span class="w-sub">'+esc(W.city||'')+(typeof W.low==='number'&&typeof W.high==='number'?' · min '+t(W.low)+' · max '+t(W.high):'')+'</span></span>';
    el.hidden=false;
  }

  function renderMain(){
    var el=$('l-main');if(!el)return;
    var m=S.projects.filter(function(p){return p.main&&p.status!=='done'})[0];
    var masc='<img class="mq-mascot" alt="" src="assets/kimchi.svg">';
    if(!m){el.innerHTML=masc+'<div class="mq-empty"><div>📌</div>Pas de quête principale<span>Ouvre une quête secondaire et épingle-la ici.</span></div>';return}
    var ss=m.steps||[],todo=[];ss.forEach(function(x,i){if(!x.done)todo.push(i)});
    var done=ss.length-todo.length,id=esc(m.id);
    var head='<div class="mq-top"><div><div class="mq-lab">📌 Quête principale</div><button class="mq-title" data-act="proj-open" data-id="'+id+'">'+(m.emoji?esc(m.emoji)+' ':'')+esc(m.title)+'</button></div></div>'+masc;
    if(!ss.length){el.innerHTML=head+'<button class="mq-step" data-act="proj-open" data-id="'+id+'"><span class="circ"></span>Ajoute tes premières mini-quêtes</button>';return}
    if(!todo.length){el.innerHTML=head+'<div class="mq-bar">'+ss.map(function(){return '<i class="on"></i>'}).join('')+'</div><div class="mq-win"><b>🎉</b>Quête accomplie !<button class="btn" data-act="main-finish" data-id="'+id+'">Choisir la suivante</button></div>';return}
    var bar='<div class="mq-bar">'+ss.map(function(x){return '<i'+(x.done?' class="on"':'')+'></i>'}).join('')+'</div>';
    var chips='<div class="mq-chips"><span>'+done+'/'+ss.length+'</span><span>'+todo.length+' restante'+(todo.length>1?'s':'')+'</span></div>';
    var rows=todo.slice(0,2).map(function(i,k){
      return '<button class="mq-step'+(k?' small':'')+'" data-act="ps" data-id="'+id+'" data-i="'+i+'" aria-label="Terminer : '+esc(ss[i].t)+'"><span class="circ"></span><span>'+esc(ss[i].t)+'</span></button>';
    }).join('');
    el.innerHTML=head+bar+chips+rows;
  }

  /* Mémoire locale : dernières données connues, affichées si le réseau manque */
  var cacheT=null,fromCache=false;
  function cacheSave(){
    if(fromCache||!KEY)return;clearTimeout(cacheT);
    cacheT=setTimeout(function(){lsSet(CK,JSON.stringify({t:Date.now(),S:S,P:PEOPLE,W:W,HID:HID,EVN:EVN,cal:(cal&&cal.status==='ok')?cal.events:null}))},600);
  }
  function cacheLoad(){
    try{
      var c=JSON.parse(lsGet(CK)||'null');if(!c||!c.S)return false;
      ['projects','routines','shop'].forEach(function(k){S[k]=Array.isArray(c.S[k])?c.S[k]:[];loaded[k]=true});
      setPeople(c.P);W=c.W||null;HID=Array.isArray(c.HID)?c.HID:[];EVN=c.EVN||{};
      if(Array.isArray(c.cal))cal={status:'ok',events:c.cal};
      fromCache=c.t;return true;
    }catch(e){return false}
  }
  function cacheNote(){
    var b=$('banner');if(!b)return;
    if(fromCache){var d=new Date(fromCache);b.innerHTML='<div class="note">Dernières données · '+esc(d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}))+'</div>'}
  }
  function render(){renderCare();renderTodo();renderMain();renderShop();renderSheet(true);cacheSave()}

  function clock(){var n=new Date();$('hello').textContent=n.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});$('today').textContent=n.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'})}
  clock();setInterval(clock,15000);

  document.addEventListener('click',function(e){
    if(e.target.closest&&e.target.closest('select.pr'))return;
    var b=e.target.closest('[data-act]');if(!b)return;
    var a=b.getAttribute('data-act'),id=b.getAttribute('data-id'),it;
    if(a==='pset'){var f=b.getAttribute('data-f'),v=b.getAttribute('data-v');if((f==='prio'&&PRIO[v])||(f==='status'&&NEXT[v])){var o2={};o2[f]=v;upd('projects',id,o2)}}
    else if(a==='ps'){it=find('projects',id);if(it){var st=steps(it);var i=Number(b.getAttribute('data-i'));if(st[i]){st[i].done=!st[i].done;upd('projects',id,{steps:st})}}}
    else if(a==='proj-open'){iconOpen=false;projId=id;openId=null;confirmDel=null;renderSheet()}
    else if(a==='pmain'){it=find('projects',id);if(it){if(it.main){upd('projects',id,{main:false})}else{S.projects.forEach(function(q){if(q.main&&q.id!==id)upd('projects',q.id,{main:false})});upd('projects',id,{main:true})}projId=null;renderSheet()}}
    else if(a==='main-finish'){upd('projects',id,{main:false,status:'done'})}
    else if(a==='ppick'){iconOpen=false;upd('projects',id,{emoji:b.getAttribute('data-e'),autoIcon:false});renderSheet()}
    else if(a==='icon-toggle'){iconOpen=!iconOpen;renderSheet()}
    else if(a==='pdel'){projId=null;confirmDel=null;renderSheet();delUndo('projects',id,'Quête supprimée')}
    else if(a==='undo-del'){restoreDel()}
    else if(a==='pick-emoji'){iconOpen=false;upd('routines',id,{emoji:b.getAttribute('data-e'),autoIcon:false});renderSheet()}
    else if(a==='care-open'){iconOpen=false;projId=null;openId=id;calFor=null;confirmDel=null;renderSheet()}
    else if(a==='proj-save'){var si2=document.querySelector('.sheet-card [data-stepinput]'),pv=si2&&si2.value.trim().slice(0,120),pq=find('projects',id);
      if(pv&&pq){upd('projects',id,{steps:steps(pq).concat([{t:pv,done:false}])})}
      projId=null;confirmDel=null;renderSheet()}
    else if(a==='sheet-close'){iconOpen=false;evEdit=null;wishOpen=null;projId=null;openId=null;calFor=null;confirmDel=null;renderSheet()}
    else if(a==='care-add'){var cf=document.querySelector('form.care-add[data-group="'+b.getAttribute('data-group')+'"]');if(cf){cf.hidden=!cf.hidden;if(!cf.hidden)cf.querySelector('input').focus()}}
    else if(a==='done-today'){openId=null;calFor=null;setDate(id,iso(new Date()));renderSheet()}
    else if(a==='undo'){openId=null;calFor=null;undoDate(id);renderSheet()}
    else if(a==='del'){var rg=(find('routines',id)||{}).group;openId=null;calFor=null;confirmDel=null;renderSheet();delUndo('routines',id,rg==='Plantes'?'Plante supprimée':rg==='Kimchi'?'Tâche de Kimchi supprimée':'Tâche maison supprimée')}
    else if(a==='wishq-toggle'){var fw=$('f-wish');fw.hidden=!fw.hidden;if(!fw.hidden)$('w-title').focus()}
    else if(a==='add-detail'){
      var fm=b.closest('form'),inp=fm&&fm.querySelector('input'),val=inp?inp.value:'',sq=splitEmoji(val),nid=null;
      iconOpen=false;confirmDel=null;calFor=null;openId=null;projId=null;
      if(fm.id==='f-wish'){wishOpen='new';wd={title:val.trim().slice(0,80),emoji:sq.emoji||'',budget:'',urgency:'med',who:'couple',link:'',note:''};inp.value='';fm.hidden=true;renderSheet()}
      else if(!sq.title&&!sq.emoji){inp.focus()}
      else if(fm.id==='f-add'){nid=addDoc('projects',newProj(sq));inp.value='';fm.hidden=true;projId=nid;renderSheet()}
      else{nid=addDoc('routines',newCare(fm.getAttribute('data-group'),sq));inp.value='';fm.hidden=true;openId=nid;renderSheet()}
    }
    else if(a==='cal-toggle'){
      if(calFor===id){calFor=null}else{calFor=id;var rr=find('routines',id),bd=rr&&rr.lastDone?parse(rr.lastDone):new Date();calMonth=new Date(bd.getFullYear(),bd.getMonth(),1)}
      renderSheet()}
    else if(a==='cal-prev'){calMonth=new Date(calMonth.getFullYear(),calMonth.getMonth()-1,1);renderSheet()}
    else if(a==='cal-next'){calMonth=new Date(calMonth.getFullYear(),calMonth.getMonth()+1,1);renderSheet()}
    else if(a==='cal-pick'){var dd=b.getAttribute('data-date');openId=null;calFor=null;setDate(id,dd);renderSheet()}
    else if(a==='wish-open'){it=find('shop',id);if(it){wishOpen=id;wd=Object.assign({budget:'',urgency:'med',who:'couple',link:'',note:''},it);projId=null;openId=null;renderSheet()}}
    else if(a==='wf-set'){var wf=b.getAttribute('data-f');if(wf==='who'||wf==='urgency'||wf==='emoji'){wd[wf]=b.getAttribute('data-v');if(wf==='emoji'){wd.manual=true;iconOpen=false}renderSheet()}}
    else if(a==='wf-save'){wishSave()}
    else if(a==='wf-got'){upd('shop',wishOpen,{done:!wd.done});wishOpen=null;renderSheet()}
    else if(a==='wf-del'){var wid=wishOpen;wishOpen=null;renderSheet();delUndo('shop',wid,'Envie supprimée')}
    else if(a==='add-toggle'){var fa=$('f-add');fa.hidden=!fa.hidden;if(!fa.hidden)$('a-title').focus()}
    else if(a==='sd'){it=find('projects',id);if(it){var i2=Number(b.getAttribute('data-i'));var st2=steps(it);st2.splice(i2,1);upd('projects',id,{steps:st2})}}
    else if(a==='cal-go'){var sy=$('sync');if(sy){sy.classList.add('spin');setTimeout(function(){sy.classList.remove('spin')},1500)}load()}
    else if(a==='ev-edit'){var ee=cal.events.filter(function(q){return q.id===id})[0];if(ee){evEdit={id:id,orig:ee.summary||'Sans titre',v:EVN[id]||ee.summary||''};projId=null;openId=null;wishOpen=null;renderSheet()}}
    else if(a==='ev-save'){evSave(false)}
    else if(a==='ev-reset'){evSave(true)}
    else if(a==='ev-hide'){var hl=HID.slice(),hi=hl.indexOf(id);if(hi>=0)hl.splice(hi,1);else hl.push(id);setHid(hl)}
    else if(a==='done-tog'){showDone=!showDone;lsSet('maison-show-done',showDone?'1':'0');renderTodo()}
    else if(a==='cal-range'){calRange=b.getAttribute('data-v');lsSet('maison-cal-range',calRange);renderCal()}
    else if(a==='ev-toggle'){showHid=!showHid;renderCal()}
    else if(a==='logout'){if(confirm('Déconnecter cet appareil ? Le code d\'accès sera redemandé.'))logout('')}
  });

  document.addEventListener('submit',function(e){
    var f=e.target;if(f.id==='login-form')return;e.preventDefault();
    if(f.classList&&f.classList.contains('care-add')){
      var ci=f.querySelector('input'),sp=splitEmoji(ci.value);
      if(!sp.title&&!sp.emoji)return;
      addDoc('routines',newCare(f.getAttribute('data-group'),sp));
      ci.value='';f.hidden=true;return;
    }
    if(f.id==='f-add'){
      var ti=$('a-title'),sp0=splitEmoji(ti.value);if(!sp0.title&&!sp0.emoji)return;
      addDoc('projects',newProj(sp0));
      ti.value='';f.hidden=true;
    }else if(f.id==='f-wish'){
      var wi=$('w-title'),sw=splitEmoji(wi.value);if(!sw.title&&!sw.emoji)return;
      addDoc('shop',{title:sw.title||sw.emoji,emoji:sw.emoji||autoEmoji(sw.title),urgency:'med',who:'couple',done:false});wi.value='';f.hidden=true;
    }else if(f.getAttribute('data-form')==='step'){
      var inp=f.querySelector('input'),v2=inp.value.trim().slice(0,120),pr=find('projects',f.getAttribute('data-id'));
      inp.value='';
      if(v2&&pr){upd('projects',pr.id,{steps:steps(pr).concat([{t:v2,done:false}])})}else renderTodo();
      renderSheet();
    }
  });
  document.addEventListener('input',function(e){
    if(evEdit&&e.target.hasAttribute&&e.target.hasAttribute('data-evn')){evEdit.v=e.target.value;return}
    var t=e.target,f=t.getAttribute&&t.getAttribute('data-wf');if(!f||!wishOpen)return;
    wd[f]=t.value;
    if(f==='title'){var a=$('wf-amz');if(a)a.href='https://www.amazon.fr/s?k='+encodeURIComponent(t.value)}
  });
  document.addEventListener('keydown',function(e){var t=e.target;if(e.key==='Enter'&&evEdit&&t&&t.hasAttribute&&t.hasAttribute('data-evn')){e.preventDefault();evSave(false);return}if(e.key==='Enter'&&wishOpen&&t&&t.getAttribute&&t.getAttribute('data-wf')){e.preventDefault();wishSave()}});
  document.addEventListener('change',function(e){
    var t=e.target;
    if(t.hasAttribute&&t.hasAttribute('data-prio')){var pid=t.getAttribute('data-prio');t.blur();if(PRIO[t.value])upd('projects',pid,{prio:t.value});return}
    var fld=t.getAttribute&&t.getAttribute('data-field');if(!fld)return;
    var pn=t.closest('.panel');if(!pn)return;
    var id=pn.getAttribute('data-id');
    if(fld==='pname'){var sq=splitEmoji(t.value),pp=find('projects',id)||{};if(sq.title){var pe=sq.emoji||((pp.emoji&&!pp.autoIcon)?pp.emoji:autoEmoji(sq.title));upd('projects',id,{title:sq.title,emoji:pe,autoIcon:!sq.emoji&&!(pp.emoji&&!pp.autoIcon)})}}
    else if(fld==='pnotes'){upd('projects',id,{notes:t.value.trim().slice(0,2000)})}
    else if(fld==='name'){var sp=splitEmoji(t.value),rr=find('routines',id)||{};if(sp.title){var re_=sp.emoji||((rr.emoji&&!rr.autoIcon)?rr.emoji:autoEmoji(sp.title));upd('routines',id,{title:sp.title,emoji:re_,autoIcon:!sp.emoji&&!(rr.emoji&&!rr.autoIcon)})}}
    else if(fld==='everyUnit'){upd('routines',id,{everyUnit:t.value==='sem'?'sem':'j'})}
    else if(fld==='everyN'){var n=parseInt(t.value,10);upd('routines',id,{everyN:n>0&&n<1000?n:null})}
  });
  document.addEventListener('focusout',function(e){
    var t=e.target;if(t&&t.closest&&t.closest('.sheet-card'))setTimeout(function(){renderSheet(true)},80);
  });
  function tick(){renderCare();renderSheet(true)}
  setInterval(tick,600000);
  document.addEventListener('visibilitychange',function(){if(!document.hidden){tick();load()}});
  document.addEventListener('keydown',function(e){
    var t=e.target;
    if(e.key==='Escape'&&(openId||projId||wishOpen||evEdit)){evEdit=null;wishOpen=null;projId=null;openId=null;calFor=null;confirmDel=null;renderSheet();return}
    if((e.key==='Enter'||e.key===' ')&&t&&t.matches&&t.matches('[data-act="care-open"],[data-act="proj-open"],[data-act="ev-edit"]')){e.preventDefault();t.click()}
    else if(e.key==='Enter'&&t&&t.getAttribute&&t.getAttribute('data-field')==='name'){t.blur()}
  });
  window.addEventListener('offline',function(){var b=$('banner');if(b)b.innerHTML='<div class="note">Hors ligne · dernières données</div>'});
  window.addEventListener('online',function(){var b=$('banner');if(b&&!fromCache)b.innerHTML='';load()});

  render();renderCal();
  if(!API||!KEY){showLogin('')}
  else{
    if(cacheLoad()){renderWeather();renderCal();render();cacheNote()}
    load();startPolling();
  }
  if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('sw.js').catch(function(){})})}
})();
