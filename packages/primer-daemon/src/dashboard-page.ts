// Dashboard page — self-contained HTML document
// No imports; returns a complete HTML string with inline CSS and vanilla JS

export function renderDashboardPage(): string {
  return HEAD + BODY_MARKUP + SCRIPT_CORE + SCRIPT_PANELS + TAIL
}

const HEAD = /* html */ `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Primer Daemon</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#101014;--bg2:#18181e;--bg3:#222228;--bg4:#2c2c34;--fg:#c8c8d0;--fg2:#9898a4;--fg3:#68687a;--accent:#7a8cff;--accent2:#5a6ae0;--green:#4caf7c;--red:#cf5c5c;--amber:#d4a24c;--chip-bg:#28283a;--chip-fg:#b0b0c0;--radius:4px;--radius-lg:6px;--serif:"Georgia","Times New Roman",serif;--mono:"SF Mono","Menlo","Consolas",monospace;--sans:system-ui,-apple-system,"Segoe UI",sans-serif;--transition:120ms ease-out}
html{font-size:14px;background:var(--bg);color:var(--fg);font-family:var(--sans);line-height:1.55}
body{min-height:100vh}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
button{font:inherit;cursor:pointer;border:none;background:none;color:inherit}
input,textarea{font:inherit;color:inherit;background:var(--bg3);border:1px solid var(--bg4);border-radius:var(--radius);padding:6px 10px}
input:focus,textarea:focus{outline:none;border-color:var(--accent)}
.shell{max-width:1400px;margin:0 auto;padding:8px 12px}
.hdr{display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--bg3);margin-bottom:3px;flex-wrap:wrap}
.hdr-title{font-family:var(--serif);font-size:1rem;color:var(--fg);letter-spacing:.3px;white-space:nowrap}
.hdr-keys{font-size:.67rem;color:var(--fg3);cursor:pointer;padding:2px 6px;border-radius:var(--radius);background:var(--bg3)}
.hdr-keys:hover{color:var(--accent)}
#status-area{display:flex;gap:5px;flex-wrap:wrap;margin-left:auto}
.hdr-desc{font-size:.74rem;color:var(--fg3);line-height:1.4;padding:2px 0 8px}
.panels{display:flex;flex-direction:column;gap:10px}
#p-ask{order:1}#p-progress{order:2}#p-cards{order:3}#p-proofs{order:4}#p-notes{order:5}
@media(min-width:1200px){
.panels{display:grid;grid-template-columns:1fr 1fr;grid-auto-flow:dense;gap:14px}
#p-ask,#p-proofs{grid-column:1}#p-progress,#p-cards,#p-notes{grid-column:2}
.shell{padding:12px 16px}
}
.panel{background:var(--bg2);border:1px solid var(--bg3);border-radius:var(--radius-lg);padding:10px 12px}
.panel h2{font-size:.76rem;text-transform:uppercase;letter-spacing:.08em;color:var(--fg3);margin-bottom:2px;font-weight:600}
.panel-cap{font-size:.69rem;color:var(--fg3);margin-bottom:8px;line-height:1.4}
.panel.vim-active{border-color:var(--accent2)}
.empty{color:var(--fg3);font-size:.76rem;padding:6px 0;line-height:1.5}
.status-chip{font-size:.69rem;padding:2px 6px;border-radius:var(--radius);background:var(--chip-bg);color:var(--chip-fg)}
.status-chip.ok{color:var(--green)}.status-chip.stale{color:var(--amber)}.status-chip.missing{color:var(--fg3)}
.chip{font-size:.66rem;padding:1px 5px;border-radius:var(--radius);background:var(--chip-bg);color:var(--chip-fg);white-space:nowrap}
.chip.browser{color:#6ec6ff}.chip.twitter{color:#7ecfa0}.chip.reader{color:var(--amber)}.chip.model{color:var(--accent)}
.ask-examples{display:flex;gap:5px;flex-wrap:wrap;padding:6px 0}
.example-chip{font-size:.74rem;padding:4px 9px;border-radius:var(--radius);background:var(--bg3);color:var(--fg2);cursor:pointer;border:1px solid var(--bg4);transition:all var(--transition);text-align:left;line-height:1.35}
.example-chip:hover{border-color:var(--accent);color:var(--fg)}
.ask-row{display:flex;gap:6px;align-items:center}
.ask-row input{flex:1;font-size:.82rem}
.ask-btn{background:var(--accent2);color:#fff;padding:5px 12px;border-radius:var(--radius);font-size:.76rem;font-weight:500;transition:background var(--transition)}
.ask-btn:hover{background:var(--accent)}.ask-btn:disabled{opacity:.5;cursor:default}
.ask-model{font-size:.66rem;color:var(--fg3);margin-top:3px}
.thread{display:flex;flex-direction:column;gap:8px;margin-bottom:8px}
.thread:empty{display:none}
.t-q{display:flex;justify-content:flex-end}
.t-q-bubble{background:var(--bg3);color:var(--fg2);padding:5px 10px;border-radius:var(--radius-lg) var(--radius-lg) var(--radius) var(--radius-lg);font-size:.82rem;max-width:85%;font-family:var(--serif)}
.t-a{padding:4px 0}
.t-a-text{font-family:var(--serif);font-size:.84rem;color:var(--fg);line-height:1.6}
.t-a-text .ref-chip{font-size:.62rem;padding:0 4px;border-radius:2px;background:var(--chip-bg);color:var(--accent);cursor:pointer;vertical-align:super;margin:0 1px}
.t-a-meta{display:flex;gap:6px;align-items:center;margin-top:3px;flex-wrap:wrap}
.t-a-elapsed{font-size:.66rem;color:var(--fg3)}
.t-retrieval{font-size:.76rem;color:var(--fg3);padding:3px 0;font-style:italic}
.t-a-error{font-size:.69rem;color:var(--fg3);margin-top:2px}
.t-searching{font-size:.76rem;color:var(--fg3);padding:4px 0;font-style:italic}
.evidence-wrap{margin-top:5px}
.evidence-wrap summary{font-size:.71rem;color:var(--fg3);cursor:pointer;padding:2px 0;user-select:none;list-style:none}
.evidence-wrap summary::-webkit-details-marker{display:none}
.evidence-wrap summary::before{content:'\\25B8 ';font-size:.58rem}
.evidence-wrap[open] summary::before{content:'\\25BE '}
.evidence-wrap summary:hover{color:var(--fg2)}
.evidence-wrap[open] summary{margin-bottom:3px}
.hit{padding:5px 0;border-bottom:1px solid var(--bg3)}.hit:last-child{border-bottom:none}
.hit-head{display:flex;align-items:baseline;gap:4px;flex-wrap:wrap}
.hit-title{font-family:var(--serif);font-size:.82rem;color:var(--fg)}
.hit-title a{color:var(--fg)}.hit-title a:hover{color:var(--accent)}
.hit-ref{font-family:var(--mono);font-size:.65rem;color:var(--fg3)}
.hit-time{font-size:.65rem;color:var(--fg3);margin-left:auto}
.hit-snippet{font-size:.76rem;color:var(--fg2);margin-top:2px;line-height:1.4;font-family:var(--serif)}
.substrate-group{margin-top:6px}
.substrate-group h3{font-size:.71rem;color:var(--fg3);margin-bottom:2px;text-transform:capitalize}
.skipped{font-size:.69rem;color:var(--fg3);margin-top:5px}
.card{padding:7px 0;border-bottom:1px solid var(--bg3)}.card:last-child{border-bottom:none}
.card-front{font-family:var(--serif);font-size:.84rem;color:var(--fg);font-weight:500}
.card-back{font-size:.78rem;color:var(--fg2);margin-top:3px;line-height:1.4;font-family:var(--serif)}
.card-meta{display:flex;align-items:center;gap:5px;margin-top:4px;flex-wrap:wrap}
.card-actions{display:flex;gap:4px;margin-left:auto}
.card-actions button{font-size:.67rem;padding:2px 8px;border-radius:var(--radius);border:1px solid var(--bg4);transition:all var(--transition)}
.card-actions .approve{color:var(--green);border-color:var(--green)}
.card-actions .approve:hover{background:var(--green);color:var(--bg)}
.card-actions .reject{color:var(--red);border-color:var(--red)}
.card-actions .reject:hover{background:var(--red);color:var(--bg)}
.card.muted{opacity:.45}.card.muted .card-actions{display:none}
.card-group-label{font-size:.67rem;color:var(--fg3);text-transform:uppercase;letter-spacing:.06em;margin-top:10px;margin-bottom:2px}
.prog{padding:5px 0;border-bottom:1px solid var(--bg3)}.prog:last-child{border-bottom:none}
.prog-head{display:flex;align-items:baseline;gap:5px;flex-wrap:wrap}
.prog-title{font-size:.82rem;color:var(--fg)}
.prog-body{font-size:.76rem;color:var(--fg2);margin-top:2px}
.prog-refs{font-size:.67rem;color:var(--fg3);margin-top:2px}
.prog-refs code{font-family:var(--mono);background:var(--chip-bg);padding:0 3px;border-radius:2px}
.prog-time{font-size:.65rem;color:var(--fg3);margin-left:auto}
.chip.milestone{color:var(--green)}.chip.commit{color:var(--accent)}.chip.note{color:var(--amber)}.chip.proof{color:#d47ecf}.chip.info{color:var(--fg3)}
.note{padding:6px 0;border-bottom:1px solid var(--bg3)}.note:last-child{border-bottom:none}
.note-q{font-family:var(--serif);font-size:.84rem;color:var(--fg);font-weight:500}
.note-body{font-size:.78rem;color:var(--fg2);margin-top:3px;line-height:1.4}
.note-sources{margin-top:3px;font-size:.69rem;color:var(--fg3)}
.note-sources a{color:var(--accent);font-size:.69rem}
.proof-list-item{padding:4px 0;cursor:pointer;font-size:.82rem;color:var(--fg);transition:color var(--transition)}
.proof-list-item:hover{color:var(--accent)}
.proof-list-item .proof-time{font-size:.65rem;color:var(--fg3);margin-left:6px}
.proof-back{font-size:.72rem;color:var(--accent);cursor:pointer;margin-bottom:6px;display:inline-block}
.proof-back:hover{text-decoration:underline}
.proof-rendered{font-family:var(--serif);font-size:.84rem;line-height:1.6;color:var(--fg)}
.proof-rendered h1,.proof-rendered h2,.proof-rendered h3{font-family:var(--sans);color:var(--fg);margin:12px 0 4px}
.proof-rendered h1{font-size:1.05rem}.proof-rendered h2{font-size:.9rem}.proof-rendered h3{font-size:.8rem}
.proof-rendered code{font-family:var(--mono);background:var(--chip-bg);padding:1px 3px;border-radius:2px;font-size:.78rem}
.proof-rendered pre{background:var(--bg3);padding:8px;border-radius:var(--radius);overflow-x:auto;margin:6px 0}
.proof-rendered pre code{background:none;padding:0}
.proof-rendered ul,.proof-rendered ol{padding-left:18px;margin:4px 0}
.proof-rendered li{margin:2px 0}
.proof-rendered strong{color:var(--fg)}
.proof-rendered a{color:var(--accent)}
.proof-rendered blockquote{border-left:2px solid var(--bg4);padding-left:8px;color:var(--fg2);margin:5px 0}
@media(max-width:1199px){#proof-detail:not([hidden]){position:fixed;inset:0;background:var(--bg);z-index:100;overflow-y:auto;padding:12px 16px}}
.vim-focus{outline:1px solid var(--accent);outline-offset:1px;border-radius:var(--radius)}
.fetch-err{font-size:.72rem;color:var(--red);padding:4px 0}
.keymap-overlay{display:none;position:fixed;inset:0;z-index:200;background:rgba(16,16,20,.92)}
.keymap-overlay.open{display:flex;align-items:center;justify-content:center}
.km-box{background:var(--bg2);border:1px solid var(--bg3);border-radius:var(--radius-lg);padding:14px 18px;max-width:340px;width:90%}
.km-box h3{font-size:.82rem;color:var(--fg);margin-bottom:8px;font-weight:600}
.km-row{display:flex;justify-content:space-between;padding:2px 0;font-size:.74rem}
.km-row kbd{font-family:var(--mono);font-size:.69rem;color:var(--accent);background:var(--bg3);padding:1px 5px;border-radius:2px;border:none}
.km-row span{color:var(--fg2)}
</style></head>
`

