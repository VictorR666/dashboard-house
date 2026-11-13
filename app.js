/* Dashboard Maison — app autonome.
   Les données vivent dans le Google Sheet de la maison. L'app ne parle qu'au script Google (Apps Script)
   du Sheet, avec un code d'accès. Aucun identifiant (Sheet, agenda, code) n'est écrit dans ce fichier. */
(function(){
  'use strict';
  var COL={projects:'projects',routines:'routines',shop:'shopping'};
  var S={projects:[],routines:[],shop:[],courses:[],voyages:[]};
  var GROUPS=['Kimchi','Plantes','Maison'];
  var PRIO={high:'Urgent',med:'Pas urgent',low:'Optionnel'}, PW={high:3,med:2,low:1};
  var NEXT={todo:'doing',doing:'done',done:'todo'};
  var loaded={};
  var cal={status:'loading',events:[]};
  var UNDO='<svg class="ico-undo" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>';
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
      if(!j||j.ok!==true){if(j&&(j.error==='auth'||j.error==='locked'))throw new AuthError(j.error);var er=new Error((j&&j.error)||'erreur');er.server=true;throw er}
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
    KEY=null;lsSet(LS_KEY,null);lsSet(CK,null);OB=[];lsSet(OB_KEY,null);
    S={projects:[],routines:[],shop:[],courses:[],voyages:[]};PEOPLE={p1:'',p2:''};cal={status:'loading',events:[]};W=null;HID=[];EVN={};sig='';
    vOpen=null;render();renderCal();renderWeather();
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
    projects:{cols:['id','emoji','title','main','steps','_t']},
    courses:{cols:['id','emoji','title','qty','rayon','done','_t']},
    voyages:{cols:['id','trip','type','title','start','end','place','ref','link','notes','done','_t']}
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
    if(k==='courses'){o.done=yes(o.done)}
    if(k==='voyages'){o.type=vType(o.type)||(o.trip?'activite':'voyage');o.start=nDT(o.start);o.end=nDT(o.end);o.done=yes(o.done);
      if(o.price!=null&&o.price!=='')o.price=Number(String(o.price).replace(',','.'))||'';
      if(o.type==='valise')o.items=String(o.notes||'').split(/\n/).map(function(x){return x.trim()}).filter(Boolean).map(function(x){return {t:x.replace(DONE_RE,''),done:DONE_RE.test(x)}})}
    if(k==='projects'){o.main=yes(o.main);o.steps=String(o.steps||'').split(/\n/).map(function(x){return x.trim()}).filter(Boolean).map(function(x){return {t:x.replace(DONE_RE,''),done:DONE_RE.test(x)}})}
    return o}
  function toRow(k,o){var c=SHT[k].cols,t={};
    Object.keys(o).forEach(function(f){if(c.indexOf(f)<0&&(f!=='mode'||k==='voyages')&&f!=='items'&&o[f]!=null&&!(f==='createdAt'&&o[f]>=9e12))t[f]=o[f]});
    return c.map(function(f){var v=o[f];
      if(f==='_t')return JSON.stringify(t);
      if(k==='routines'&&f==='everyUnit')return v==='sem'?'semaines':'jours';
      if(k==='shop'&&f==='who')return (v==='p1'||v==='p2')&&PEOPLE[v]?PEOPLE[v]:'Couple';
      if(k==='shop'&&f==='urgency')return URGL[v]||'Bientôt';
      if((k==='shop'&&f==='done')||(k==='projects'&&f==='main')||(k==='courses'&&f==='done'))return v?'oui':'';
      if(k==='voyages'&&f==='type')return VT[v]||'Activité';
      if(k==='voyages'&&f==='done')return v?'oui':'';
      if(k==='voyages'&&f==='notes'&&o.type==='valise')return (o.items||[]).map(function(x){return (x.done?'✓ ':'')+x.t}).join('\n');
      if(k==='projects'&&f==='steps')return (v||[]).map(function(x){return (x.done?'✓ ':'')+x.t}).join('\n');
      if(typeof v==='number')return v;
      return v==null?'':String(v)})}

  /* ---- Chargement et écritures ---- */
  var sig='',busy=false,Q=Promise.resolve(),soonT=null,pollT=null;
  function applyLoad(j){
    var s=JSON.stringify([j.sheets,j.settings,j.events,j.weather,j.calError||null,j.people||null]);
    if(fromCache){fromCache=false;$('banner').innerHTML=''}
    loaded.projects=loaded.routines=loaded.shop=loaded.courses=loaded.voyages=true;
    V_OLD=!(j.sheets&&Array.isArray(j.sheets.voyages)); /* ancien script : pas encore d'onglet Voyages */
    if(s===sig)return;sig=s;
    setPeople(j.people);
    Object.keys(SHT).forEach(function(k){var list=[];
      ((j.sheets&&j.sheets[k])||[]).forEach(function(r,i){if(!Array.isArray(r))return;var o=fromRow(k,r,i);if(!o.title||!o.id)return;list.push(o)});
      S[k]=list});
    var st=j.settings||{};HID=Array.isArray(st.hiddenEvents)?st.hiddenEvents.map(String):[];EVN=(st.eventNames&&typeof st.eventNames==='object')?st.eventNames:{};
    overlayOutbox();
    W=j.weather||null;
    if(Array.isArray(j.events))cal={status:'ok',events:j.events};else if(cal.status!=='ok')cal={status:'error',events:[]};
    renderWeather();renderCal();render();
  }
  async function load(){
    if(busy||!KEY)return;
    if(isOffline()){syncNote();return}
    busy=true;lastLoad=Date.now();var started=Date.now();
    try{var j=await api('load');if(started<lastWriteAt||flushing){busy=false;soon();return}applyLoad(j);flush()}
    catch(e){if(!authFail(e)){if(cal.status!=='ok'){cal={status:'error',events:[]};renderCal()}if(OB.length)syncNote();else if(!fromCache)$('banner').innerHTML='<div class="note">Réseau lent ou absent · dernières données</div>'}}
    busy=false;
  }
  var lastLoad=0;
  function startPolling(){clearInterval(pollT);pollT=setInterval(function(){if(document.hidden)return;var every=(TAB==='courses'||cOpen)?15000:60000;if(Date.now()-lastLoad>=every-1000)load()},5000)}
  /* ---- File d'attente hors ligne (« outbox ») ----
     Chaque modification est d'abord enregistrée sur l'appareil, puis envoyée au script dès que le réseau
     répond. Si le réseau coupe (en magasin…), rien n'est perdu : l'envoi reprend tout seul. */
  var OB_KEY='maison-outbox',OB=(function(){try{var x=JSON.parse(lsGet(OB_KEY)||'[]');return Array.isArray(x)?x:[]}catch(e){return []}})();
  var flushing=false,retryT=null,retryMs=3000,lastWriteAt=0;
  function obSave(){lsSet(OB_KEY,OB.length?JSON.stringify(OB):null);syncNote()}
  function enqueue(op){
    OB=OB.filter(function(o){return op.a==='setting'?!(o.a==='setting'&&o.name===op.name):!(o.a!=='setting'&&o.t===op.t&&o.id===op.id)});
    OB.push(op);obSave();flush();
  }
  function isOffline(){return navigator.onLine===false}
  async function flush(){
    if(flushing||!KEY||!OB.length)return;
    if(isOffline()){syncNote();return}
    flushing=true;clearTimeout(retryT);syncNote();
    try{
      while(OB.length){
        var op=OB[0],payload=op.a==='put'?{t:op.t,row:op.row}:op.a==='del'?{t:op.t,id:op.id}:{name:op.name,value:op.value};
        try{await api(op.a,payload)}
        catch(e){if(!e||!e.server)throw e;fail()} /* refus du script : on n'insiste pas sur cette modif */
        OB=OB.filter(function(x){return x!==op});lastWriteAt=Date.now();obSave();retryMs=3000;
      }
      soon();
    }catch(e){
      if(!authFail(e)){clearTimeout(retryT);retryT=setTimeout(flush,retryMs);retryMs=Math.min(retryMs*2,60000)}
    }
    flushing=false;syncNote();
  }
  function syncNote(){
    var n=OB.length,off=isOffline(),txt=n?('⏳ '+n+' modif'+(n>1?'s':'')+' en attente'+(off?' · hors ligne, enregistré sur l\'appareil':' · envoi…')):(off?'Hors ligne · dernières données':'');
    var b=$('banner');if(b){if(txt)b.innerHTML='<div class="note" data-sync>'+esc(txt)+'</div>';else if(b.querySelector('[data-sync]'))b.innerHTML=''}
    var cn=$('cv-net');if(cn){cn.textContent=n?(off?'Hors ligne · '+n+' en attente':'Envoi…'):(off?'Hors ligne':'');cn.hidden=!cn.textContent}
  }
  function overlayOutbox(){
    OB.forEach(function(op){
      if(op.a==='put'&&SHT[op.t]){var o=fromRow(op.t,op.row,0),L=S[op.t],i=L.findIndex(function(x){return x.id===o.id});if(i>=0)L[i]=o;else L.push(o)}
      else if(op.a==='del'&&SHT[op.t]){S[op.t]=S[op.t].filter(function(x){return x.id!==op.id})}
      else if(op.a==='setting'){if(op.name==='hiddenEvents')HID=op.value;else if(op.name==='eventNames')EVN=op.value}
    });
  }
  function soon(){clearTimeout(soonT);soonT=setTimeout(load,2500)}
  function shWrite(k,o){enqueue({a:'put',t:k,id:o.id,row:toRow(k,o)});return Promise.resolve()}
  function shDel(k,id){enqueue({a:'del',t:k,id:id});return Promise.resolve()}
  function saveSetting(name,value){enqueue({a:'setting',name:name,value:JSON.parse(JSON.stringify(value))});return Promise.resolve()}

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
    return {c:c,txt:txt};
  }
  /* Règle unique : le rond = marquer comme fait (ou annuler si fait aujourd'hui), le texte = ouvrir le détail */
  function careChk(r){var on=r.lastDone===iso(new Date());
    return '<button class="chk care-chk'+(on?' on':'')+'" data-act="care-chk" data-id="'+esc(r.id)+'" aria-pressed="'+on+'" aria-label="'+(on?'Annuler, pas encore fait : ':'Fait aujourd\'hui : ')+esc(r.title)+'">'+CHECK+'</button>'}
  function careToggle(id){var r=find('routines',id);if(!r)return;
    if(r.lastDone===iso(new Date())&&r.hasPrev){undoDate(id);toastMsg('Remis comme avant');return}
    var pv=snap('routines',id,['lastDone','hasPrev','prevDone','prevForce','prevCustom','forceColor','customText']);setDate(id,iso(new Date()));offerUndo('routines',id,pv,'Marqué comme fait ✓')}
  function careRow(r){
    var st=careState(r);
    return '<div class="row '+st.c+' care" role="button" tabindex="0" aria-haspopup="dialog" data-act="care-open" data-id="'+esc(r.id)+'">'+careChk(r)+
      (r.emoji?'<span class="em" aria-hidden="true">'+esc(r.emoji)+'</span>':'<span class="dot"></span>')+
      '<div class="main"><span class="t">'+esc(r.title)+'</span><span class="sub">'+esc(st.txt)+'</span></div></div>';
  }
  function panelHtml(r){
    var st=careState(r),un=r.everyUnit==='sem'?'sem':'j';
    return '<div class="panel" data-id="'+esc(r.id)+'">'+
      '<div class="ph">'+(r.emoji?'<span class="phem">'+esc(r.emoji)+'</span>':'')+'<div><div class="phn">'+esc(r.title)+'</div><div class="pstate">'+esc(st.txt)+'</div></div></div>'+
      '<button class="bigdone" data-act="done-today" data-id="'+esc(r.id)+'">✓ FAIT</button>'+
      '<div class="plinks"><button class="lnk" data-act="cal-toggle" data-id="'+esc(r.id)+'">📅 Fait une autre date</button>'+(r.hasPrev?'<button class="lnk" data-act="undo" data-id="'+esc(r.id)+'">'+UNDO+'Annuler</button>':'')+'</div>'+
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
    if(soft&&(wishOpen||evEdit||tEdit||tplMgr||tplEdit||bilPop))return;
    var ae=document.activeElement,refocus=false;
    if(ae&&(ae.tagName==='INPUT'||ae.tagName==='TEXTAREA')&&sh.contains(ae)){
      if(soft&&ae.value)return;
      refocus=ae.hasAttribute('data-stepinput');
    }
    if(evEdit){sh.innerHTML='<div class="sheet-bg" data-act="sheet-close"></div><div class="sheet-card" role="dialog" aria-modal="true" aria-label="Renommer"><button class="sheet-x" data-act="sheet-close" aria-label="Fermer">×</button><div class="panel"><div class="pj-title">Renommer l\'événement</div><div class="lab">Nom affiché</div><input class="in" maxlength="80" data-evn value="'+esc(evEdit.v)+'" aria-label="Nom affiché"><div class="hint">Nom d\'origine : '+esc(evEdit.orig)+'<br>Le changement ne modifie que le dashboard, pas Google Agenda.</div><div class="prow"><button class="lnk" data-act="ev-reset">Nom d\'origine</button><button class="btn valid" data-act="ev-save">Valider</button></div></div></div>';sh.hidden=false;var ei=sh.querySelector('[data-evn]');if(ei){ei.focus();ei.select()}return}
    if(bilPop){sh.innerHTML='<div class="sheet-bg" data-act="sheet-close"></div><div class="sheet-card" role="dialog" aria-modal="true" aria-label="Billets"><button class="sheet-x" data-act="sheet-close" aria-label="Fermer">×</button>'+bilPanel()+'</div>';sh.hidden=false;return}
    if(tplMgr||tplEdit){sh.innerHTML='<div class="sheet-bg" data-act="sheet-close"></div><div class="sheet-card wide" role="dialog" aria-modal="true" aria-label="Listes types"><button class="sheet-x" data-act="sheet-close" aria-label="Fermer">×</button>'+tplPanel()+'</div>';sh.hidden=false;return}
    if(tEdit){sh.innerHTML='<div class="sheet-bg" data-act="sheet-close"></div><div class="sheet-card wide" role="dialog" aria-modal="true" aria-label="'+esc(VT[tEdit.type]||'Voyage')+'"><button class="sheet-x" data-act="sheet-close" aria-label="Fermer">×</button>'+tPanel()+'</div>';sh.hidden=false;return}
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
      d=r.lastDone?st.txt:'';
    return '<div class="ptile '+st.c+'" role="button" tabindex="0" aria-haspopup="dialog" data-act="care-open" data-id="'+esc(r.id)+'">'+plantArt(r)+careChk(r)+
      '<div class="pt"><span class="pn">'+esc(r.title)+'</span><span class="ps">'+lab+'</span><span class="pd">'+esc(d||'')+'</span></div></div>';
  }
  function renderCare(){
    GROUPS.forEach(function(g){
      var list=S.routines.filter(function(r){var gg=GROUPS.indexOf(r.group)>=0?r.group:'Maison';return gg===g}).sort(function(a,b){var R={r:0,o:1,n:2,g:3},ca=careState(a).c,cb=careState(b).c;if(R[ca]!==R[cb])return R[ca]-R[cb];var da=a.lastDone||'9999',db_=b.lastDone||'9999';if(da!==db_)return da<db_?-1:1;return (a.createdAt||0)-(b.createdAt||0)});
      $('l-'+g).innerHTML=list.length?list.map(g==='Plantes'?plantTile:careRow).join(''):empty('routines','Rien ici pour le moment.');
    });
  }
  /* ---- Onglet « Test » : maquette de la nouvelle page d'accueil (Aujourd'hui / À venir / Courses), sans toucher à l'actuelle ---- */
  function renderTest(){var el=$('ttest');if(!el||TAB!=='test')return;
    var ae=document.activeElement;if(ae&&el.contains(ae)&&ae.tagName==='INPUT'&&ae.value)return;
    var h='';
    /* Aujourd'hui : quête principale (prochaine étape) + routines dues + activité à prévoir */
    var m=S.projects.filter(function(p){return p.main&&p.status!=='done'})[0],today='';
    if(m){var ss=m.steps||[],nx=-1;ss.some(function(x,i){if(!x.done){nx=i;return true}});var dn=ss.filter(function(x){return x.done}).length;
      today+='<div class="tq"><div class="tq-k">📌 Quête principale'+(ss.length?' · '+dn+'/'+ss.length:'')+'</div>'+
        (nx>=0?'<div class="tq-row"><button class="chk" data-act="ps" data-id="'+esc(m.id)+'" data-i="'+nx+'" aria-label="Terminer : '+esc(ss[nx].t)+'">'+CHECK+'</button><button class="tq-t" data-act="proj-open" data-id="'+esc(m.id)+'"><b>'+esc((m.emoji?m.emoji+' ':'')+m.title)+'</b><span>→ '+esc(ss[nx].t)+'</span></button></div>'
          :'<button class="tq-t" data-act="proj-open" data-id="'+esc(m.id)+'"><b>'+esc((m.emoji?m.emoji+' ':'')+m.title)+'</b><span>'+(ss.length?'Toutes les étapes sont faites 🎉':'Ajoute une première étape')+'</span></button>')+'</div>'}
    var R={r:0,o:1},due=S.routines.map(function(r){return {r:r,st:careState(r)}}).filter(function(x){return x.st.c==='r'||x.st.c==='o'}).sort(function(a,b){return R[a.st.c]-R[b.st.c]});
    today+='<div class="tsec">À faire'+(due.length?' <i>'+due.length+'</i>':'')+'</div>'+(due.length?due.map(function(x){var r=x.r;return '<div class="tarow '+x.st.c+'">'+careChk(r)+'<div class="main" role="button" tabindex="0" data-act="care-open" data-id="'+esc(r.id)+'"><span class="t">'+(r.emoji?esc(r.emoji)+' ':'')+esc(r.title)+'</span><span class="sub">'+esc((r.group||'Maison')+' · '+x.st.txt)+'</span></div></div>'}).join(''):'<p class="tempty">Tout est à jour ✨</p>');
    var nt=nextTrip(),acts=nt?kids(nt.id,'activite').filter(function(k){return !k.done}).sort(byStart):[];
    if(nt){today+='<div class="tsec">À prévoir pour '+esc(tEmo(nt)+' '+nt.title)+'</div>'+(acts.length?acts.slice(0,2).map(function(k){return '<div class="tarow t-act"><button class="chk" data-act="v-done" data-id="'+esc(k.id)+'" aria-label="Fait : '+esc(k.title)+'">'+CHECK+'</button><div class="main" role="button" tabindex="0" data-act="trip-open" data-id="'+esc(nt.id)+'"><span class="t">'+esc(k.title)+'</span><span class="sub">'+(k.start?esc(cap(fmtDay(dPart(k.start)))):'Pas encore de date')+'</span></div></div>'}).join(''):'<p class="tempty">Rien à prévoir pour l\'instant.</p>')}
    h+='<section class="tbox tday"><div class="ch"><span class="ic lav"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></svg></span><h2>Aujourd\'hui</h2></div>'+today+'</section>';
    /* À venir : voyage + événements des 7 prochains jours */
    var up='';if(nt)up+='<button class="tripnext t-trip '+tripState(nt).k+'" data-act="trip-open" data-id="'+esc(nt.id)+'">'+tripRowInner(nt)+'</button>';
    if(cal.status==='ok'){var ev=cal.events.filter(function(e){return e&&HID.indexOf(e.id)<0}).map(function(e){return {e:e,i:evInfo(e)}}).filter(function(x){return x.i&&x.i.n>=0&&x.i.n<=7}).slice(0,6);
      up+=ev.length?ev.map(function(x){var i=x.i,d=i.d,day=i.n<=0?"Aujourd'hui":i.n===1?'Demain':cap(d.toLocaleDateString('fr-FR',{weekday:'long'}));
        return '<div class="row evrow"><div class="date-badge"><b>'+d.getDate()+'</b><span>'+esc(d.toLocaleDateString('fr-FR',{month:'short'}).replace('.',''))+'</span></div><div class="main"><span class="t">'+esc(EVN[x.e.id]||x.e.summary||'Sans titre')+'</span><span class="sub"><strong>'+esc(day)+'</strong> · '+esc(i.allDay?'Toute la journée':d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}))+'</span></div></div>'}).join(''):'<p class="tempty">Rien cette semaine.</p>'}
    else up+='<p class="tempty">Chargement de l\'agenda…</p>';
    h+='<div class="tcol"><section class="tbox"><div class="ch"><span class="ic lav"><svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="14" rx="3"/><path d="M4 11h16M8 3v4M16 3v4"/></svg></span><h2>À venir</h2></div>'+up+'</section>';
    /* Courses */
    var todo=S.courses.filter(function(c){return !c.done}).sort(function(a,b){return (a.createdAt||0)-(b.createdAt||0)});
    h+='<section class="tbox"><div class="ch"><span class="ic lav"><svg viewBox="0 0 24 24"><path d="M4 5h2l2 10h10l2-7H7"/><circle cx="9.5" cy="19" r="1.3"/><circle cx="16.5" cy="19" r="1.3"/></svg></span><h2>Courses</h2></div>'+
      '<form id="f-course3" class="addform" autocomplete="off"><input class="in" required maxlength="80" enterkeyhint="done" placeholder="Ajouter… ex. 2 lait" aria-label="Ajouter à la liste de courses"><button class="btn" type="submit">OK</button></form>'+
      (todo.length?'<div class="tchips2">'+todo.map(function(c){return '<button class="tcc" data-act="c-toggle" data-id="'+esc(c.id)+'" aria-label="Dans le panier : '+esc(c.title)+'"><span class="circ">'+CHECK+'</span>'+esc(c.title)+(c.qty?' <i>'+esc(c.qty)+'</i>':'')+'</button>'}).join('')+'</div>':'<p class="tempty">La liste est vide.</p>')+'</section></div>';
    /* Bandeau bas */
    var nq=S.projects.filter(function(p){return !p.main&&p.status!=='done'}).length,wt=S.shop.filter(function(w){return !w.done&&Number(w.budget)>0}).reduce(function(a,w){return a+Number(w.budget)},0),nw=S.shop.filter(function(w){return !w.done}).length;
    h+='<nav class="tstrip"><button data-act="qview-open">🔧 Quêtes secondaires <i>'+nq+'</i></button><button data-act="tab" data-tab="courses">🎁 Wishlist <i>'+nw+(wt?' · ≈ '+Math.round(wt)+' €':'')+'</i></button><button data-act="tab" data-tab="maison">🔁 Routines</button></nav>';
    el.innerHTML=h}
  /* Routines : checklist globale de tout ce qui est en retard (rouge) ou bientôt dû (orange) */
  function renderTodoAll(){var el=$('l-todoall');if(!el)return;
    var R={r:0,o:1},GL={Kimchi:'Kimchi',Plantes:'Plantes',Maison:'Maison'};
    var L=S.routines.map(function(r){return {r:r,st:careState(r)}}).filter(function(x){return x.st.c==='r'||x.st.c==='o'})
      .sort(function(a,b){if(R[a.st.c]!==R[b.st.c])return R[a.st.c]-R[b.st.c];return (a.r.lastDone||'')<(b.r.lastDone||'')?-1:1});
    var c=$('ta-count');if(c)c.textContent=L.length?L.length+' à faire':'';
    el.innerHTML=L.length?L.map(function(x){var r=x.r;return '<div class="tarow '+x.st.c+'">'+careChk(r)+
      '<div class="main" role="button" tabindex="0" data-act="care-open" data-id="'+esc(r.id)+'"><span class="t">'+(r.emoji?esc(r.emoji)+' ':'')+esc(r.title)+'</span><span class="sub">'+esc((GL[r.group]||'Maison')+' · '+x.st.txt)+'</span></div></div>'}).join('')
      :'<p class="empty">'+(loaded.routines?'Tout est à jour ✨':'Chargement…')+'</p>'}
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
  /* Modification annulable : bouton « Annuler » quelques secondes */
  var lastUpd=null;
  function snap(key,id,fields){var it=find(key,id);if(!it)return null;var o={};fields.forEach(function(k){o[k]=it[k]===undefined?null:JSON.parse(JSON.stringify(it[k]))});return o}
  function offerUndo(key,id,prev,label){
    if(!prev)return;lastUpd={key:key,id:id,prev:prev};var el=$('toast');if(!el)return;
    el.innerHTML='<span>'+esc(label)+'</span><button type="button" data-act="undo-upd">Annuler</button>';el.hidden=false;
    clearTimeout(toastT);toastT=setTimeout(function(){lastUpd=null;hideToast()},6000);
  }
  function updUndo(key,id,data,label){var prev=snap(key,id,Object.keys(data));upd(key,id,data);offerUndo(key,id,prev,label)}
  function undoUpd(){if(!lastUpd)return;var u=lastUpd;lastUpd=null;hideToast();upd(u.key,u.id,u.prev)}
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
      '<div class="lab">Mini-quêtes'+(ss.length?' · '+done+'/'+ss.length:'')+'</div>'+
      (ss.length?'<div class="bar"><i style="width:'+pc+'%"></i></div>':'')+
      (ss.length?'<ul class="steps">'+ss.map(function(x,i){return '<li class="step'+(x.done?' done':'')+'"><button class="chk" data-act="ps" data-id="'+id+'" data-i="'+i+'" aria-label="Mini-quête : '+esc(x.t)+'">'+CHECK+'</button><span>'+esc(x.t)+'</span><button class="sx" data-act="sd" data-id="'+id+'" data-i="'+i+'" aria-label="Supprimer : '+esc(x.t)+'" title="Supprimer">×</button></li>'}).join('')+'</ul>':'<div class="sub">Pas encore de mini-quête.</div>')+
      '<form class="stepform" data-form="step" data-id="'+id+'"><input class="in" maxlength="120" data-stepinput required placeholder="Nouvelle mini-quête" aria-label="Nouvelle mini-quête"><button class="btn" type="submit">+</button></form>'+
      '<div class="lab">Urgence</div>'+sg('prio',[['high','Urgent'],['med','Pas urgent'],['low','Optionnel']],PRIO[o.prio]?o.prio:'med')+
      '<div class="lab">Avancement</div>'+sg('status',[['todo','À faire'],['doing','En cours'],['done','Terminé']],st)+
      '<div class="lab">Liens et notes</div><textarea class="in notes" maxlength="2000" data-field="pnotes" rows="3" placeholder="Un lien, une idée, une remarque…" aria-label="Liens et notes">'+esc(o.notes||'')+'</textarea>'+
      (us.length?'<div class="nlinks">'+us.map(function(u){return '<a class="btn ghost" href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">↗ '+esc(u.replace(/^https?:\/\/(www\.)?/,'').split('/')[0])+'</a>'}).join('')+'</div>':'')+
      '<button class="btn ghost pin" data-act="pmain" data-id="'+id+'">'+(o.main?'📌 Retirer de la quête principale':'📌 Mettre en quête principale')+'</button>'+
      '<div class="prow"><button class="lnk del" data-act="pdel" data-id="'+id+'">Supprimer la quête</button><button class="btn valid" data-act="proj-save" data-id="'+id+'">Valider</button></div></div>';
  }

  /* Page dédiée aux quêtes (plein écran) */
  var qOpen=false,qShowDone=false;
  function qview(open,push){
    qOpen=open;var el=$('qview');el.hidden=!open;document.documentElement.classList.toggle('q-open',open);
    if(push){try{if(open)history.pushState({q:1},'','#quetes');else if(history.state&&history.state.q)history.back();else history.replaceState(null,'',location.pathname+location.search)}catch(e){}}
    if(open){renderQView();el.scrollTop=0;var b=el.querySelector('.qv-back');if(b)b.focus({preventScroll:true})}
  }
  window.addEventListener('popstate',function(){var want=location.hash==='#quetes';if(want!==qOpen)qview(want,false)});
  function qCard(o){
    var ss=o.steps||[],done=ss.filter(function(x){return x.done}).length,pc=ss.length?Math.round(done/ss.length*100):0,id=esc(o.id);
    var fin=o.status==='done'||(ss.length&&done===ss.length),p=PRIO[o.prio]?o.prio:'med',st=o.status||'todo';
    var us=String(o.notes||'').match(/https?:\/\/[^\s<>"']+/g)||[];
    var note=String(o.notes||'').replace(/https?:\/\/[^\s<>"']+/g,'').trim();
    return '<article class="qcard'+(fin?' done':'')+(o.main?' main':'')+'">'+
      (o.main?'<div class="qc-main">📌 Quête principale</div>':'')+
      '<div class="qc-h"><span class="em" aria-hidden="true">'+esc(o.emoji||'✨')+'</span><button class="qc-t" data-act="proj-open" data-id="'+id+'">'+esc(o.title)+'</button>'+
      '<select class="pr '+p+'" data-prio="'+id+'" aria-label="Urgence">'+['high','med','low'].map(function(k){return '<option value="'+k+'"'+(k===p?' selected':'')+'>'+PRIO[k]+'</option>'}).join('')+'</select></div>'+
      (ss.length?'<div class="qc-prog"><div class="bar"><i style="width:'+pc+'%"></i></div><span>'+done+'/'+ss.length+'</span></div>':'')+
      (ss.length?'<ul class="steps">'+ss.map(function(x,i){return '<li class="step'+(x.done?' done':'')+'"><button class="chk" data-act="ps" data-id="'+id+'" data-i="'+i+'" aria-label="Mini-quête : '+esc(x.t)+'">'+CHECK+'</button><span>'+esc(x.t)+'</span><button class="sx" data-act="sd" data-id="'+id+'" data-i="'+i+'" aria-label="Supprimer : '+esc(x.t)+'" title="Supprimer">×</button></li>'}).join('')+'</ul>':'')+
      '<form class="stepform" data-form="step" data-id="'+id+'"><input class="in" maxlength="120" data-stepinput required placeholder="Nouvelle mini-quête" aria-label="Nouvelle mini-quête pour '+esc(o.title)+'"><button class="btn" type="submit">+</button></form>'+
      '<div class="seg status">'+[['todo','À faire'],['doing','En cours'],['done','Terminé']].map(function(x){return '<button type="button" class="'+(st===x[0]?'on ':'')+x[0]+'" data-act="pset" data-id="'+id+'" data-f="status" data-v="'+x[0]+'">'+x[1]+'</button>'}).join('')+'</div>'+
      (note?'<p class="qc-note">'+esc(note)+'</p>':'')+
      (us.length?'<div class="nlinks">'+us.map(function(u){return '<a class="btn ghost" href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">↗ '+esc(u.replace(/^https?:\/\/(www\.)?/,'').split('/')[0])+'</a>'}).join('')+'</div>':'')+
      '<div class="qc-f"><button class="lnk" data-act="pmain" data-id="'+id+'">'+(o.main?'📌 Retirer de la principale':'📌 Mettre en principale')+'</button><button class="lnk" data-act="proj-open" data-id="'+id+'">Modifier…</button></div></article>';
  }
  function renderQView(){
    if(!qOpen)return;var L=$('qv-list');if(!L)return;
    var ae=document.activeElement;if(ae&&L.contains(ae)&&(ae.tagName==='INPUT'||ae.tagName==='TEXTAREA')&&ae.value)return;
    if(ae&&ae.matches&&ae.matches('#qv-list select.pr'))return;
    var isFin=function(o){var ss=o.steps||[];return o.status==='done'||(ss.length&&ss.every(function(x){return x.done}))};
    var srt=function(a,b){if(!!a.main!==!!b.main)return a.main?-1:1;var sa=a.status==='doing'?0:1,sb=b.status==='doing'?0:1;if(sa!==sb)return sa-sb;var q=(PW[b.prio]||2)-(PW[a.prio]||2);if(q)return q;return (a.createdAt||0)-(b.createdAt||0)};
    var act=S.projects.filter(function(o){return !isFin(o)}).sort(srt),fin=S.projects.filter(isFin).sort(srt);
    $('qv-count').textContent=act.length?act.length+' en cours ou à faire':'';
    L.innerHTML=(act.length?act.map(qCard).join(''):'<p class="empty">'+(loaded.projects?'Aucune quête en cours. Ajoute-en une !':'Chargement…')+'</p>')+
      (fin.length?'<button type="button" class="lnk donetog" data-act="qdone-tog" aria-expanded="'+qShowDone+'">'+(qShowDone?'▾':'▸')+' Terminées ('+fin.length+')</button>'+(qShowDone?fin.map(qCard).join(''):''):'');
  }

  /* ---- Courses ---- */
  function parseCourse(v){ /* « 2 lait », « lait x2 », « 🥛 lait 1L » */
    var sp=splitEmoji(v),t=sp.title,q='',m;
    if((m=t.match(/^(\d+[.,]?\d*\s?(?:kg|g|l|cl|ml|x)?)\s+(.+)$/i))){q=m[1];t=m[2]}
    else if((m=t.match(/^(.+?)\s+x\s?(\d+)$/i))){t=m[1];q=m[2]}
    t=t.trim().slice(0,60);
    return {title:t,qty:q.slice(0,12),emoji:sp.emoji||'',done:false};
  }
  function renderCourses(){
    var el=$('l-courses');if(!el)return;
    var todo=S.courses.filter(function(c){return !c.done}),inCart=S.courses.filter(function(c){return c.done});
    $('c-count').textContent='';var cvc=$('cv-count');if(cvc)cvc.textContent='';
    var row=function(c){return '<div class="crow'+(c.done?' done':'')+'"><button class="cchk" data-act="c-toggle" data-id="'+esc(c.id)+'" aria-label="'+(c.done?'Remettre dans la liste : ':'Dans le panier : ')+esc(c.title)+'"><span class="circ">'+CHECK+'</span><span class="ct">'+esc(c.title)+'</span>'+(c.qty?'<span class="cq">'+esc(c.qty)+'</span>':'')+'</button><button class="sx" data-act="c-del" data-id="'+esc(c.id)+'" aria-label="Supprimer : '+esc(c.title)+'" title="Supprimer">×</button></div>'};
    var byDate=function(a,b){return (a.createdAt||0)-(b.createdAt||0)};
    var h=todo.sort(byDate).map(row).join('');
    if(!h)h='<p class="empty">'+(loaded.courses?(inCart.length?'Tout est dans le panier 🎉':'La liste est vide.'):'Chargement…')+'</p>';
    if(inCart.length)h+='<div class="cart-h"><span class="sec-label">Dans le panier ('+inCart.length+')</span><button class="lnk" data-act="c-clear">Vider le panier</button></div>'+inCart.map(row).join('');
    el.innerHTML=h;
    if(cOpen){var cl=$('cv-list'),ae=document.activeElement;if(cl&&!(ae&&cl.contains(ae)&&ae.tagName==='INPUT'))cl.innerHTML=h}
  }
  /* Courses en plein écran (mode magasin) : grandes cases, écran gardé allumé */
  var cOpen=false,wake=null;
  function cview(open,push){
    cOpen=open;var el=$('cview');el.hidden=!open;document.documentElement.classList.toggle('q-open',open);
    if(push){try{if(open)history.pushState({c:1},'','#courses');else if(history.state&&history.state.c)history.back();else history.replaceState(null,'',location.pathname+location.search)}catch(e){}}
    if(open){renderCourses();syncNote();el.scrollTop=0;if(Date.now()-lastLoad>15000)load();
      try{if(navigator.wakeLock&&navigator.wakeLock.request)navigator.wakeLock.request('screen').then(function(w){wake=w},function(){})}catch(e){}}
    else if(wake){try{wake.release()}catch(e){}wake=null}
  }
  window.addEventListener('popstate',function(){var want=location.hash==='#courses';if(want!==cOpen)cview(want,false)});
  document.addEventListener('visibilitychange',function(){if(!document.hidden&&cOpen&&!wake&&navigator.wakeLock){navigator.wakeLock.request('screen').then(function(w){wake=w},function(){})}});
  var lastClear=null;
  function clearCart(){
    var items=S.courses.filter(function(c){return c.done});if(!items.length)return;
    lastClear=JSON.parse(JSON.stringify(items));
    items.forEach(function(c){delDoc('courses',c.id)});
    var el=$('toast');el.innerHTML='<span>Panier vidé</span><button type="button" data-act="c-unclear">Annuler</button>';el.hidden=false;
    clearTimeout(toastT);toastT=setTimeout(function(){lastClear=null;hideToast()},6000);
  }
  function unclearCart(){if(!lastClear)return;var l=lastClear;lastClear=null;hideToast();l.forEach(function(o){if(!find('courses',o.id)){S.courses.push(o);shWrite('courses',o)}});render()}

  /* ---- Onglets (Accueil / Maison / Courses) ---- */
  var TAB=lsGet('maison-tab')||'home';if(['home','maison','courses','voyage','test'].indexOf(TAB)<0)TAB='home';
  function setTab(t){TAB=t;lsSet('maison-tab',t);document.body.setAttribute('data-tab',t);
    [].forEach.call(document.querySelectorAll('.tabbar button'),function(b){var on=b.getAttribute('data-tab')===t;b.classList.toggle('on',on);b.setAttribute('aria-current',on?'page':'false')});
    window.scrollTo(0,0);fitTodo();if(t==='test')renderTest();if((t==='courses'||t==='voyage')&&Date.now()-lastLoad>15000)load()}
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
      var meta=[];if(Number(w.budget)>0)meta.push('<b>'+Math.round(Number(w.budget))+' €</b>');var wl=w.who==='couple'?'Couple':PEOPLE[w.who];if(wl)meta.push(esc(wl));if(w.urgency==='high')meta.push('🔥 Vite');else if(w.urgency==='low')meta.push('🌱 Un jour');
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
      '<div class="prow">'+(isNew?'':'<button class="lnk del" data-act="wf-del">Supprimer</button><button class="lnk" data-act="wf-got">'+(wd.done?UNDO+'Pas encore':'✓ Obtenu')+'</button>')+'<button class="btn valid" data-act="wf-save">'+(isNew?'Ajouter':'Valider')+'</button></div></div>';
  }
  function wishSave(){
    var sp=splitEmoji(wd.title||'');var title=sp.title||'';if(!title){var ti=document.querySelector('[data-wf="title"]');if(ti)ti.focus();return}
    var b=parseFloat(String(wd.budget).replace(',','.'));
    var data={title:title,emoji:sp.emoji||wd.emoji||autoEmoji(title),budget:b>0?b:null,urgency:wd.urgency||'med',who:wd.who||'couple',link:safeUrl(wd.link),note:String(wd.note||'').trim().slice(0,200)};
    if(wishOpen==='new'){data.done=false;addDoc('shop',data)}else upd('shop',wishOpen,data);
    wishOpen=null;renderSheet();
  }

  /* ---- Voyages ----
     Un seul onglet « Voyages » dans le Sheet, une ligne par élément : le voyage, puis ses trajets, transports
     sur place, hébergements, activités et sa valise (une seule ligne, un objet par ligne de texte).
     Pas de fichier : un billet = une référence + un lien (le script n'a volontairement pas accès à Drive). */
  var VT={voyage:'Voyage',trajet:'Trajet',transport:'Transport sur place',logement:'Hébergement',activite:'Activité',valise:'Valise'};
  var TMODE={avion:['✈️','Avion'],train:['🚆','Train'],bus:['🚌','Bus'],voiture:['🚗','Voiture'],bateau:['⛴️','Bateau']};
  var LMODE={location:['🚗','Location'],taxi:['🚕','Taxi'],metro:['🚇','Métro, bus'],navette:['🚐','Navette'],velo:['🚲','Vélo']};
  var TRIPEMO=['🚆','🏖️','🏔️','🏙️','🏝️','🎿','⛺','🌍','🗺️','🏰','🌴','❄️','🎒','🚗','🍷'];
  var AEMO=['📍','🏛️','🍽️','🎢','🏖️','🥾','🎭','🛍️','🍷','🚤','🎨','📸','⛷️','🧖','🎟️','🌅'];
  var PACK_TPL=['🪪 Papiers d\'identité','🎫 Billets et réservations','💳 Carte bancaire','📱 Chargeur de téléphone','🔋 Batterie externe','🔌 Adaptateur de prise','💊 Médicaments','🪥 Brosse à dents et dentifrice','🧴 Trousse de toilette','😴 Pyjama','🩲 Sous-vêtements','🧦 Chaussettes','👕 Hauts','👖 Bas','🧥 Veste','👟 Chaussures','🕶️ Lunettes de soleil','🎧 Écouteurs','🔑 Clés de la maison','🐕 Garde de Kimchi organisée'];
  var V_OLD=false,showPast=false,vOpen=null,tEdit=null,lastMulti=null;
  /* Programme jour par jour : masqué pour l'instant (demande du 13/11). Passer à true pour le réafficher. */
  var SHOW_PROG=false;
  var vEmoOpen=false,vPackOpen=false,vProgOpen=false,vDelConfirm=false;
  function vType(v){var n=nrm(v);if(!n)return '';
    if(n.indexOf('traj')===0)return 'trajet';if(n.indexOf('transp')===0)return 'transport';
    if(n.indexOf('heberg')===0||n.indexOf('logement')===0||n.indexOf('hotel')===0)return 'logement';
    if(n.indexOf('activ')===0)return 'activite';if(n.indexOf('valise')===0)return 'valise';if(n.indexOf('voyage')===0)return 'voyage';return ''}
  /* « 2026-12-20 08:35 », « 20/12/2026 08:35:00 » ou « 2026-12-20 » → « 2026-12-20 08:35 » / « 2026-12-20 » */
  function nDT(v){v=String(v==null?'':v).trim();var d=nDate(v);if(!d)return '';var m=v.match(/[T\s](\d{1,2})[:h](\d{2})/);return m?d+' '+pad(m[1])+':'+m[2]:d}
  function dPart(s){return String(s||'').slice(0,10)}
  function hPart(s){var m=String(s||'').match(/\s(\d{2}:\d{2})$/);return m?m[1]:''}
  function fmtDay(ds,o){return parse(ds).toLocaleDateString('fr-FR',o||{weekday:'short',day:'numeric',month:'short'}).replace(/\./g,'')}
  function relDay(ds){var n=diff(ds);return n===0?"aujourd'hui":n===1?'demain':fmtDay(ds)}
  function fmtWhen(s){if(!s)return '';var h=hPart(s);return cap(fmtDay(dPart(s)))+(h?' · '+h:'')}
  function fmtEur(n){return Number(n).toLocaleString('fr-FR',{maximumFractionDigits:2})+' €'}
  function mapsUrl(q){return 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(q)}
  /* Icône d'un voyage : le train par défaut (l'ancien avion par défaut devient un train) */
  function tEmo(t){return !t.emoji||t.emoji==='✈️'?'🚆':t.emoji}
  function trips(){return S.voyages.filter(function(x){return x.type==='voyage'})}
  function kids(tid,type){return S.voyages.filter(function(x){return x.trip===tid&&x.type!=='voyage'&&(!type||x.type===type)})}
  function byStart(a,b){var sk=function(v){return !v?'9999':v.length===10?v+' 99:99':v},x=sk(a.start),y=sk(b.start);if(x!==y)return x<y?-1:1;return (a.createdAt||0)-(b.createdAt||0)}
  function vEmoji(o){
    if(o.type==='trajet')return (TMODE[o.mode]||TMODE.avion)[0];
    if(o.type==='transport')return (LMODE[o.mode]||LMODE.location)[0];
    if(o.type==='logement')return '🛏️';if(o.type==='valise')return '🧳';
    return o.emoji||(o.type==='activite'?'📍':'🚆')}
  function tripSpan(t){var s=dPart(t.start),e=dPart(t.end),ds=[];
    if(!s||!e)kids(t.id).forEach(function(k){if(k.type==='valise')return;if(k.start)ds.push(dPart(k.start));if(k.end)ds.push(dPart(k.end))});
    ds.sort();if(!s)s=ds[0]||'';if(!e)e=ds[ds.length-1]||s;if(s&&e<s)e=s;return {s:s,e:e}}
  function tripState(t){var sp=tripSpan(t),td=iso(new Date());
    if(!sp.s)return {k:'nodate',sp:sp};
    if(td<sp.s)return {k:'soon',n:diff(sp.s),sp:sp};
    if(td>sp.e)return {k:'past',sp:sp};
    return {k:'now',day:Math.round((t0()-parse(sp.s))/864e5)+1,tot:Math.round((parse(sp.e)-parse(sp.s))/864e5)+1,sp:sp}}
  function tripBadge(st){return st.k==='soon'?(st.n===1?'Demain !':'J-'+st.n):st.k==='now'?'Jour '+st.day+'/'+st.tot:st.k==='past'?'Terminé':'Dates à fixer'}
  function spanTxt(sp){if(!sp.s)return 'Dates à définir';
    var o={day:'numeric',month:'short'},y=parse(sp.s).getFullYear(),yy=y!==new Date().getFullYear()?' '+y:'';
    if(sp.e===sp.s)return cap(fmtDay(sp.s,{weekday:'long',day:'numeric',month:'long'}))+yy;
    var n=Math.round((parse(sp.e)-parse(sp.s))/864e5);
    return fmtDay(sp.s,o)+' → '+fmtDay(sp.e,o)+yy+' · '+n+' nuit'+(n>1?'s':'')}
  function nextTrip(){var best=null,bs=null;
    trips().forEach(function(t){var st=tripState(t);
      if(st.k==='now'){if(!bs||bs.k!=='now'||st.sp.s<bs.sp.s){best=t;bs=st}}
      else if(st.k==='soon'&&(!bs||(bs.k==='soon'&&st.n<bs.n))){best=t;bs=st}});
    return best}
  function nextEv(t){var now=new Date(),td=iso(now),hm=pad(now.getHours())+':'+pad(now.getMinutes());
    var k=kids(t.id).filter(function(x){if(x.type!=='activite'||!x.start)return false;var d=dPart(x.start),h=hPart(x.start);return d>td||(d===td&&(!h||h>=hm))}).sort(byStart)[0];
    if(!k)return '';var h=hPart(k.start);return vEmoji(k)+' '+k.title+' · '+relDay(dPart(k.start))+(h?' '+h:'')}

  /* Accueil : compte à rebours du prochain voyage (ou « Jour 2 sur 5 » pendant le voyage) */
  function tripRowInner(t){var st=tripState(t),big=st.k==='now'?'Jour '+st.day+' sur '+st.tot:st.n===1?'Départ demain !':'Départ dans '+st.n+' jours';
    var sub=st.k==='now'?(nextEv(t)||(hPart(t.end)?'Retour '+relDay(dPart(t.end))+' à '+hPart(t.end):big)):('Départ '+relDay(dPart(t.start))+(hPart(t.start)?' · '+hPart(t.start):''));
    return (st.k==='soon'?'<span class="tn-n"><b>J-'+st.n+'</b></span>':'<span class="tn-em" aria-hidden="true">'+esc(tEmo(t))+'</span>')+'<span class="tn-main"><span class="tn-t">'+esc(tEmo(t)+' '+t.title)+'</span><span class="tn-s">'+esc(sub)+'</span></span>'}
  function renderTripNext(){var el=$('trip-next');if(!el)return;var t=nextTrip();
    if(!t){el.hidden=true;el.innerHTML='';return}
    var st=tripState(t),big=st.k==='now'?'Jour '+st.day+' sur '+st.tot:st.n===1?'Départ demain !':'Départ dans '+st.n+' jours';
    /* Même gabarit qu'un événement « À venir » : pastille à gauche, titre, une ligne de détail */
    var sub=st.k==='now'?(nextEv(t)||(hPart(t.end)?'Retour '+relDay(dPart(t.end))+' à '+hPart(t.end):big)):('Départ '+relDay(dPart(t.start))+(hPart(t.start)?' · '+hPart(t.start):''));
    el.className='tripnext '+st.k;el.setAttribute('data-id',t.id);el.setAttribute('aria-label','Voyage '+t.title+' : '+big);
    el.innerHTML=(st.k==='soon'?'<span class="tn-n"><b>J-'+st.n+'</b></span>':'<span class="tn-em" aria-hidden="true">'+esc(tEmo(t))+'</span>')+
      '<span class="tn-main"><span class="tn-t">'+esc(tEmo(t)+' '+t.title)+'</span><span class="tn-s">'+esc(sub)+'</span></span>';
    el.hidden=false}

  /* Onglet Voyages : la liste des voyages */
  function tripCounts(t){var K=kids(t.id),out=[],c=function(ty){return K.filter(function(k){return k.type===ty}).length};
    var l=c('logement'),ac=c('activite');
    if(l)out.push(l+' hébergement'+(l>1?'s':''));if(ac)out.push(ac+' activité'+(ac>1?'s':''));
    var v=packOf(t.id);if(v&&v.items.length)out.push('🧳 '+v.items.filter(function(x){return x.done}).length+'/'+v.items.length);
    return out.join(' · ')}
  function renderTrips(){var el=$('l-voyages');if(!el)return;
    if(V_OLD){el.innerHTML='<p class="empty">Presque prêt ! Il reste à publier la nouvelle version du script Google pour enregistrer les voyages.</p>';return}
    var all=trips().map(function(t){return {t:t,st:tripState(t)}}),R={now:0,soon:1,nodate:2};
    var up=all.filter(function(x){return x.st.k!=='past'}).sort(function(a,b){if(R[a.st.k]!==R[b.st.k])return R[a.st.k]-R[b.st.k];return a.st.sp.s<b.st.sp.s?-1:a.st.sp.s>b.st.sp.s?1:0});
    var past=all.filter(function(x){return x.st.k==='past'}).sort(function(a,b){return a.st.sp.s<b.st.sp.s?1:-1});
    var tile=function(x){var t=x.t,c=tripCounts(t);
      return '<button class="ttile '+x.st.k+'" data-act="trip-open" data-id="'+esc(t.id)+'"><span class="tt-em" aria-hidden="true">'+esc(tEmo(t))+'</span>'+
        '<span class="tt-main"><span class="tt-t">'+esc(t.title)+'</span><span class="tt-d">'+esc(spanTxt(x.st.sp))+'</span>'+(c?'<span class="tt-c">'+esc(c)+'</span>':'')+'</span>'+
        '<span class="tt-b">'+esc(tripBadge(x.st))+'</span></button>'};
    var nt=nextTrip(),hero='';
    if(nt){var hs=tripState(nt);hero='<button class="thero '+hs.k+'" data-act="trip-open" data-id="'+esc(nt.id)+'"><span class="th-k">'+(hs.k==='now'?'Voyage en cours':'Prochain départ')+'</span><span class="th-t">'+esc(tEmo(nt)+' '+nt.title)+'</span>'+countdownHtml(nt)+'</button>'}
    el.innerHTML=hero+(up.length?'<div class="trips">'+up.map(tile).join('')+'</div>':empty('voyages','Aucun voyage prévu.<br>Ajoute ton prochain départ avec « + Nouveau ».'))+
      (past.length?'<button type="button" class="lnk donetog" data-act="trips-past" aria-expanded="'+showPast+'">'+(showPast?'▾':'▸')+' Voyages passés ('+past.length+')</button>'+(showPast?'<div class="trips">'+past.map(tile).join('')+'</div>':''):'')}

  /* Page d'un voyage (plein écran) */
  function vview(id,push){
    vOpen=id||null;var el=$('vview');el.hidden=!vOpen;document.documentElement.classList.toggle('q-open',!!vOpen);
    if(vOpen)lsSet('maison-trip',vOpen);
    if(push){try{if(vOpen)history.pushState({v:1},'','#voyage');else if(history.state&&history.state.v)history.back();else history.replaceState(null,'',location.pathname+location.search)}catch(e){}}
    if(vOpen){renderVView();el.scrollTop=0;var b=el.querySelector('.qv-back');if(b)b.focus({preventScroll:true})}
  }
  window.addEventListener('popstate',function(){if(location.hash!=='#voyage'&&vOpen)vview(null,false)});
  var TPLEMO=['🧳','🎒','⛺','🌤️','🐕','🏠','🏖️','🎿','🏔️','🚗','👶','💼','🎉','🧺'];
  var TPL_SEED=[['🎒','Essentiels',PACK_TPL],
    ['⛺','Camping',['⛺ Tente','🛌 Sacs de couchage','🛏️ Matelas gonflables','🔦 Lampes frontales','🔥 Réchaud et gaz','🪔 Briquet','🚰 Gourdes','🔪 Couteau suisse','🦟 Anti-moustique','🧴 Crème solaire','🩹 Trousse de secours','🧻 Papier toilette','🗑️ Sacs poubelle','🧥 Pull chaud']],
    ['🌤️','Sortie à la journée',['🚰 Gourde','🥪 Pique-nique','🧴 Crème solaire','🕶️ Lunettes de soleil','🧢 Casquette','☔ Veste de pluie','🔋 Batterie externe','🤧 Mouchoirs','💳 Carte bancaire','🔑 Clés']],
    ['🐕','Avec Kimchi',['🥣 Croquettes','🍽️ Gamelles','🦮 Laisse et harnais','💩 Sacs à crottes','💊 Médicaments de Kimchi','📘 Carnet de santé','🧺 Panier ou couverture','🧸 Jouet','🦴 Friandises','🧻 Serviette pour le chien']],
    ['🏠','Sans Kimchi',['🐕 Garde de Kimchi organisée','🥣 Croquettes pour le gardien','💊 Médicaments de Kimchi pour le gardien','📞 Numéro du véto donné','🔑 Clés pour le gardien']]];
  function packOf(tid){return kids(tid,'valise')[0]||null}
  function setPack(tid,items){var v=packOf(tid);items=items.slice(0,200);
    if(v)upd('voyages',v.id,{items:items});else addDoc('voyages',{trip:tid,type:'valise',title:'Valise',items:items,done:false})}
  function packCopy(fromId){var src=fromId&&packOf(fromId);if(!src||!vOpen)return;setPack(vOpen,src.items.map(function(x){return {t:x.t,done:false}}))}
  /* Listes types : lignes « Valise » sans voyage parent, dans le même onglet du Sheet */
  function tpls(){return S.voyages.filter(function(x){return x.type==='valise'&&!x.trip}).sort(function(a,b){return (a.createdAt||0)-(b.createdAt||0)})}
  function seedTpls(){if(V_OLD||!loaded.voyages||fromCache||tpls().length||lsGet('maison-tpl-seed')==='1')return;lsSet('maison-tpl-seed','1');
    TPL_SEED.forEach(function(x){addDoc('voyages',{trip:'',type:'valise',title:x[1],emoji:x[0],items:x[2].map(function(t){return {t:t,done:false}}),done:false})})}
  function applyTpl(id){var tp=find('voyages',id);if(!tp||!vOpen)return;var p=packOf(vOpen),cur=(p?p.items:[]).map(function(x){return {t:x.t,done:!!x.done}}),have={},n=0;
    cur.forEach(function(x){have[nrm(x.t)]=1});
    (tp.items||[]).forEach(function(x){if(!have[nrm(x.t)]){cur.push({t:x.t,done:false});have[nrm(x.t)]=1;n++}});
    if(n)setPack(vOpen,cur);toastMsg(n?'« '+tp.title+' » : '+n+' objet'+(n>1?'s':'')+' ajouté'+(n>1?'s':''):'Tout est déjà dans la valise')}
  function vPack(t){var v=packOf(t.id),items=v?v.items:[];
    var form='<form class="stepform" data-form="pack"><input class="in" maxlength="80" data-packinput required enterkeyhint="done" placeholder="Ajouter… ex. maillot de bain" aria-label="Ajouter à la valise"><button class="btn" type="submit">+</button></form>';
    var T=tpls(),chips='<div class="lab">Ajouter une liste type</div><div class="tchips">'+T.map(function(tp){return '<button class="tchip" data-act="tpl-use" data-id="'+esc(tp.id)+'">'+esc((tp.emoji||'🧳')+' '+tp.title)+' <i>'+(tp.items||[]).length+'</i></button>'}).join('')+
      '<button class="tchip ghost" data-act="tpl-mgr">⚙️ Gérer les listes</button></div>';
    if(!items.length){
      var others=trips().filter(function(o){var p=packOf(o.id);return o.id!==t.id&&p&&p.items.length});
      return '<div class="vpack"><p class="empty">La valise est vide.</p>'+chips+
        (others.length?'<select class="in" data-pack-copy aria-label="Copier la valise d\'un autre voyage"><option value="">Ou copier la valise d\'un autre voyage…</option>'+others.map(function(o){return '<option value="'+esc(o.id)+'">'+esc(tEmo(o)+' '+o.title)+'</option>'}).join('')+'</select>':'')+
        '<div class="lab">Ou ajoute tes objets un par un</div>'+form+'</div>'}
    var done=items.filter(function(x){return x.done}).length,pc=Math.round(done/items.length*100);
    var srt=items.map(function(x,i){return {x:x,i:i}}).sort(function(a,b){return (a.x.done?1:0)-(b.x.done?1:0)||a.i-b.i});
    return '<div class="vpack"><div class="qc-prog"><div class="bar"><i style="width:'+pc+'%"></i></div><span>'+done+'/'+items.length+(done===items.length?' · prête ! 🎉':'')+'</span></div>'+form+
      '<ul class="steps">'+srt.map(function(o){var x=o.x,i=o.i;return '<li class="step'+(x.done?' done':'')+'"><button class="chk" data-act="pack-tog" data-i="'+i+'" aria-label="'+(x.done?'Ressortir : ':'Dans la valise : ')+esc(x.t)+'">'+CHECK+'</button><span>'+esc(x.t)+'</span><button class="sx" data-act="pack-del" data-i="'+i+'" aria-label="Retirer : '+esc(x.t)+'" title="Retirer">×</button></li>'}).join('')+'</ul>'+
      '<div class="prow">'+(done?'<button class="lnk" data-act="pack-reset">'+UNDO+'Tout décocher</button>':'')+'<button class="lnk" data-act="tpl-from-pack">💾 Enregistrer comme liste type</button></div>'+chips+'</div>'}
  function vProg(t){var sp=tripSpan(t),K=kids(t.id).filter(function(k){return k.type!=='valise'}),ds=[sp.s,sp.e];
    K.forEach(function(k){if(k.start)ds.push(dPart(k.start));if(k.end)ds.push(dPart(k.end))});
    ds=ds.filter(Boolean).sort();
    var ideas=K.filter(function(k){return k.type==='activite'&&!k.start});
    var ideasH=ideas.length?'<div class="sec-label">💡 À caser</div><div class="pideas">'+ideas.map(function(k){return '<button data-act="v-item" data-id="'+esc(k.id)+'">'+esc(vEmoji(k)+' '+k.title)+'</button>'}).join('')+'</div>':'';
    if(!ds.length)return '<p class="empty">Ajoute les dates du voyage (bouton « Modifier ») ou un premier trajet pour voir le programme jour par jour.</p>'+ideasH;
    var days=[],d=parse(ds[0]),end=parse(ds[ds.length-1]),td=iso(new Date());
    while(d<=end&&days.length<45){days.push(iso(d));d.setDate(d.getDate()+1)}
    return days.map(function(day){var it=[];
      K.forEach(function(k){var a=dPart(k.start),b=dPart(k.end),ha=hPart(k.start),hb=hPart(k.end),em=vEmoji(k);
        if(k.type==='logement'){
          if(a===day)it.push({h:ha,em:em,t:'Arrivée · '+k.title,k:k});
          else if(b===day)it.push({h:hb,em:em,t:'Départ · '+k.title,k:k});
          else if(a&&b&&day>a&&day<b)it.push({h:'',em:em,t:'Nuit · '+k.title,k:k,dim:true});
          return}
        if(a===day){var sub=[];
          if(k.type==='trajet'){if(hb&&b===a)sub.push('arrivée '+hb);if(k.num)sub.push(k.num)}
          if(k.type==='transport'&&b&&b!==a)sub.push('jusqu\'au '+fmtDay(b));
          if(k.place&&k.type!=='trajet')sub.push(k.place);
          it.push({h:ha,em:em,t:k.title,sub:sub.join(' · '),k:k,done:k.done})}
        else if(b===day&&a&&b!==a&&k.type!=='activite')it.push({h:hb,em:em,t:(k.type==='trajet'?'Arrivée · ':'Fin · ')+k.title,k:k})});
      it.sort(function(x,y){if(!!x.dim!==!!y.dim)return x.dim?1:-1;var p=x.h||'99:99',q=y.h||'99:99';return p<q?-1:p>q?1:0});
      var inTrip=sp.s&&day>=sp.s&&day<=sp.e,n=inTrip?Math.round((parse(day)-parse(sp.s))/864e5)+1:0;
      return '<section class="pday'+(day===td?' today':'')+(day<td?' gone':'')+'"><div class="pd-h"><b>'+esc(cap(fmtDay(day,{weekday:'long',day:'numeric',month:'long'})))+'</b>'+(n?'<span>Jour '+n+'</span>':'')+(day===td?'<i>Aujourd\'hui</i>':'')+'</div>'+
        (it.length?it.map(function(x){return '<button class="pit'+(x.dim?' dim':'')+(x.done?' done':'')+'" data-act="v-item" data-id="'+esc(x.k.id)+'"><span class="pi-h">'+esc(x.h||'')+'</span><span class="pi-em" aria-hidden="true">'+esc(x.em)+'</span><span class="pi-t">'+esc(x.t)+(x.sub?'<small>'+esc(x.sub)+'</small>':'')+'</span></button>'}).join(''):'<p class="pfree">Journée libre ✨</p>')+'</section>'}).join('')+ideasH}
  /* Départ = date et heure de l'aller, enregistrées sur le voyage lui-même */
  function departAt(t){if(!t.start)return null;var h=hPart(t.start);return h?{d:new Date(dPart(t.start)+'T'+h),exact:true}:{d:parse(dPart(t.start)),exact:false}}
  /* Compte à rebours façon panneau d'aéroport : une case par chiffre, qui bascule quand il change */
  function flapParts(ms){var s=Math.max(0,Math.floor(ms/1000));return [String(Math.floor(s/86400)).padStart(2,'0'),pad(Math.floor(s%86400/3600)),pad(Math.floor(s%3600/60)),pad(s%60)]}
  function flapInner(ms){var L=['jours','heures','min','sec'];
    return flapParts(ms).map(function(v,i){return '<span class="fg"><span class="fd">'+v.split('').map(function(c){return '<i><b>'+c+'</b></i>'}).join('')+'</span><small>'+L[i]+'</small></span>'}).join('<span class="fsep" aria-hidden="true"><b></b><b></b></span>')}
  function tickFlaps(){var now=Date.now();
    [].forEach.call(document.querySelectorAll('.flap[data-cd]'),function(el){var p=flapParts(Number(el.getAttribute('data-cd'))-now),G=el.querySelectorAll('.fd');
      if(G.length!==4||G[0].children.length!==p[0].length){el.innerHTML=flapInner(Number(el.getAttribute('data-cd'))-now);return}
      p.forEach(function(v,i){var C=G[i].children;for(var k=0;k<C.length;k++){var b=C[k].firstChild;if(b.textContent!==v[k]){b.textContent=v[k];C[k].classList.remove('flip');void C[k].offsetWidth;C[k].classList.add('flip')}}});
      el.setAttribute('aria-label','Départ dans '+Number(p[0])+' jours, '+Number(p[1])+' heures et '+Number(p[2])+' minutes')})}
  setInterval(function(){if(!document.hidden)tickFlaps()},1000);
  function countdownHtml(t){var st=tripState(t);
    if(st.k==='now'){var r=hPart(t.end)&&dPart(t.end)===iso(new Date())?' · retour aujourd\'hui à '+hPart(t.end):'';return '<span class="vcd-now">🌴 En plein voyage · jour '+st.day+' sur '+st.tot+esc(r)+'</span>'}
    if(st.k==='past')return '<span class="vcd-past">Voyage terminé</span>';
    var da=departAt(t);if(!da)return '<span class="vcd-past">Choisis la date de départ pour lancer le compte à rebours</span>';
    return '<span class="flap" role="timer" data-cd="'+da.d.getTime()+'">'+flapInner(da.d-Date.now())+'</span>'+
      '<span class="vcd-sub">Départ '+esc(relDay(dPart(t.start)))+(da.exact?' à '+esc(hPart(t.start)):'')+'</span>'}
  function vSecH(ic,lab,type){return '<div class="vsec-h"><h3>'+ic+' '+lab+'</h3>'+(type?'<button class="mini" data-act="v-add" data-v="'+type+'">+ Ajouter</button>':'')+'</div>'}
  function vStay(k){var btn=k.place?'<a class="btn ghost" href="'+esc(mapsUrl(k.place))+'" target="_blank" rel="noopener noreferrer">📍 Plan ↗</a>':'';
    return '<article class="vcard"><div class="vc-top"><div class="vc-h" role="button" tabindex="0" data-act="v-item" data-id="'+esc(k.id)+'" aria-label="Modifier : '+esc(k.title)+'"><span class="em" aria-hidden="true">🛏️</span><div class="main"><span class="t">'+esc(k.title)+'</span>'+(k.place?'<span class="sub">'+esc(k.place)+'</span>':'')+(k.notes?'<span class="vmeta">'+esc(k.notes)+'</span>':'')+'</div></div>'+btn+'</div></article>'}
  function vAct(k){var id=esc(k.id);
    return '<article class="vcard vact'+(k.done?' done':'')+'"><div class="vc-top"><button class="chk" data-act="v-done" data-id="'+id+'" aria-label="'+(k.done?'Pas encore fait : ':'Fait : ')+esc(k.title)+'">'+CHECK+'</button><div class="vc-h" role="button" tabindex="0" data-act="v-item" data-id="'+id+'" aria-label="Modifier : '+esc(k.title)+'">'+
      '<div class="main"><span class="t">'+esc(k.title)+'</span>'+(k.start?'<span class="sub">'+esc(cap(fmtDay(dPart(k.start))))+'</span>':'')+(k.notes?'<span class="vmeta">'+esc(k.notes)+'</span>':'')+'</div></div></div></article>'}
  function vMain(t){var h='';
    var dt=function(lab,p,v){return '<div class="vi-dt"><span>'+lab+'</span><input class="in" type="date" data-trip="'+p+'D" value="'+esc(dPart(v))+'" aria-label="'+lab+' : jour"><input class="in" type="time" data-trip="'+p+'T" value="'+esc(hPart(v))+'" aria-label="'+lab+' : heure"></div>'};
    h+='<section class="vinfo"><div class="vi-row"><button type="button" class="ibtn'+(vEmoOpen?' open':'')+'" data-act="trip-emo-tog" aria-label="Changer l\'icône">'+esc(tEmo(t))+'</button>'+
      '<input class="in vi-title" maxlength="80" data-trip="title" value="'+esc(t.title)+'" aria-label="Destination" placeholder="Destination"></div>'+
      (vEmoOpen?'<div class="emos pop">'+TRIPEMO.map(function(e){return '<button type="button" class="emo'+(t.emoji===e?' on':'')+'" data-act="trip-emo" data-e="'+e+'" aria-label="Icône '+e+'">'+e+'</button>'}).join('')+'</div>':'')+
      dt('🚆 Départ','start',t.start)+dt('🏠 Retour','end',t.end)+
      '</section>';
    var H=kids(t.id,'logement').sort(byStart);
    h+=vSecH('🛏️','Hébergement','logement')+(H.length?H.map(vStay).join(''):'<p class="vempty">Pas encore d\'hébergement.</p>');
    var A=kids(t.id,'activite').sort(byStart);
    h+=vSecH('📍','Activités sur place','activite')+(A.length?A.map(vAct).join(''):'<p class="vempty">Note tes idées, même sans date.</p>');
    var P=packOf(t.id),pn=P?P.items.length:0,pd=P?P.items.filter(function(x){return x.done}).length:0;
    h+='<button class="vfold" data-act="pack-fold" aria-expanded="'+vPackOpen+'"><span>🧳 Valise</span><i>'+(pn?pd+'/'+pn:'vide')+'</i><b>'+(vPackOpen?'▾':'▸')+'</b></button>'+(vPackOpen?vPack(t):'');
    if(SHOW_PROG)h+='<button class="vfold" data-act="prog-fold" aria-expanded="'+vProgOpen+'"><span>🗓️ Programme jour par jour</span><i></i><b>'+(vProgOpen?'▾':'▸')+'</b></button>'+(vProgOpen?vProg(t):'');
    h+='<div class="vdel"><button class="lnk del" data-act="trip-del">'+(vDelConfirm?'Oui, supprimer « '+esc(t.title)+' » et tout son contenu':'Supprimer ce voyage')+'</button>'+(vNew===t.id?'<button class="btn valid vi-ok" data-act="trip-ok">Valider</button>':'')+'</div>';
    return h}
  function renderVView(){if(!vOpen)return;var B=$('vv-body');if(!B)return;
    var ae=document.activeElement,t=find('voyages',vOpen);
    if(vSkip||ae&&$('vview').contains(ae)&&((ae.tagName==='INPUT'||ae.tagName==='SELECT')&&ae.value||ae.hasAttribute('data-trip'))){if(t)$('vv-title').textContent=tEmo(t)+' '+t.title;return}
    if(!t||t.type!=='voyage'){if(loaded.voyages&&!fromCache)vview(null,true);else B.innerHTML='<p class="empty">Chargement…</p>';return}
    var st=tripState(t);
    $('vv-title').textContent=tEmo(t)+' '+t.title;
    $('vv-sub').textContent=spanTxt(st.sp)+(st.k==='nodate'?'':' · '+tripBadge(st));
    B.innerHTML=vMain(t);
  }
  function tripDelete(id){var all=[find('voyages',id)].concat(kids(id)).filter(Boolean);if(!all.length)return;lastMulti=JSON.parse(JSON.stringify(all));
    vDelConfirm=false;if(vOpen===id)vview(null,true);
    all.forEach(function(o){delDoc('voyages',o.id)});
    var el=$('toast');el.innerHTML='<span>Voyage supprimé</span><button type="button" data-act="undo-multi">Annuler</button>';el.hidden=false;
    clearTimeout(toastT);toastT=setTimeout(function(){lastMulti=null;hideToast()},8000)}
  /* Champs du voyage : enregistrés sans redessiner la page, pour ne pas perdre le champ suivant en cours de saisie */
  var vSkip=false;
  function tripField(f,v){vSkip=true;try{tripField_(f,v)}finally{vSkip=false}}
  function tripField_(f,v){var t=vOpen&&find('voyages',vOpen);if(!t)return;
    if(f==='title'){var sp=splitEmoji(v);if(!sp.title){renderVView();return}var d={title:sp.title};if(sp.emoji)d.emoji=sp.emoji;upd('voyages',t.id,d);return}
    if(f==='link'){vBilEdit=false;upd('voyages',t.id,{link:safeUrl(v)});return}
    var c={sD:dPart(t.start),sT:hPart(t.start),eD:dPart(t.end),eT:hPart(t.end)},k={startD:'sD',startT:'sT',endD:'eD',endT:'eT'}[f];if(!k)return;
    c[k]=k.charAt(1)==='D'?(nDate(v)||''):(/^\d{2}:\d{2}/.test(v)?v.slice(0,5):'');
    if(k==='sD'&&c.sD&&(!c.eD||c.eD<c.sD))c.eD=c.sD;if(k==='eD'&&c.eD&&c.sD&&c.eD<c.sD)c.sD=c.eD;
    var comb=function(D,T){return D?D+(T?' '+T:''):''};
    upd('voyages',t.id,{start:comb(c.sD,c.sT),end:comb(c.eD,c.eT)})}
  setInterval(function(){if(document.hidden)return;if(vOpen)renderVView();else if(TAB==='voyage')renderTrips()},60000);

  /* Fiches d'édition (pop-up) : hébergement, activité */
  function tOpen(type,id,trip){var o=id?find('voyages',id):null,d;
    d=o?JSON.parse(JSON.stringify(o)):{type:type,trip:trip||'',title:''};d.sD=dPart(d.start);
    tEdit={id:id||'new',type:type,d:d};iconOpen=false;projId=null;openId=null;wishOpen=null;evEdit=null;tplMgr=false;tplEdit=null;renderSheet();
    var f=document.querySelector('.sheet-card [data-tf="title"]');if(f&&!id)f.focus()}
  function tPanel(){var e=tEdit,d=e.d,ty=e.type,isNew=e.id==='new';
    var inp=function(f,lab,ph,max){return '<div><div class="lab">'+lab+'</div><input class="in" maxlength="'+(max||120)+'" data-tf="'+f+'" value="'+esc(d[f]==null?'':d[f])+'" placeholder="'+esc(ph||'')+'" aria-label="'+esc(lab)+'"></div>'};
    var notes=function(lab,ph){return '<div class="lab">'+lab+'</div><textarea class="in notes" maxlength="1000" data-tf="notes" rows="2" placeholder="'+esc(ph)+'" aria-label="'+esc(lab)+'">'+esc(d.notes||'')+'</textarea>'};
    var h='<div class="panel tform"><div class="pj-title">'+(ty==='logement'?(isNew?'Nouvel hébergement':'Hébergement'):(isNew?'Nouvelle activité':'Activité'))+'</div>';
    if(ty==='logement')h+=inp('title','Nom','Ex. Airbnb Alfama')+inp('place','Adresse','Ex. Rua da Rosa 12, Lisbonne',200)+notes('Infos utiles (facultatif)','Code de la porte, contact…');
    else h+=inp('title','Activité','Ex. Musée des azulejos')+
      '<div><div class="lab">Jour (facultatif)</div><input class="in" type="date" data-tf="sD" value="'+esc(d.sD||'')+'" aria-label="Jour de l\'activité"></div>'+notes('Note (facultatif)','Horaires, à réserver avant…');
    h+='<div class="prow">'+(isNew?'':'<button class="lnk del" data-act="tf-del">Supprimer</button>')+'<button class="btn valid" data-act="tf-save">'+(isNew?'Ajouter':'Valider')+'</button></div></div>';
    return h}
  function tSave(){var e=tEdit;if(!e)return;var d=e.d,sp=splitEmoji(d.title||''),title=sp.title||(e.type==='logement'?'Hébergement':'');
    if(!title){var ti=document.querySelector('.sheet-card [data-tf="title"]');if(ti)ti.focus();return}
    var clip=function(v,n){return String(v==null?'':v).trim().slice(0,n)};
    var data={title:title,notes:clip(d.notes,1000)};
    if(e.type==='logement')data.place=clip(d.place,200);
    else{data.title=(sp.emoji?sp.emoji+' ':'')+title;data.start=nDate(d.sD)||''}
    tEdit=null;
    if(e.id==='new'){data.type=e.type;data.trip=d.trip;data.done=false;addDoc('voyages',data)}else upd('voyages',e.id,data);
    renderSheet()}
  function tDel(){var e=tEdit;if(!e||e.id==='new')return;tEdit=null;renderSheet();delUndo('voyages',e.id,'Supprimé')}
  /* Gestion des listes types (pop-up) */
  var vNew=null;
  var tplMgr=false,tplEdit=null,vBilEdit=false,bilPop=null;
  /* Billets : pop-up de confirmation avant d'ouvrir un lien externe, ou pour le régler */
  function bilPanel(){var t=vOpen&&find('voyages',vOpen);if(!t)return '';var lk=safeUrl(t.link),dom=lk.replace(/^https?:\/\/(www\.)?/,'').split('/')[0];
    var form='<div class="lab">Lien vers les billets</div><input class="in" type="url" inputmode="url" maxlength="500" data-bil value="'+esc(t.link||'')+'" placeholder="https://www.sncf-connect.com/…" aria-label="Lien vers les billets">';
    if(lk&&!bilPop.edit)return '<div class="panel bil"><div class="pj-title">🎟️ Billets</div><div class="bil-warn">⚠️ Attention, cela va ouvrir un lien externe :<b>'+esc(dom)+'</b></div>'+
      '<div class="prow bil-row"><button class="btn ghost" data-act="bil-edit">Modifier le lien</button><a class="btn valid" href="'+esc(lk)+'" target="_blank" rel="noopener noreferrer" data-close>Valider</a></div></div>';
    return '<div class="panel bil"><div class="pj-title">🎟️ Billets</div>'+(lk?'':'<div class="bil-warn">⚠️ Attention, aucun lien programmé pour les billets.</div>')+form+
      '<div class="prow bil-row">'+(lk?'<button class="btn ghost" data-act="bil-cancel">Annuler</button>':'')+'<button class="btn valid" data-act="bil-save">Enregistrer</button></div></div>'}
  function bilSave(){var i=document.querySelector('.sheet-card [data-bil]'),v=i?i.value.trim():'';var u=v?safeUrl(v):'';
    if(v&&!u){i.focus();toastMsg('Lien invalide');return}
    if(vOpen)upd('voyages',vOpen,{link:u});bilPop=u?{edit:false}:{edit:true};renderSheet();if(u)toastMsg('Lien des billets enregistré')}
  function tplPanel(){
    if(tplEdit){var e=tplEdit;
      return '<div class="panel tform"><div class="pj-title">'+(e.id==='new'?'Nouvelle liste type':'Modifier la liste type')+'</div><div class="lab">Nom</div>'+
        iconField(e.emoji||'🧳','data-tpl="title"',e.title||'','Ex. Ski, week-end chez les parents…','data-act="tpl-emo"',TPLEMO,e.emoji)+
        '<div class="lab">Objets ('+e.items.length+')</div>'+(e.items.length?'<ul class="steps tpl-items">'+e.items.map(function(x,i){return '<li class="step"><span>'+esc(x)+'</span><button class="sx" data-act="tpl-rm" data-i="'+i+'" aria-label="Retirer : '+esc(x)+'" title="Retirer">×</button></li>'}).join('')+'</ul>':'<div class="sub">Pas encore d\'objet.</div>')+
        '<form class="stepform" data-form="tplitem"><input class="in" maxlength="80" data-tplinput required enterkeyhint="done" placeholder="Ajouter un objet" aria-label="Ajouter un objet"><button class="btn" type="submit">+</button></form>'+
        '<div class="prow"><button class="lnk" data-act="tpl-mgr">‹ Toutes les listes</button><button class="btn valid" data-act="tpl-save">Valider</button></div></div>'}
    var T=tpls();
    return '<div class="panel"><div class="pj-title">Listes types 🧳</div><div class="hint">Elles servent de modèle pour remplir la valise d\'un voyage.</div>'+
      (T.length?T.map(function(tp){return '<div class="trow"><button class="trow-m" data-act="tpl-edit" data-id="'+esc(tp.id)+'"><span>'+esc((tp.emoji||'🧳')+' '+tp.title)+'</span><small>'+(tp.items||[]).length+' objets ›</small></button><button class="sx" data-act="tpl-del" data-id="'+esc(tp.id)+'" aria-label="Supprimer la liste '+esc(tp.title)+'" title="Supprimer">×</button></div>'}).join(''):'<p class="empty">Aucune liste type.</p>')+
      '<div class="prow"><button class="btn" data-act="tpl-new">+ Nouvelle liste type</button></div></div>'}
  function tplSave(){var e=tplEdit;if(!e)return;var sp=splitEmoji(e.title||''),title=sp.title.trim();
    if(!title){var ti=document.querySelector('.sheet-card [data-tpl="title"]');if(ti)ti.focus();return}
    var data={title:title,emoji:sp.emoji||e.emoji||'🧳',items:e.items.map(function(x){return {t:x,done:false}})};
    if(e.id==='new'){data.trip='';data.type='valise';data.done=false;addDoc('voyages',data)}else upd('voyages',e.id,data);
    toastMsg('Liste type « '+title+' » enregistrée');tplEdit=null;tplMgr=true;renderSheet()}
  function toastMsg(m){var el=$('toast');if(!el)return;el.innerHTML='<span>'+esc(m)+'</span>';el.hidden=false;clearTimeout(toastT);toastT=setTimeout(hideToast,2200)}
  /* Gestion des clics de la partie Voyages. Renvoie true si le clic a été traité. */
  function vClick(a,b,id){var it,t;
    if(a==='trip-open'){if(id){vEmoOpen=false;vDelConfirm=false;vBilEdit=false;if(TAB!=='voyage')setTab('voyage');vview(id,true)}}
    else if(a==='trip-new'){if(V_OLD){toastMsg('Publie d\'abord la nouvelle version du script Google');return true}var nid=addDoc('voyages',{type:'voyage',trip:'',title:'Nouveau voyage',emoji:'🚆',start:'',end:'',done:false});
      vNew=nid;vEmoOpen=false;vDelConfirm=false;vBilEdit=false;setTab('voyage');vview(nid,true);
      setTimeout(function(){var ti=document.querySelector('#vv-body [data-trip="title"]');if(ti){ti.focus();ti.select()}},60)}
    else if(a==='trips-past'){showPast=!showPast;renderTrips()}
    else if(a==='vview-close'){vview(null,true)}
    else if(a==='trip-ok'){var tt=vOpen&&find('voyages',vOpen);if(tt){
        [].forEach.call(document.querySelectorAll('#vv-body [data-trip]'),function(inp){var f=inp.getAttribute('data-trip'),cur=f==='title'?tt.title:f==='startD'?dPart(tt.start):f==='startT'?hPart(tt.start):f==='endD'?dPart(tt.end):f==='endT'?hPart(tt.end):null;
          if(cur!==null&&inp.value!==cur){tt=find('voyages',vOpen);tripField(f,inp.value)}});
        vNew=null;toastMsg('Voyage « '+find('voyages',vOpen).title+' » créé');vview(null,true)}}
    else if(a==='bil-open'){if(vOpen){bilPop={edit:false};tEdit=null;tplMgr=false;tplEdit=null;renderSheet();var bi=document.querySelector('.sheet-card [data-bil]');if(bi)bi.focus()}}
    else if(a==='bil-edit'){if(bilPop){bilPop.edit=true;renderSheet();var bi2=document.querySelector('.sheet-card [data-bil]');if(bi2){bi2.focus();bi2.select()}}}
    else if(a==='bil-cancel'){if(bilPop){bilPop.edit=false;renderSheet()}}
    else if(a==='bil-save'){bilSave()}
    else if(a==='tpl-use'){applyTpl(id)}
    else if(a==='tpl-mgr'){seedTpls();tplMgr=true;tplEdit=null;iconOpen=false;tEdit=null;renderSheet()}
    else if(a==='tpl-new'){tplEdit={id:'new',emoji:'🧳',title:'',items:[]};iconOpen=false;renderSheet()}
    else if(a==='tpl-edit'){it=find('voyages',id);if(it){tplEdit={id:id,emoji:it.emoji||'🧳',title:it.title,items:(it.items||[]).map(function(x){return x.t})};iconOpen=false;renderSheet()}}
    else if(a==='tpl-from-pack'){t=vOpen&&packOf(vOpen);if(t){tplEdit={id:'new',emoji:'🧳',title:'',items:t.items.map(function(x){return x.t})};tplMgr=true;iconOpen=false;renderSheet();var tt=document.querySelector('.sheet-card [data-tpl="title"]');if(tt)tt.focus()}}
    else if(a==='tpl-emo'){if(tplEdit){tplEdit.emoji=b.getAttribute('data-e');iconOpen=false;renderSheet()}}
    else if(a==='tpl-rm'){if(tplEdit){tplEdit.items.splice(Number(b.getAttribute('data-i')),1);renderSheet()}}
    else if(a==='tpl-save'){tplSave()}
    else if(a==='tpl-del'){it=find('voyages',id);if(it){delUndo('voyages',id,'Liste « '+it.title+' » supprimée');renderSheet()}}
    else if(a==='trip-emo-tog'){vEmoOpen=!vEmoOpen;renderVView()}
    else if(a==='trip-emo'){vEmoOpen=false;if(vOpen)upd('voyages',vOpen,{emoji:b.getAttribute('data-e')})}
    else if(a==='pack-fold'){vPackOpen=!vPackOpen;if(vPackOpen)seedTpls();renderVView()}
    else if(a==='prog-fold'){vProgOpen=!vProgOpen;renderVView()}
    else if(a==='trip-del'){if(!vOpen)return true;if(!vDelConfirm){vDelConfirm=true;renderVView()}else tripDelete(vOpen)}
    else if(a==='v-add'){if(V_OLD){toastMsg('Publie d\'abord la nouvelle version du script Google');return true}if(vOpen)tOpen(b.getAttribute('data-v'),null,vOpen)}
    else if(a==='v-item'){it=find('voyages',id);if(it&&(it.type==='logement'||it.type==='activite'))tOpen(it.type,id)}
    else if(a==='v-done'){it=find('voyages',id);if(it)updUndo('voyages',id,{done:!it.done},it.done?'Remis à faire':'Activité faite ✓')}
    else if(a==='copy'){var v=b.getAttribute('data-v')||'';try{navigator.clipboard.writeText(v).then(function(){toastMsg('Référence copiée : '+v)},function(){toastMsg(v)})}catch(err){toastMsg(v)}}
    else if(a==='tf-set'){if(tEdit){var f=b.getAttribute('data-f'),val=b.getAttribute('data-v');if(f==='emoji'){tEdit.d[f]=val;if(f==='emoji')iconOpen=false;renderSheet()}}}
    else if(a==='tf-save'){tSave()}
    else if(a==='tf-del'){tDel()}
    else if(a==='undo-multi'){if(lastMulti){var l=lastMulti;lastMulti=null;hideToast();l.forEach(function(o){if(!find('voyages',o.id)){S.voyages.push(o);shWrite('voyages',o)}});render()}}
    else if(a==='pack-tog'||a==='pack-del'){t=vOpen&&packOf(vOpen);if(t){var items=t.items.map(function(x){return {t:x.t,done:!!x.done}}),i=Number(b.getAttribute('data-i'));
      if(items[i]){if(a==='pack-tog')items[i].done=!items[i].done;else items.splice(i,1);setPack(vOpen,items)}}}
    else if(a==='pack-reset'){t=vOpen&&packOf(vOpen);if(t)updUndo('voyages',t.id,{items:t.items.map(function(x){return {t:x.t,done:false}})},'Valise décochée')}
    else return false;
    return true}

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
  function hideBtn(id,on){return '<button class="evx" data-act="ev-hide" data-id="'+esc(id)+'" aria-label="'+(on?'Réafficher':'Masquer')+'" title="'+(on?'Réafficher':'Masquer')+'">'+(on?UNDO:'×')+'</button>'}
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
    var masc='';
    if(!m){el.innerHTML=masc+'<div class="mq-empty"><div>📌</div>Pas de quête principale<span>Ouvre une quête secondaire et épingle-la ici.</span></div>';return}
    var ss=m.steps||[],todo=[];ss.forEach(function(x,i){if(!x.done)todo.push(i)});
    var done=ss.length-todo.length,id=esc(m.id);
    var head='<div class="mq-top"><div><div class="mq-lab">📌 Quête principale</div><button class="mq-title" data-act="proj-open" data-id="'+id+'">'+(m.emoji?esc(m.emoji)+' ':'')+esc(m.title)+'</button></div></div>'+masc;
    if(!ss.length){el.innerHTML=head+'<div class="mq-step"><span class="circ" aria-hidden="true"></span><button class="mq-t" data-act="proj-open" data-id="'+id+'">Ajoute tes premières mini-quêtes</button></div>';return}
    if(!todo.length){el.innerHTML=head+'<div class="mq-bar">'+ss.map(function(){return '<i class="on"></i>'}).join('')+'</div><div class="mq-win"><b>🎉</b>Quête accomplie !<button class="btn" data-act="main-finish" data-id="'+id+'">Choisir la suivante</button></div>';return}
    var bar='<div class="mq-bar">'+ss.map(function(x){return '<i'+(x.done?' class="on"':'')+'></i>'}).join('')+'</div>';
    var chips='<div class="mq-chips"><span>'+done+'/'+ss.length+'</span><span>'+todo.length+' restante'+(todo.length>1?'s':'')+'</span></div>';
    var rows=todo.slice(0,2).map(function(i,k){
      return '<div class="mq-step'+(k?' small':'')+'"><button class="circ" data-act="ps" data-id="'+id+'" data-i="'+i+'" aria-label="Terminer : '+esc(ss[i].t)+'"></button><button class="mq-t" data-act="proj-open" data-id="'+id+'">'+esc(ss[i].t)+'</button></div>';
    }).join('');
    el.innerHTML=head+bar+chips+rows;
  }

  /* Mémoire locale : dernières données connues, affichées si le réseau manque */
  var cacheT=null,fromCache=false;
  function cacheNow(){if(fromCache||!KEY)return;clearTimeout(cacheT);lsSet(CK,JSON.stringify({t:Date.now(),S:S,P:PEOPLE,W:W,HID:HID,EVN:EVN,cal:(cal&&cal.status==='ok')?cal.events:null}))}
  window.addEventListener('pagehide',cacheNow);document.addEventListener('visibilitychange',function(){if(document.hidden)cacheNow()});
  function cacheSave(){
    if(fromCache||!KEY)return;clearTimeout(cacheT);
    cacheT=setTimeout(function(){lsSet(CK,JSON.stringify({t:Date.now(),S:S,P:PEOPLE,W:W,HID:HID,EVN:EVN,cal:(cal&&cal.status==='ok')?cal.events:null}))},600);
  }
  function cacheLoad(){
    try{
      var c=JSON.parse(lsGet(CK)||'null');if(!c||!c.S)return false;
      ['projects','routines','shop','courses','voyages'].forEach(function(k){S[k]=Array.isArray(c.S[k])?c.S[k]:[];loaded[k]=true});
      setPeople(c.P);W=c.W||null;HID=Array.isArray(c.HID)?c.HID:[];EVN=c.EVN||{};
      overlayOutbox(); /* modifs faites hors ligne et pas encore envoyées */
      if(Array.isArray(c.cal))cal={status:'ok',events:c.cal};
      fromCache=c.t;return true;
    }catch(e){return false}
  }
  function cacheNote(){
    var b=$('banner');if(!b)return;
    if(fromCache){var d=new Date(fromCache);b.innerHTML='<div class="note">Dernières données · '+esc(d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}))+'</div>'}
  }
  function render(){renderCare();renderTodoAll();renderTest();renderTodo();renderMain();renderShop();renderCourses();renderQView();renderTrips();renderTripNext();renderVView();renderSheet(true);cacheSave()}

  function clock(){var n=new Date();$('hello').textContent=n.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});$('today').textContent=n.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'})}
  clock();setInterval(clock,15000);

  document.addEventListener('mousedown',function(e){if(e.target.closest&&e.target.closest('[data-act="trip-ok"]'))e.preventDefault()});
  document.addEventListener('click',function(e){
    var ca=e.target.closest&&e.target.closest('a[data-close]');if(ca){setTimeout(function(){bilPop=null;renderSheet()},0);return}
    if(e.target.closest&&(e.target.closest('select.pr')||e.target.closest('a[href]')))return;
    var b=e.target.closest('[data-act]');if(!b)return;
    var a=b.getAttribute('data-act'),id=b.getAttribute('data-id'),it;
    if(a==='pset'){var f=b.getAttribute('data-f'),v=b.getAttribute('data-v');if((f==='prio'&&PRIO[v])||(f==='status'&&NEXT[v])){var o2={};o2[f]=v;if(f==='status'&&v==='done')updUndo('projects',id,o2,'Quête terminée');else upd('projects',id,o2)}}
    else if(a==='ps'){it=find('projects',id);if(it){var st=steps(it);var i=Number(b.getAttribute('data-i'));if(st[i]){st[i].done=!st[i].done;updUndo('projects',id,{steps:st},st[i].done?'Mini-quête validée ✓':'Mini-quête décochée')}}}
    else if(a==='proj-open'){iconOpen=false;projId=id;openId=null;confirmDel=null;renderSheet()}
    else if(a==='pmain'){it=find('projects',id);if(it){if(it.main){upd('projects',id,{main:false})}else{S.projects.forEach(function(q){if(q.main&&q.id!==id)upd('projects',q.id,{main:false})});upd('projects',id,{main:true})}projId=null;renderSheet()}}
    else if(a==='main-finish'){updUndo('projects',id,{main:false,status:'done'},'Quête accomplie 🎉')}
    else if(a==='ppick'){iconOpen=false;upd('projects',id,{emoji:b.getAttribute('data-e'),autoIcon:false});renderSheet()}
    else if(a==='icon-toggle'){iconOpen=!iconOpen;renderSheet()}
    else if(a==='pdel'){projId=null;confirmDel=null;renderSheet();delUndo('projects',id,'Quête supprimée')}
    else if(a==='undo-del'){restoreDel()}
    else if(a==='undo-upd'){undoUpd()}
    else if(a==='pick-emoji'){iconOpen=false;upd('routines',id,{emoji:b.getAttribute('data-e'),autoIcon:false});renderSheet()}
    else if(a==='care-open'){iconOpen=false;projId=null;openId=id;calFor=null;confirmDel=null;renderSheet()}
    else if(a==='proj-save'){var si2=document.querySelector('.sheet-card [data-stepinput]'),pv=si2&&si2.value.trim().slice(0,120),pq=find('projects',id);
      if(pv&&pq){upd('projects',id,{steps:steps(pq).concat([{t:pv,done:false}])})}
      projId=null;confirmDel=null;renderSheet()}
    else if(vClick(a,b,id)){}
    else if(a==='sheet-close'){iconOpen=false;tEdit=null;tplMgr=false;tplEdit=null;bilPop=null;evEdit=null;wishOpen=null;projId=null;openId=null;calFor=null;confirmDel=null;renderSheet()}
    else if(a==='care-add'){var cf=document.querySelector('form.care-add[data-group="'+b.getAttribute('data-group')+'"]');if(cf){cf.hidden=!cf.hidden;if(!cf.hidden)cf.querySelector('input').focus()}}
    else if(a==='care-chk'){careToggle(id)}
    else if(a==='ta-done'){var pv2=snap('routines',id,['lastDone','hasPrev','prevDone','prevForce','prevCustom','forceColor','customText']);setDate(id,iso(new Date()));offerUndo('routines',id,pv2,'Marqué comme fait ✓')}
    else if(a==='done-today'){var pv=snap('routines',id,['lastDone','hasPrev','prevDone','prevForce','prevCustom','forceColor','customText']);openId=null;calFor=null;setDate(id,iso(new Date()));renderSheet();offerUndo('routines',id,pv,'Marqué comme fait ✓')}
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
    else if(a==='tab'){setTab(b.getAttribute('data-tab'))}
    else if(a==='course-toggle'){var cf2=$('f-course');cf2.hidden=!cf2.hidden;if(!cf2.hidden)$('c-title').focus()}
    else if(a==='c-toggle'){it=find('courses',id);if(it)updUndo('courses',id,{done:!it.done},it.done?'Remis dans la liste':'Dans le panier ✓')}
    else if(a==='c-del'){delUndo('courses',id,'Article supprimé')}
    else if(a==='c-clear'){clearCart()}
    else if(a==='c-unclear'){unclearCart()}
    else if(a==='cview-open'){cview(true,true)}
    else if(a==='cview-close'){cview(false,true)}
    else if(a==='qview-open'){qview(true,true)}
    else if(a==='qview-close'){qview(false,true)}
    else if(a==='qdone-tog'){qShowDone=!qShowDone;renderQView()}
    else if(a==='qadd-toggle'){var qf=$('f-qadd');qf.hidden=!qf.hidden;if(!qf.hidden)$('q-title').focus()}
    else if(a==='add-toggle'){var fa=$('f-add');fa.hidden=!fa.hidden;if(!fa.hidden)$('a-title').focus()}
    else if(a==='sd'){it=find('projects',id);if(it){var i2=Number(b.getAttribute('data-i'));var st2=steps(it);st2.splice(i2,1);upd('projects',id,{steps:st2})}}
    else if(a==='cal-go'){load()}
    else if(a==='ev-edit'){var ee=cal.events.filter(function(q){return q.id===id})[0];if(ee){evEdit={id:id,orig:ee.summary||'Sans titre',v:EVN[id]||ee.summary||''};projId=null;openId=null;wishOpen=null;renderSheet()}}
    else if(a==='ev-save'){evSave(false)}
    else if(a==='ev-reset'){evSave(true)}
    else if(a==='ev-hide'){var hl=HID.slice(),hi=hl.indexOf(id);if(hi>=0)hl.splice(hi,1);else hl.push(id);setHid(hl)}
    else if(a==='done-tog'){showDone=!showDone;lsSet('maison-show-done',showDone?'1':'0');renderTodo()}
    else if(a==='cal-range'){calRange=b.getAttribute('data-v');lsSet('maison-cal-range',calRange);renderCal()}
    else if(a==='ev-toggle'){showHid=!showHid;renderCal()}
    else if(a==='logout'){if(confirm('Déconnecter cet appareil ? Le code d\'accès sera redemandé.'))logout('')}
  });

  /* Les boutons + deviennent − quand leur formulaire est ouvert */
  function syncPlus(){
    var pairs=[['[data-act="add-toggle"]','#f-add'],['[data-act="wishq-toggle"]','#f-wish'],['[data-act="course-toggle"]','#f-course'],['[data-act="qadd-toggle"]','#f-qadd']];
    GROUPS.forEach(function(g){pairs.push(['[data-act="care-add"][data-group="'+g+'"]','form.care-add[data-group="'+g+'"]'])});
    pairs.forEach(function(p){var b=document.querySelector(p[0]),f=document.querySelector(p[1]);if(!b||!f)return;var open=!f.hidden;
      b.setAttribute('aria-expanded',open);b.textContent=p[0].indexOf('qadd')>=0?(open?'− Fermer':'+ Nouvelle'):(open?'−':'+')});
  }
  document.addEventListener('click',function(){setTimeout(syncPlus,0)});
  document.addEventListener('submit',function(){setTimeout(syncPlus,0)});
  document.addEventListener('submit',function(e){
    var f=e.target;if(f.id==='login-form')return;e.preventDefault();
    if(f.classList&&f.classList.contains('care-add')){
      var ci=f.querySelector('input'),sp=splitEmoji(ci.value);
      if(!sp.title&&!sp.emoji)return;
      addDoc('routines',newCare(f.getAttribute('data-group'),sp));
      ci.value='';f.hidden=true;return;
    }
    if(f.id==='f-course'||f.id==='f-course2'||f.id==='f-course3'){
      var ci2=f.querySelector('input'),pc=parseCourse(ci2.value);if(!pc.title)return;
      var dup=S.courses.filter(function(c){return nrm(c.title)===nrm(pc.title)})[0];
      if(dup){upd('courses',dup.id,{done:false,qty:pc.qty||dup.qty})}else addDoc('courses',pc);
      ci2.value='';ci2.focus();return;
    }
    if(f.getAttribute('data-form')==='tplitem'){var ti2=f.querySelector('input'),tv2=ti2.value.trim().slice(0,80);if(!tv2||!tplEdit)return;
      tplEdit.items.push(tv2);renderSheet();var ti3=document.querySelector('.sheet-card [data-tplinput]');if(ti3)ti3.focus();return}
    if(f.getAttribute('data-form')==='pack'){
      var pi=f.querySelector('input'),pv=pi.value.trim().slice(0,80),pt=vOpen&&find('voyages',vOpen);if(!pv||!pt)return;
      var cur=(packOf(pt.id)||{items:[]}).items.map(function(x){return {t:x.t,done:!!x.done}});
      pi.value='';setPack(pt.id,cur.concat([{t:pv,done:false}]));
      var pi2=document.querySelector('#vv-body [data-packinput]');if(pi2)pi2.focus();return;
    }
    if(f.id==='f-qadd'){
      var qt=$('q-title'),sq0=splitEmoji(qt.value);if(!sq0.title&&!sq0.emoji)return;
      addDoc('projects',newProj(sq0));qt.value='';f.hidden=true;return;
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
    if(tplEdit&&e.target.getAttribute&&e.target.getAttribute('data-tpl')==='title'){tplEdit.title=e.target.value;return}
    var tf=e.target.getAttribute&&e.target.getAttribute('data-tf');if(tf&&tEdit){tEdit.d[tf]=e.target.value;return}
    var t=e.target,f=t.getAttribute&&t.getAttribute('data-wf');if(!f||!wishOpen)return;
    wd[f]=t.value;
    if(f==='title'){var a=$('wf-amz');if(a)a.href='https://www.amazon.fr/s?k='+encodeURIComponent(t.value)}
  });
  document.addEventListener('keydown',function(e){var t=e.target;if(e.key==='Enter'&&bilPop&&t&&t.hasAttribute&&t.hasAttribute('data-bil')){e.preventDefault();bilSave();return}if(e.key==='Enter'&&tEdit&&t&&t.tagName==='INPUT'&&t.hasAttribute('data-tf')){e.preventDefault();tEdit.d[t.getAttribute('data-tf')]=t.value;tSave();return}if(e.key==='Enter'&&evEdit&&t&&t.hasAttribute&&t.hasAttribute('data-evn')){e.preventDefault();evSave(false);return}if(e.key==='Enter'&&wishOpen&&t&&t.getAttribute&&t.getAttribute('data-wf')){e.preventDefault();wishSave()}});
  document.addEventListener('change',function(e){
    var t=e.target;
    var trf=t.getAttribute&&t.getAttribute('data-trip');if(trf){tripField(trf,t.value);return}
    if(t.hasAttribute&&t.hasAttribute('data-pack-copy')){var pcv=t.value;t.blur();packCopy(pcv);return}
    var tf2=t.getAttribute&&t.getAttribute('data-tf');if(tf2&&tEdit){tEdit.d[tf2]=t.value;return}
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
  function tick(){renderCare();renderTodoAll();renderSheet(true)}
  setInterval(tick,600000);
  document.addEventListener('visibilitychange',function(){if(!document.hidden){tick();load()}});
  document.addEventListener('keydown',function(e){
    var t=e.target;
    if(e.key==='Escape'&&(openId||projId||wishOpen||evEdit||tEdit||tplMgr||tplEdit||bilPop)){tEdit=null;tplMgr=false;tplEdit=null;bilPop=null;evEdit=null;wishOpen=null;projId=null;openId=null;calFor=null;confirmDel=null;renderSheet();return}
    if(e.key==='Escape'&&qOpen){qview(false,true);return}
    if(e.key==='Escape'&&cOpen){cview(false,true);return}
    if(e.key==='Escape'&&vOpen){vview(null,true);return}
    if((e.key==='Enter'||e.key===' ')&&t&&t.matches&&t.matches('[data-act="care-open"],[data-act="proj-open"],[data-act="ev-edit"],[data-act="v-item"]')){e.preventDefault();t.click()}
    else if(e.key==='Enter'&&t&&t.getAttribute&&(t.getAttribute('data-field')==='name'||t.getAttribute('data-trip')==='title')){t.blur()}
  });
  window.addEventListener('offline',syncNote);
  window.addEventListener('online',function(){retryMs=3000;syncNote();flush();load()});

  setTab(TAB);
  render();renderCal();
  if(location.hash==='#quetes')qview(true,false);
  if(location.hash==='#courses')cview(true,false);
  if(location.hash==='#voyage'){var lv=lsGet('maison-trip');if(lv){setTab('voyage');vview(lv,false)}else{try{history.replaceState(null,'',location.pathname+location.search)}catch(e){}}}
  if(!API||!KEY){showLogin('')}
  else{
    if(cacheLoad()){renderWeather();renderCal();render();cacheNote()}
    load();flush();startPolling();
  }
  if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('sw.js').catch(function(){})})}
})();
