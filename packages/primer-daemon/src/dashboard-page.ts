// Dashboard page — single self-contained HTML document
// No imports; returns a complete HTML string with inline CSS + JS

export function renderDashboardPage(): string {
  return HEAD + BODY_MARKUP + CLIENT_JS + TAIL
}

// --- Section 1: document head + CSS ---
const HEAD = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Primer Daemon</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#101014;--bg2:#18181e;--bg3:#222228;--bg4:#2c2c34;
  --fg:#c8c8d0;--fg2:#9898a4;--fg3:#68687a;
  --accent:#7a8cff;--accent2:#5a6ae0;
  --green:#4caf7c;--red:#cf5c5c;--amber:#d4a24c;
  --chip-bg:#28283a;--chip-fg:#b0b0c0;
  --radius:4px;--radius-lg:6px;
  --serif:"Georgia","Times New Roman",serif;
  --mono:"SF Mono","Menlo","Consolas",monospace;
  --sans:system-ui,-apple-system,"Segoe UI",sans-serif;
  --transition:120ms ease-out;
}
html{font-size:14px;background:var(--bg);color:var(--fg);font-family:var(--sans);line-height:1.55}
body{min-height:100vh}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
button{font:inherit;cursor:pointer;border:none;background:none;color:inherit}
input,textarea{font:inherit;color:inherit;background:var(--bg3);border:1px solid var(--bg4);border-radius:var(--radius);padding:6px 10px}
input:focus,textarea:focus{outline:none;border-color:var(--accent)}
/* layout */
.shell{max-width:1400px;margin:0 auto;padding:12px 16px}
.status-strip{display:flex;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid var(--bg3);margin-bottom:12px;flex-wrap:wrap}
.status-strip .logo{font-family:var(--serif);font-size:1.1rem;color:var(--fg);letter-spacing:.5px;margin-right:auto}
.status-chip{font-size:.75rem;padding:2px 8px;border-radius:var(--radius);background:var(--chip-bg);color:var(--chip-fg)}
.status-chip.ok{color:var(--green)}
.status-chip.stale{color:var(--amber)}
.status-chip.missing{color:var(--fg3)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:8px}
@media(max-width:1100px){.grid{grid-template-columns:1fr}}
/* panels */
.panel{background:var(--bg2);border:1px solid var(--bg3);border-radius:var(--radius-lg);padding:14px 16px;margin-bottom:16px}
.panel h2{font-size:.85rem;text-transform:uppercase;letter-spacing:.08em;color:var(--fg3);margin-bottom:10px;font-weight:600}
.empty{color:var(--fg3);font-style:italic;font-size:.85rem;padding:12px 0}
/* ask panel */
.ask-row{display:flex;gap:8px}
.ask-row input{flex:1}
.ask-btn{background:var(--accent2);color:#fff;padding:6px 16px;border-radius:var(--radius);font-size:.85rem;font-weight:500;transition:background var(--transition)}
.ask-btn:hover{background:var(--accent)}
.ask-btn:disabled{opacity:.5;cursor:default}
.ask-terms{font-size:.75rem;color:var(--fg3);margin-top:6px}
.ask-terms span{background:var(--chip-bg);padding:1px 6px;border-radius:var(--radius);margin-right:4px}
/* evidence hits */
.hit{padding:8px 0;border-bottom:1px solid var(--bg3)}
.hit:last-child{border-bottom:none}
.hit-head{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}
.hit-title{font-family:var(--serif);font-size:.9rem;color:var(--fg)}
.hit-title a{color:var(--fg)}
.hit-title a:hover{color:var(--accent)}
.chip{font-size:.7rem;padding:1px 6px;border-radius:var(--radius);background:var(--chip-bg);color:var(--chip-fg);white-space:nowrap}
.chip.browser{color:#6ec6ff}.chip.twitter{color:#7ecfa0}.chip.reader{color:#d4a24c}
.hit-ref{font-family:var(--mono);font-size:.7rem;color:var(--fg3)}
.hit-time{font-size:.7rem;color:var(--fg3);margin-left:auto}
.hit-snippet{font-size:.82rem;color:var(--fg2);margin-top:3px;line-height:1.5;font-family:var(--serif)}
.substrate-group{margin-top:10px}
.substrate-group h3{font-size:.78rem;color:var(--fg3);margin-bottom:4px;text-transform:capitalize}
.skipped{font-size:.75rem;color:var(--fg3);margin-top:8px}
/* cards */
.card{padding:10px 0;border-bottom:1px solid var(--bg3)}
.card:last-child{border-bottom:none}
.card-front{font-family:var(--serif);font-size:.9rem;color:var(--fg);font-weight:500}
.card-back{font-size:.82rem;color:var(--fg2);margin-top:4px;line-height:1.5;font-family:var(--serif)}
.card-meta{display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap}
.card-actions{display:flex;gap:4px;margin-left:auto}
.card-actions button{font-size:.72rem;padding:2px 10px;border-radius:var(--radius);border:1px solid var(--bg4);transition:all var(--transition)}
.card-actions .approve{color:var(--green);border-color:var(--green)}
.card-actions .approve:hover{background:var(--green);color:var(--bg)}
.card-actions .reject{color:var(--red);border-color:var(--red)}
.card-actions .reject:hover{background:var(--red);color:var(--bg)}
.card.muted{opacity:.45}
.card.muted .card-actions{display:none}
/* card groups */
.card-group-label{font-size:.72rem;color:var(--fg3);text-transform:uppercase;letter-spacing:.06em;margin-top:12px;margin-bottom:4px}
/* progress */
.prog{padding:6px 0;border-bottom:1px solid var(--bg3)}
.prog:last-child{border-bottom:none}
.prog-head{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}
.prog-title{font-size:.85rem;color:var(--fg)}
.prog-body{font-size:.8rem;color:var(--fg2);margin-top:2px}
.prog-refs{font-size:.72rem;color:var(--fg3);margin-top:2px}
.prog-refs code{font-family:var(--mono);background:var(--chip-bg);padding:0 4px;border-radius:2px}
.prog-time{font-size:.7rem;color:var(--fg3);margin-left:auto}
.chip.milestone{color:var(--green)}.chip.commit{color:var(--accent)}.chip.note{color:var(--amber)}.chip.proof{color:#d47ecf}.chip.info{color:var(--fg3)}
/* notes */
.note{padding:8px 0;border-bottom:1px solid var(--bg3)}
.note:last-child{border-bottom:none}
.note-q{font-family:var(--serif);font-size:.9rem;color:var(--fg);font-weight:500}
.note-body{font-size:.82rem;color:var(--fg2);margin-top:4px;line-height:1.5}
.note-sources{margin-top:4px;font-size:.75rem;color:var(--fg3)}
.note-sources a{color:var(--accent);font-size:.75rem}
/* proofs */
.proof-list-item{padding:4px 0;cursor:pointer;font-size:.85rem;color:var(--fg);transition:color var(--transition)}
.proof-list-item:hover{color:var(--accent)}
.proof-list-item .proof-time{font-size:.7rem;color:var(--fg3);margin-left:8px}
.proof-back{font-size:.78rem;color:var(--accent);cursor:pointer;margin-bottom:8px;display:inline-block}
.proof-back:hover{text-decoration:underline}
.proof-rendered{font-family:var(--serif);font-size:.88rem;line-height:1.65;color:var(--fg)}
.proof-rendered h1,.proof-rendered h2,.proof-rendered h3{font-family:var(--sans);color:var(--fg);margin:14px 0 6px}
.proof-rendered h1{font-size:1.1rem}.proof-rendered h2{font-size:.95rem}.proof-rendered h3{font-size:.85rem}
.proof-rendered code{font-family:var(--mono);background:var(--chip-bg);padding:1px 4px;border-radius:2px;font-size:.82rem}
.proof-rendered pre{background:var(--bg3);padding:10px;border-radius:var(--radius);overflow-x:auto;margin:8px 0}
.proof-rendered pre code{background:none;padding:0}
.proof-rendered ul,.proof-rendered ol{padding-left:20px;margin:4px 0}
.proof-rendered li{margin:2px 0}
.proof-rendered strong{color:var(--fg)}
.proof-rendered a{color:var(--accent)}
.proof-rendered blockquote{border-left:2px solid var(--bg4);padding-left:10px;color:var(--fg2);margin:6px 0}
/* error */
.fetch-err{font-size:.78rem;color:var(--red);padding:6px 0}
</style>
</head>
`

// --- Section 2: body markup (panels) ---
const BODY_MARKUP = /* html */ `
<body>
<div class="shell">
  <!-- Status strip -->
  <div class="status-strip">
    <span class="logo">Primer Daemon</span>
    <span id="status-area"></span>
  </div>

  <div class="grid">
    <!-- Left column: Ask + Proofs -->
    <div>
      <!-- Ask panel -->
      <div class="panel">
        <h2>Ask the Daemon</h2>
        <div class="ask-row">
          <input id="ask-input" type="text" placeholder="Ask a question\u2026" autocomplete="off">
          <button class="ask-btn" id="ask-btn">Ask</button>
        </div>
        <div id="ask-terms" class="ask-terms" hidden></div>
        <div id="ask-error" class="fetch-err" hidden></div>
        <div id="ask-results"></div>
        <div id="ask-empty" class="empty" hidden>Ask a question to search across all substrates.</div>
      </div>

      <!-- Proofs panel -->
      <div class="panel">
        <h2>Proofs</h2>
        <div id="proof-content">
          <div id="proof-list"></div>
          <div id="proof-empty" class="empty">No proof documents found.</div>
        </div>
        <div id="proof-detail" hidden>
          <span class="proof-back" id="proof-back">\u2190 back to list</span>
          <div id="proof-rendered" class="proof-rendered"></div>
        </div>
        <div id="proof-error" class="fetch-err" hidden></div>
      </div>
    </div>

    <!-- Right column: Progress + Cards + Notes -->
    <div>
      <!-- Progress panel -->
      <div class="panel">
        <h2>Progress</h2>
        <div id="progress-list"></div>
        <div id="progress-empty" class="empty">No progress entries yet.</div>
        <div id="progress-error" class="fetch-err" hidden></div>
      </div>

      <!-- Cards panel -->
      <div class="panel">
        <h2>Card Candidates</h2>
        <div id="cards-list"></div>
        <div id="cards-empty" class="empty">No card candidates yet.</div>
        <div id="cards-error" class="fetch-err" hidden></div>
      </div>

      <!-- Notes panel -->
      <div class="panel">
        <h2>Notes</h2>
        <div id="notes-list"></div>
        <div id="notes-empty" class="empty">No notes recorded yet.</div>
        <div id="notes-error" class="fetch-err" hidden></div>
      </div>
    </div>
  </div>
</div>
`

// --- Section 3: client JS (utilities, ask, proofs) ---
const CLIENT_JS = /* html */ `
<script>
// -- Utilities --
function esc(s){if(s==null)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function $(id){return document.getElementById(id)}
function relTime(iso){
  if(!iso)return'';
  var d=new Date(iso+(iso.indexOf('Z')<0&&iso.indexOf('+')< 0?'Z':''));
  var s=Math.round((Date.now()-d.getTime())/1000);
  if(s<60)return'just now';
  if(s<3600)return Math.floor(s/60)+'m ago';
  if(s<86400)return Math.floor(s/3600)+'h ago';
  return Math.floor(s/86400)+'d ago';
}
function chipHtml(label,cls){return '<span class="chip'+(cls?' '+esc(cls):'')+'">' +esc(label)+'</span>'}

// Mini markdown renderer (~40 lines)
function renderMd(src){
  var lines=src.split('\\n'),out=[],inCode=false,codeLines=[];
  for(var i=0;i<lines.length;i++){
    var l=lines[i];
    if(l.startsWith('\`\`\`')){
      if(inCode){out.push('<pre><code>'+esc(codeLines.join('\\n'))+'</code></pre>');codeLines=[];inCode=false}
      else{inCode=true}
      continue;
    }
    if(inCode){codeLines.push(l);continue}
    if(/^### /.test(l)){out.push('<h3>'+inline(l.slice(4))+'</h3>');continue}
    if(/^## /.test(l)){out.push('<h2>'+inline(l.slice(3))+'</h2>');continue}
    if(/^# /.test(l)){out.push('<h1>'+inline(l.slice(2))+'</h1>');continue}
    if(/^> /.test(l)){out.push('<blockquote>'+inline(l.slice(2))+'</blockquote>');continue}
    if(/^[-*] /.test(l)){out.push('<ul><li>'+inline(l.slice(2))+'</li></ul>');continue}
    if(/^\\d+\\. /.test(l)){out.push('<ol><li>'+inline(l.replace(/^\\d+\\.\\s/,''))+'</li></ol>');continue}
    if(l.trim()===''){out.push('<br>');continue}
    out.push('<p>'+inline(l)+'</p>');
  }
  if(inCode&&codeLines.length)out.push('<pre><code>'+esc(codeLines.join('\\n'))+'</code></pre>');
  // merge adjacent ul/ol
  return out.join('\\n').replace(/<\\/ul>\\n<ul>/g,'\\n').replace(/<\\/ol>\\n<ol>/g,'\\n');
}
function inline(s){
  s=esc(s);
  s=s.replace(/\`([^\`]+)\`/g,'<code>$1</code>');
  s=s.replace(/\\*\\*(.+?)\\*\\*/g,'<strong>$1</strong>');
  s=s.replace(/\\*(.+?)\\*/g,'<em>$1</em>');
  s=s.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g,'<a href="$2" target="_blank">$1</a>');
  return s;
}

// -- Ask panel --
var askInput=$('ask-input'),askBtn=$('ask-btn');
function doAsk(){
  var q=askInput.value.trim();
  if(!q)return;
  askBtn.disabled=true;
  $('ask-error').hidden=true;
  $('ask-empty').hidden=true;
  $('ask-results').innerHTML='<span class="empty">Searching\u2026</span>';
  fetch('/api/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:q})})
    .then(function(r){if(!r.ok)throw new Error(r.status+' '+r.statusText);return r.json()})
    .then(function(d){
      askBtn.disabled=false;
      // show terms
      var termsEl=$('ask-terms');
      if(d.terms&&d.terms.length){
        termsEl.innerHTML='Terms: '+d.terms.map(function(t){return '<span>'+esc(t)+'</span>'}).join('');
        termsEl.hidden=false;
      }else{termsEl.hidden=true}
      // group hits by substrate
      var groups={};
      (d.hits||[]).forEach(function(h){(groups[h.source]=groups[h.source]||[]).push(h)});
      if(!d.hits||!d.hits.length){$('ask-results').innerHTML='<div class="empty">No evidence found.</div>';return}
      var html='';
      Object.keys(groups).forEach(function(src){
        html+='<div class="substrate-group"><h3>'+esc(src)+'</h3>';
        groups[src].forEach(function(h){
          html+='<div class="hit"><div class="hit-head">';
          html+='<span class="hit-title">'+(h.url?'<a href="'+esc(h.url)+'" target="_blank">'+esc(h.title)+'</a>':esc(h.title))+'</span>';
          html+=chipHtml(h.source+'/'+h.kind,h.source);
          html+='<span class="hit-ref">'+esc(h.ref)+'</span>';
          html+='<span class="hit-time">'+relTime(h.timestamp)+'</span>';
          html+='</div>';
          if(h.snippet)html+='<div class="hit-snippet">'+esc(h.snippet)+'</div>';
          html+='</div>';
        });
        html+='</div>';
      });
      if(d.skipped&&d.skipped.length){
        html+='<div class="skipped">Skipped: '+d.skipped.map(function(s){return esc(s)}).join(', ')+'</div>';
      }
      $('ask-results').innerHTML=html;
    })
    .catch(function(e){askBtn.disabled=false;$('ask-error').textContent=e.message;$('ask-error').hidden=false;$('ask-results').innerHTML=''})
}
askBtn.addEventListener('click',doAsk);
askInput.addEventListener('keydown',function(e){if(e.key==='Enter')doAsk()});
$('ask-empty').hidden=false;

// -- Proofs panel --
var proofNames=[];
function loadProofs(){
  fetch('/api/proofs').then(function(r){if(!r.ok)throw new Error('proofs: '+r.status);return r.json()})
    .then(function(list){
      proofNames=list.map(function(p){return p.name});
      if(!list.length){$('proof-empty').hidden=false;$('proof-list').innerHTML='';return}
      $('proof-empty').hidden=true;
      $('proof-list').innerHTML=list.map(function(p){
        return '<div class="proof-list-item" data-name="'+esc(p.name)+'">'+esc(p.title||p.name)+'<span class="proof-time">'+relTime(p.mtime)+'</span></div>';
      }).join('');
    })
    .catch(function(e){$('proof-error').textContent=e.message;$('proof-error').hidden=false})
}
$('proof-list').addEventListener('click',function(e){
  var el=e.target.closest('.proof-list-item');
  if(!el)return;
  var name=el.dataset.name;
  // allowlist: only fetch if name is in the loaded list
  if(proofNames.indexOf(name)<0)return;
  $('proof-error').hidden=true;
  fetch('/api/proofs/'+encodeURIComponent(name))
    .then(function(r){if(!r.ok)throw new Error(r.status+'');return r.json()})
    .then(function(d){
      $('proof-content').hidden=true;
      $('proof-detail').hidden=false;
      $('proof-rendered').innerHTML=renderMd(d.markdown||'');
    })
    .catch(function(e){$('proof-error').textContent=e.message;$('proof-error').hidden=false})
});
$('proof-back').addEventListener('click',function(){
  $('proof-detail').hidden=true;$('proof-content').hidden=false;
});
loadProofs();
</script>
`

// --- Section 4: client JS (progress, cards, notes, status, pollers) ---
const TAIL = /* html */ `
<script>
// -- Progress feed --
var lastProgressCount=-1;
function loadProgress(){
  fetch('/api/progress?limit=100').then(function(r){if(!r.ok)throw new Error(r.status+'');return r.json()})
    .then(function(rows){
      $('progress-error').hidden=true;
      if(!rows.length){$('progress-empty').hidden=false;$('progress-list').innerHTML='';return}
      $('progress-empty').hidden=true;
      if(rows.length===lastProgressCount)return;
      lastProgressCount=rows.length;
      $('progress-list').innerHTML=rows.map(function(p){
        var refs='';
        if(p.refs&&p.refs.length)refs='<div class="prog-refs">'+p.refs.map(function(r){return '<code>'+esc(r)+'</code>'}).join(' ')+'</div>';
        return '<div class="prog"><div class="prog-head">'+chipHtml(p.kind,p.kind)+'<span class="prog-title">'+esc(p.title)+'</span><span class="prog-time">'+relTime(p.createdAt)+'</span></div>'
          +(p.body?'<div class="prog-body">'+esc(p.body)+'</div>':'')
          +refs+'</div>';
      }).join('');
    })
    .catch(function(e){$('progress-error').textContent=e.message;$('progress-error').hidden=false})
}

// -- Cards --
var cardsData=[];
function loadCards(){
  fetch('/api/cards?limit=100').then(function(r){if(!r.ok)throw new Error(r.status+'');return r.json()})
    .then(function(rows){
      $('cards-error').hidden=true;
      cardsData=rows;
      renderCards();
    })
    .catch(function(e){$('cards-error').textContent=e.message;$('cards-error').hidden=false})
}
function renderCards(){
  var candidates=cardsData.filter(function(c){return c.status==='candidate'});
  var approved=cardsData.filter(function(c){return c.status==='approved'});
  var rejected=cardsData.filter(function(c){return c.status==='rejected'});
  if(!cardsData.length){$('cards-empty').hidden=false;$('cards-list').innerHTML='';return}
  $('cards-empty').hidden=true;
  var html='';
  function cardHtml(c,muted){
    var cls='card'+(muted?' muted':'');
    html+='<div class="'+cls+'" data-id="'+c.id+'">';
    html+='<div class="card-front">'+esc(c.front)+'</div>';
    html+='<div class="card-back">'+esc(c.back)+'</div>';
    html+='<div class="card-meta">';
    html+=chipHtml(c.status,c.status==='approved'?'ok':c.status==='rejected'?'':'');
    if(c.sourceRef)html+='<span class="hit-ref">'+esc(c.sourceRef)+'</span>';
    if(c.url)html+='<a href="'+esc(c.url)+'" target="_blank" style="font-size:.72rem">source</a>';
    html+='<span class="hit-time">'+relTime(c.createdAt)+'</span>';
    html+='<div class="card-actions">';
    html+='<button class="approve" data-id="'+c.id+'">Approve</button>';
    html+='<button class="reject" data-id="'+c.id+'">Reject</button>';
    html+='</div></div></div>';
  }
  candidates.forEach(function(c){cardHtml(c,false)});
  if(approved.length){html+='<div class="card-group-label">Approved</div>';approved.forEach(function(c){cardHtml(c,true)})}
  if(rejected.length){html+='<div class="card-group-label">Rejected</div>';rejected.forEach(function(c){cardHtml(c,true)})}
  $('cards-list').innerHTML=html;
}
function setCardStatus(id,status){
  // optimistic update
  cardsData.forEach(function(c){if(c.id===id)c.status=status});
  renderCards();
  fetch('/api/cards/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id,status:status})})
    .then(function(r){if(!r.ok)throw new Error(r.status+'');return r.json()})
    .then(function(updated){
      cardsData=cardsData.map(function(c){return c.id===updated.id?updated:c});
      renderCards();
    })
    .catch(function(e){$('cards-error').textContent=e.message;$('cards-error').hidden=false;loadCards()})
}
$('cards-list').addEventListener('click',function(e){
  var btn=e.target.closest('button');
  if(!btn)return;
  var id=parseInt(btn.dataset.id,10);
  if(btn.classList.contains('approve'))setCardStatus(id,'approved');
  else if(btn.classList.contains('reject'))setCardStatus(id,'rejected');
});

// -- Notes --
function loadNotes(){
  fetch('/api/notes?limit=50').then(function(r){if(!r.ok)throw new Error(r.status+'');return r.json()})
    .then(function(rows){
      $('notes-error').hidden=true;
      if(!rows.length){$('notes-empty').hidden=false;$('notes-list').innerHTML='';return}
      $('notes-empty').hidden=true;
      $('notes-list').innerHTML=rows.map(function(n){
        var srcHtml='';
        if(n.sources&&n.sources.length){
          srcHtml='<div class="note-sources">'+n.sources.map(function(s){
            var label=s.title||s.ref;
            return s.url?'<a href="'+esc(s.url)+'" target="_blank">'+esc(label)+'</a>':'<span>'+esc(label)+'</span>';
          }).join(' \u00b7 ')+'</div>';
        }
        return '<div class="note"><div class="note-q">'+esc(n.question)+'</div>'
          +'<div class="note-body">'+esc(n.body)+'</div>'+srcHtml+'</div>';
      }).join('');
    })
    .catch(function(e){$('notes-error').textContent=e.message;$('notes-error').hidden=false})
}

// -- Status strip --
function loadStatus(){
  fetch('/api/status').then(function(r){if(!r.ok)throw new Error(r.status+'');return r.json()})
    .then(function(d){
      var html='';
      (d.substrates||[]).forEach(function(s){
        var cls='status-chip';
        if(!s.exists)cls+=' missing';
        else if(s.mtime){
          var age=(Date.now()-new Date(s.mtime+(s.mtime.indexOf('Z')<0?'Z':'')).getTime())/1000;
          cls+=age<3600?' ok':' stale';
        }else{cls+=' missing'}
        html+='<span class="'+cls+'">'+esc(s.name)+(s.mtime?' \u00b7 '+relTime(s.mtime):'')+'</span>';
      });
      if(d.ledger){
        html+='<span class="status-chip">'+d.ledger.notes+'n \u00b7 '+d.ledger.cards+'c \u00b7 '+d.ledger.progress+'p</span>';
      }
      $('status-area').innerHTML=html;
    })
    .catch(function(){})
}

// -- Initial load + pollers --
loadProgress();loadCards();loadNotes();loadStatus();
setInterval(function(){loadProgress();loadCards()},3000);
setInterval(loadStatus,30000);
</script>
</body>
</html>
`