const BODY_MARKUP = /* html */ `
<body>
<div class="shell">
  <div class="hdr">
    <span class="hdr-title">Primer Daemon</span>
    <span class="hdr-keys" id="keys-hint" title="Keyboard shortcuts">? keys</span>
    <span id="status-area"></span>
  </div>
  <div class="hdr-desc">Local reading d\u00E6mon: searches your browser history, tweets, and reading annotations, and answers with sources. Agents post finished work here for review.</div>

  <div class="panels">
    <div class="panel" id="p-ask">
      <h2>Ask the D\u00E6mon</h2>
      <div class="panel-cap">Natural-language questions answered from your local data &mdash; every query searches all three substrates.</div>
      <div class="ask-examples" id="ask-examples"></div>
      <div class="ask-row">
        <input id="ask-input" type="text" placeholder="what have I been reading about \u2026?" autocomplete="off">
        <button class="ask-btn" id="ask-btn">Ask</button>
      </div>
      <div class="ask-model" id="model-indicator"></div>
      <div id="ask-error" class="fetch-err" hidden></div>
      <div class="thread" id="ask-thread"></div>
      <div id="ask-empty" class="empty">Ask a question above to search your browser history, tweets, and reading annotations. The d\u00E6mon will gather evidence and synthesize an answer.</div>
    </div>

    <div class="panel" id="p-progress">
      <h2>Progress</h2>
      <div class="panel-cap">Agent activity feed &mdash; milestones, commits, notes, and proofs as they happen.</div>
      <div id="progress-list"></div>
      <div id="progress-empty" class="empty">No progress entries yet. Updates appear as agents run tasks and record milestones.</div>
      <div id="progress-error" class="fetch-err" hidden></div>
    </div>

    <div class="panel" id="p-cards">
      <h2>Cards</h2>
      <div class="panel-cap">Flashcard candidates proposed by agents &mdash; approve or reject; approved cards get exported to your SRS.</div>
      <div id="cards-list"></div>
      <div id="cards-empty" class="empty">No card candidates yet. Agents propose flashcards based on what you read; review and approve them here.</div>
      <div id="cards-error" class="fetch-err" hidden></div>
    </div>

    <div class="panel" id="p-proofs">
      <h2>Proofs</h2>
      <div class="panel-cap">Review contracts for finished primer tasks &mdash; read these instead of the code.</div>
      <div id="proof-content">
        <div id="proof-list"></div>
        <div id="proof-empty" class="empty">No proof documents yet. Agents write proof documents when they finish tasks &mdash; they appear here for review.</div>
      </div>
      <div id="proof-detail" hidden>
        <span class="proof-back" id="proof-back">\u2190 back to list</span>
        <div id="proof-rendered" class="proof-rendered"></div>
      </div>
      <div id="proof-error" class="fetch-err" hidden></div>
    </div>

    <div class="panel" id="p-notes">
      <h2>Notes</h2>
      <div class="panel-cap">Persistent Q&amp;A notes recorded by agents &mdash; searchable reference material.</div>
      <div id="notes-list"></div>
      <div id="notes-empty" class="empty">No notes yet. Agents write notes to capture research synthesis for future reference.</div>
      <div id="notes-error" class="fetch-err" hidden></div>
    </div>
  </div>

  <div class="keymap-overlay" id="keymap-overlay">
    <div class="km-box">
      <h3>Keyboard shortcuts</h3>
      <div class="km-row"><kbd>j</kbd> <kbd>k</kbd><span>move focus down / up</span></div>
      <div class="km-row"><kbd>[</kbd> <kbd>]</kbd><span>cycle panels</span></div>
      <div class="km-row"><kbd>h</kbd> <kbd>l</kbd><span>cycle panels (when not typing)</span></div>
      <div class="km-row"><kbd>Enter</kbd><span>activate focused item</span></div>
      <div class="km-row"><kbd>a</kbd> <kbd>r</kbd><span>approve / reject card</span></div>
      <div class="km-row"><kbd>g</kbd> <kbd>G</kbd><span>first / last item</span></div>
      <div class="km-row"><kbd>Esc</kbd> <kbd>q</kbd><span>close proof / clear focus</span></div>
      <div class="km-row"><kbd>?</kbd><span>toggle this overlay</span></div>
    </div>
  </div>
</div>
`

const SCRIPT_CORE = /* html */ `
<script>
// -- Utilities --
function esc(s){if(s==null)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function $(id){return document.getElementById(id)}
function relTime(iso){
  if(!iso)return'';
  var d=new Date(iso+(iso.indexOf('Z')<0&&iso.indexOf('+')<0?'Z':''));
  var s=Math.round((Date.now()-d.getTime())/1000);
  if(s<60)return'just now';if(s<3600)return Math.floor(s/60)+'m ago';
  if(s<86400)return Math.floor(s/3600)+'h ago';return Math.floor(s/86400)+'d ago';
}
function chipHtml(label,cls){return '<span class="chip'+(cls?' '+esc(cls):'')+'">'+esc(label)+'</span>'}

// -- Mini markdown --
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
    if(/^### /.test(l)){out.push('<h3>'+inlineM(l.slice(4))+'</h3>');continue}
    if(/^## /.test(l)){out.push('<h2>'+inlineM(l.slice(3))+'</h2>');continue}
    if(/^# /.test(l)){out.push('<h1>'+inlineM(l.slice(2))+'</h1>');continue}
    if(/^> /.test(l)){out.push('<blockquote>'+inlineM(l.slice(2))+'</blockquote>');continue}
    if(/^[-*] /.test(l)){out.push('<ul><li>'+inlineM(l.slice(2))+'</li></ul>');continue}
    if(/^\\d+\\. /.test(l)){out.push('<ol><li>'+inlineM(l.replace(/^\\d+\\.\\s/,''))+'</li></ol>');continue}
    if(l.trim()===''){out.push('<br>');continue}
    out.push('<p>'+inlineM(l)+'</p>');
  }
  if(inCode&&codeLines.length)out.push('<pre><code>'+esc(codeLines.join('\\n'))+'</code></pre>');
  return out.join('\\n').replace(/<\\/ul>\\n<ul>/g,'\\n').replace(/<\\/ol>\\n<ol>/g,'\\n');
}
function inlineM(s){
  s=esc(s);
  s=s.replace(/\`([^\`]+)\`/g,'<code>$1</code>');
  s=s.replace(/\\*\\*(.+?)\\*\\*/g,'<strong>$1</strong>');
  s=s.replace(/\\*(.+?)\\*/g,'<em>$1</em>');
  s=s.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g,'<a href="$2" target="_blank">$1</a>');
  return s;
}

// -- Answer text with [N] citation chips (placeholder-safe) --
function renderAnswerText(raw,exIdx){
  var map=[];
  var text=raw.replace(/\\[(\\d+)\\]/g,function(m,n){
    var ph='\\uE000CITE'+map.length+'\\uE000';
    map.push({ph:ph,hitIdx:parseInt(n,10)-1,n:n});
    return ph;
  });
  var html=renderMd(text);
  for(var i=0;i<map.length;i++){
    var p=map[i];
    html=html.split(p.ph).join('<span class="ref-chip" data-ref-idx="'+p.hitIdx+'" data-exchange="'+exIdx+'" title="evidence '+p.n+'">['+p.n+']</span>');
  }
  return html;
}

// -- Evidence block (<details>) --
function renderEvidence(ex,exIdx,startOpen){
  if(!ex.hits||!ex.hits.length){
    var h='<div class="empty" style="font-size:.72rem">No evidence found.</div>';
    if(ex.skipped&&ex.skipped.length)h+='<div class="skipped">Skipped: '+ex.skipped.map(function(s){return esc(s)}).join(', ')+'</div>';
    return h;
  }
  var groups={};
  ex.hits.forEach(function(hit,i){(groups[hit.source]=groups[hit.source]||[]).push({hit:hit,idx:i})});
  var h='<details class="evidence-wrap"'+(startOpen?' open':'')+'>';
  h+='<summary>evidence ('+ex.hits.length+')</summary>';
  Object.keys(groups).forEach(function(src){
    h+='<div class="substrate-group"><h3>'+esc(src)+'</h3>';
    groups[src].forEach(function(gh){
      var hit=gh.hit;
      h+='<div class="hit" id="hit-'+exIdx+'-'+gh.idx+'">';
      h+='<div class="hit-head">';
      h+='<span class="hit-title">'+(hit.url?'<a href="'+esc(hit.url)+'" target="_blank">'+esc(hit.title)+'</a>':esc(hit.title))+'</span>';
      h+=chipHtml(hit.source+'/'+hit.kind,hit.source);
      if(hit.ref)h+='<span class="hit-ref">'+esc(hit.ref)+'</span>';
      h+='<span class="hit-time">'+relTime(hit.timestamp)+'</span>';
      h+='</div>';
      if(hit.snippet)h+='<div class="hit-snippet">'+esc(hit.snippet)+'</div>';
      h+='</div>';
    });
    h+='</div>';
  });
  if(ex.skipped&&ex.skipped.length)h+='<div class="skipped">Skipped: '+ex.skipped.map(function(s){return esc(s)}).join(', ')+'</div>';
  h+='</details>';
  return h;
}

// -- Ask panel (chat thread) --
var askInput=$('ask-input'),askBtn=$('ask-btn'),chatHistory=[],askModel='';

// Fetch model config (graceful on 404)
fetch('/api/ask/config').then(function(r){if(!r.ok)throw new Error('');return r.json()})
  .then(function(d){if(d.model){askModel=d.model;$('model-indicator').textContent='answers via '+d.model}})
  .catch(function(){});

// Example questions
var exampleQs=['what have I been reading about spaced repetition and flashcards?','what have I been reading about Nick Land and Meltdown?','what have I been reading about HSK and Chinese learning?'];
function showExamples(){
  $('ask-examples').innerHTML=exampleQs.map(function(q){return '<span class="example-chip">'+esc(q)+'</span>'}).join('');
}
showExamples();
$('ask-examples').addEventListener('click',function(e){
  var ch=e.target.closest('.example-chip');
  if(!ch)return;
  askInput.value=ch.textContent.trim();
  doAsk();
});

function doAsk(){
  var q=askInput.value.trim();
  if(!q)return;
  askBtn.disabled=true;
  $('ask-error').hidden=true;$('ask-empty').hidden=true;$('ask-examples').innerHTML='';
  var idx=chatHistory.length;
  chatHistory.push({q:q,answer:null,model:null,elapsed:null,answerError:null,hits:null,skipped:null});
  renderThread();
  askInput.value='';
  fetch('/api/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:q})})
    .then(function(r){if(!r.ok)throw new Error(r.status+' '+r.statusText);return r.json()})
    .then(function(d){
      askBtn.disabled=false;
      var ex=chatHistory[idx];
      ex.hits=d.hits||[];ex.skipped=d.skipped||[];
      // answer is {text,model,elapsedMs}|null or absent (current server)
      if(d.answer&&typeof d.answer.text==='string'){
        ex.answer=d.answer.text;ex.model=d.answer.model||null;
        ex.elapsed=typeof d.answer.elapsedMs==='number'?d.answer.elapsedMs:null;
      }
      ex.answerError=d.answerError||null;
      renderThread();
    })
    .catch(function(e){
      askBtn.disabled=false;
      $('ask-error').textContent=e.message;$('ask-error').hidden=false;
      chatHistory.pop();renderThread();
    });
}
askBtn.addEventListener('click',doAsk);
askInput.addEventListener('keydown',function(e){if(e.key==='Enter')doAsk()});
$('ask-empty').hidden=false;

function renderThread(){
  var h='';
  for(var i=0;i<chatHistory.length;i++){
    var ex=chatHistory[i];
    h+='<div class="t-q"><div class="t-q-bubble">'+esc(ex.q)+'</div></div>';
    if(ex.hits===null){
      h+='<div class="t-searching">Searching\u2026</div>';
    }else if(!ex.answer){
      // retrieval-only (current server or answer:null)
      h+='<div class="t-a">';
      h+='<div class="t-retrieval">Retrieval only \u2014 no synthesized answer. Evidence below.</div>';
      if(ex.answerError)h+='<div class="t-a-error">'+esc(ex.answerError)+'</div>';
      h+=renderEvidence(ex,i,true);
      h+='</div>';
    }else{
      h+='<div class="t-a">';
      h+='<div class="t-a-text">'+renderAnswerText(ex.answer,i)+'</div>';
      h+='<div class="t-a-meta">';
      if(ex.model)h+=chipHtml(ex.model,'model');
      if(ex.elapsed!=null)h+='<span class="t-a-elapsed">'+(ex.elapsed<1000?ex.elapsed+'ms':(ex.elapsed/1000).toFixed(1)+'s')+'</span>';
      h+='</div>';
      if(ex.answerError)h+='<div class="t-a-error">'+esc(ex.answerError)+'</div>';
      h+=renderEvidence(ex,i,false);
      h+='</div>';
    }
  }
  $('ask-thread').innerHTML=h;
  // Wire citation chip clicks
  $('ask-thread').querySelectorAll('.ref-chip').forEach(function(chip){
    chip.addEventListener('click',function(){
      var ri=parseInt(chip.dataset.refIdx,10),ei=parseInt(chip.dataset.exchange,10);
      var hitEl=document.getElementById('hit-'+ei+'-'+ri);
      if(!hitEl)return;
      var det=hitEl.closest('.evidence-wrap');
      if(det&&!det.open)det.open=true;
      hitEl.scrollIntoView({behavior:'smooth',block:'center'});
      hitEl.style.transition='background .3s';hitEl.style.background='var(--bg3)';
      setTimeout(function(){hitEl.style.background=''},600);
    });
  });
}

// -- Proofs --
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
function openProof(name){
  if(proofNames.indexOf(name)<0)return;
  $('proof-error').hidden=true;
  fetch('/api/proofs/'+encodeURIComponent(name))
    .then(function(r){if(!r.ok)throw new Error(r.status+'');return r.json()})
    .then(function(d){
      $('proof-rendered').innerHTML=renderMd(d.markdown||'');
      $('proof-content').hidden=true;$('proof-detail').hidden=false;
    })
    .catch(function(e){$('proof-error').textContent=e.message;$('proof-error').hidden=false})
}
function closeProof(){$('proof-detail').hidden=true;$('proof-content').hidden=false}
$('proof-list').addEventListener('click',function(e){
  var el=e.target.closest('.proof-list-item');if(!el)return;openProof(el.dataset.name);
});
$('proof-back').addEventListener('click',closeProof);
loadProofs();
</script>
`

const SCRIPT_PANELS = /* html */ `
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
    html+='<div class="card'+(muted?' muted':'')+'" data-id="'+c.id+'">';
    html+='<div class="card-front">'+esc(c.front)+'</div>';
    html+='<div class="card-back">'+esc(c.back)+'</div>';
    html+='<div class="card-meta">';
    html+=chipHtml(c.status,c.status==='approved'?'ok':c.status==='rejected'?'':'');
    if(c.sourceRef)html+='<span class="hit-ref">'+esc(c.sourceRef)+'</span>';
    if(c.url)html+='<a href="'+esc(c.url)+'" target="_blank" style="font-size:.67rem">source</a>';
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
  cardsData.forEach(function(c){if(c.id===id)c.status=status});
  renderCards();
  focusedIdx.cards=-1;
  fetch('/api/cards/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id,status:status})})
    .then(function(r){if(!r.ok)throw new Error(r.status+'');return r.json()})
    .then(function(updated){
      cardsData=cardsData.map(function(c){return c.id===updated.id?updated:c});
      renderCards();
    })
    .catch(function(e){$('cards-error').textContent=e.message;$('cards-error').hidden=false;loadCards()})
}
$('cards-list').addEventListener('click',function(e){
  var btn=e.target.closest('button');if(!btn)return;
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
</script>
`

const TAIL = /* html */ `
<script>
// -- Status (header) --
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

// -- Vim navigation --
var activePanel='ask',panelOrder=['ask','progress','cards','proofs'];
var focusedIdx={ask:-1,progress:-1,cards:-1,proofs:-1};

function navItems(panel){
  if(panel==='ask')return document.querySelectorAll('#ask-thread .hit');
  if(panel==='progress')return document.querySelectorAll('#progress-list .prog');
  if(panel==='cards')return document.querySelectorAll('#cards-list .card:not(.muted)');
  if(panel==='proofs')return document.querySelectorAll('#proof-list .proof-list-item');
  return[];
}
function clearFocus(){
  document.querySelectorAll('.vim-focus').forEach(function(el){el.classList.remove('vim-focus')});
  document.querySelectorAll('.panel.vim-active').forEach(function(el){el.classList.remove('vim-active')});
}
function applyFocus(){
  clearFocus();
  var panelEl=document.getElementById('p-'+activePanel);
  if(panelEl)panelEl.classList.add('vim-active');
  var items=navItems(activePanel);
  var idx=focusedIdx[activePanel];
  if(idx>=0&&idx<items.length){
    items[idx].classList.add('vim-focus');
    var det=items[idx].closest('.evidence-wrap');
    if(det&&!det.open)det.open=true;
    items[idx].scrollIntoView({behavior:'smooth',block:'nearest'});
  }
}
function moveFocus(delta){
  var items=navItems(activePanel);
  if(!items.length){focusedIdx[activePanel]=-1;applyFocus();return}
  var idx=focusedIdx[activePanel];
  if(idx<0)idx=delta>0?-1:items.length;
  idx+=delta;
  if(idx<0)idx=items.length-1;
  if(idx>=items.length)idx=0;
  focusedIdx[activePanel]=idx;
  applyFocus();
}
function cyclePanel(delta){
  var cur=panelOrder.indexOf(activePanel);
  if(cur<0)cur=0;
  cur+=delta;
  if(cur<0)cur=panelOrder.length-1;
  if(cur>=panelOrder.length)cur=0;
  activePanel=panelOrder[cur];
  if(focusedIdx[activePanel]<0)focusedIdx[activePanel]=0;
  applyFocus();
  var panelEl=document.getElementById('p-'+activePanel);
  if(panelEl)panelEl.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function activateFocused(){
  var items=navItems(activePanel);
  var idx=focusedIdx[activePanel];
  if(idx<0||idx>=items.length)return;
  var el=items[idx];
  if(activePanel==='ask'){
    var link=el.querySelector('a[href]');
    if(link)window.open(link.href,'_blank');
  }else if(activePanel==='proofs'){
    if(el.dataset.name)openProof(el.dataset.name);
  }else if(activePanel==='cards'){
    var btn=el.querySelector('button.approve');
    if(btn)btn.focus();
  }
}
function cardAction(action){
  if(activePanel!=='cards')return;
  var items=navItems('cards');
  var idx=focusedIdx.cards;
  if(idx<0||idx>=items.length)return;
  var id=parseInt(items[idx].dataset.id,10);
  if(!id)return;
  setCardStatus(id,action==='approve'?'approved':'rejected');
}
function jumpTo(where){
  var items=navItems(activePanel);
  if(!items.length){focusedIdx[activePanel]=-1;applyFocus();return}
  focusedIdx[activePanel]=where==='first'?0:items.length-1;
  applyFocus();
}
function isTyping(){
  var el=document.activeElement;
  return el&&(el.tagName==='INPUT'||el.tagName==='TEXTAREA'||el.isContentEditable);
}

document.addEventListener('keydown',function(e){
  if(e.key==='Escape'){
    var km=$('keymap-overlay');
    if(km.classList.contains('open')){km.classList.remove('open');return}
    if(!$('proof-detail').hidden){closeProof();return}
    if(isTyping()){document.activeElement.blur();return}
    clearFocus();return;
  }
  if(isTyping())return;
  if(e.key==='?'){e.preventDefault();$('keymap-overlay').classList.toggle('open')}
  else if(e.key==='q'){if(!$('proof-detail').hidden){closeProof()}else{clearFocus()}}
  else if(e.key==='j'){e.preventDefault();moveFocus(1)}
  else if(e.key==='k'){e.preventDefault();moveFocus(-1)}
  else if(e.key==='['||e.key==='h'){e.preventDefault();cyclePanel(-1)}
  else if(e.key===']'||e.key==='l'){e.preventDefault();cyclePanel(1)}
  else if(e.key==='Enter'){e.preventDefault();activateFocused()}
  else if(e.key==='a'){e.preventDefault();cardAction('approve')}
  else if(e.key==='r'){e.preventDefault();cardAction('reject')}
  else if(e.key==='g'){e.preventDefault();jumpTo('first')}
  else if(e.key==='G'){e.preventDefault();jumpTo('last')}
});

$('keys-hint').addEventListener('click',function(){$('keymap-overlay').classList.add('open')});
$('keymap-overlay').addEventListener('click',function(e){
  if(e.target===$('keymap-overlay'))$('keymap-overlay').classList.remove('open');
});

// -- Initial load + pollers --
loadProgress();loadCards();loadNotes();loadStatus();
setInterval(function(){loadProgress();loadCards()},3000);
setInterval(loadStatus,30000);
</script>
</body>
</html>
`
