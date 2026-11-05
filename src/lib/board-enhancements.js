import { ROLE } from './role.js';
import { normalize, priorityTone, allowedColumns, issueKey } from './board-rules.js';

export function mountBoardEnhancements({host,root,isEnabled,findCard,closePopover}) {
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const plain=v=>typeof v==='string'?v:[v?.text,...(v?.content||[]).map(plain)].filter(Boolean).join(' ');
  const hours=v=>v==null?'Não informado':`${Math.floor(v/3600)}h ${Math.floor(v%3600/60)}m`;
  const adf=text=>({type:'doc',version:1,content:text.split('\n').map(line=>({type:'paragraph',content:line?[{type:'text',text:line}]:[]}))});
  const visible=node=>node.isConnected&&node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden';
  const colors={critical:'#f87168',high:'#faa53d',low:'#85b8ff',normal:'#b6c2cf'};
  const cache=new Map(), decorations=new Map(), scannedNodes=new Map();
  let generation=0, signature='', strip, detailed=false, people=false, boardBusy=false;
  let panelHost,panel,selected=null,collapsed=false,saving=false,detailGeneration=0;
  let pointer,drag,dragGeneration=0,heldTimer,lastActive=false,lastRoute=location.href,nativeDragging=false;
  const guides=document.createElement('div'); guides.className='qf-guides'; root.append(guides);
  async function json(url,options={}) {
    const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),20000);
    try {
      const response=await fetch(url,{credentials:'same-origin',...options,signal:controller.signal,headers:{Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{})}});
      const text=await response.text();let data;
      try{data=text?JSON.parse(text):null;}catch{throw Error('Resposta inválida do Jira. Confira sua sessão.');}
      if(!response.ok)throw Error(data?.errorMessages?.join(' ')||Object.values(data?.errors||{}).join(' ')||`Jira: HTTP ${response.status}`);
      return data;
    }catch(error){if(error.name==='AbortError')throw Error(options.method?'Sem confirmação da gravação. Confira a tarefa antes de repetir.':'O Jira demorou para responder. Tente novamente.');throw error;}
    finally{clearTimeout(timeout);}
  }
  const request=(key,path='',options)=>json(`/rest/api/3/issue/${encodeURIComponent(key)}${path}`,options);
  const write=(key,path,body)=>request(key,path,{method:'POST',body:JSON.stringify(body)});
  function cards(){
    const found=new Map();
    for(const node of document.querySelectorAll('[data-issue-key],[data-testid*="card"],[data-rbd-draggable-id],article')){
      if(node.closest('[data-qf-owned]')||!visible(node))continue;
      const item=findCard(node);
      if(item&&!item.node.closest('[role="dialog"]')&&!found.has(item.key))found.set(item.key,item);
    }
    return [...found.values()];
  }
  function clearBoard(){generation++;signature='';strip?.remove();strip=null;for(const [node,old] of decorations){node.style.boxShadow=old.shadow;old.badge.remove();}decorations.clear();scannedNodes.clear();}
  function decorate(item,issue){
    const f=issue.fields||{},tone=priorityTone(f.priority?.name),old=decorations.get(item.node);
    if(old){old.badge.remove();item.node.style.boxShadow=old.shadow;}
    const badge=document.createElement('div');badge.dataset.qfOwned='badge';
    badge.style.cssText=`font:12px/1.5 Segoe UI,sans-serif;padding:6px 8px;border-top:1px solid #8883;color:${colors[tone]};pointer-events:none;`;
    const now=new Date(),today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const overdue=f.duedate&&f.duedate<today&&f.status?.statusCategory?.key!=='done';
    badge.textContent=`${tone==='low'?'↓':tone==='normal'?'=':'↑'} ${f.priority?.name||'Prioridade não informada'}${overdue?' · Prazo vencido':''}`;
    if(detailed){const extra=document.createElement('div');extra.style.color='var(--ds-text-subtle,#b6c2cf)';extra.textContent=`${f.assignee?.displayName||'Sem responsável'} · ${f.status?.name||'Sem status'} · Prazo: ${f.duedate||'não definido'} · Apontado: ${hours(f.timetracking?.timeSpentSeconds)}`;badge.append(extra);}
    decorations.set(item.node,{shadow:item.node.style.boxShadow,badge});
    if(tone!=='normal')item.node.style.boxShadow=`inset 3px 0 ${colors[tone]}`;
    item.node.append(badge);
  }
  async function enrich(items){
    clearBoard();const current=generation;boardBusy=true;
    const board=items[0]?.node.closest('[data-testid*="board-container"],[data-testid*="board.area"],[data-testid*="board-content"]')||document.querySelector('[data-testid*="board-container"],[data-testid*="board.area"],[data-testid*="board-content"]');
    if(board){strip=document.createElement('div');strip.dataset.qfOwned='strip';strip.style.cssText='padding:10px 12px;font:13px/1.5 Segoe UI,sans-serif;color:inherit;border-bottom:1px solid #8884;';strip.textContent='QuickFill · Carregando demandas deste recorte…';board.before(strip);}
    const results=[],queue=[...items];
    await Promise.all(Array.from({length:3},async()=>{while(queue.length&&current===generation&&isEnabled()){
      const item=queue.shift();
      try{let entry=cache.get(item.key);if(!entry||Date.now()-entry.at>30000){entry={at:Date.now(),data:await request(item.key,'?fields=summary,assignee,priority,duedate,status,timetracking')};cache.set(item.key,entry);}if(current!==generation||!isEnabled())return;if(visible(item.node)){decorate(item,entry.data);results.push({item,data:entry.data});}}
      catch{/* The loaded/visible count below reports partial data. */}
    }}));
    boardBusy=false;if(current!==generation)return;
    signature=items.map(i=>i.key).join('|');for(const item of items)scannedNodes.set(item.key,item.node);if(!strip)return;
    strip.innerHTML=`<strong>QuickFill · ${esc(ROLE.toUpperCase())}</strong> · ${results.length}/${items.length} demandas carregadas neste recorte <button data-view="details" aria-pressed="${detailed}">${detailed?'Resumir':'Detalhar'} cards</button> <button data-view="people" aria-expanded="${people}">Por responsável</button> <button data-view="refresh">Atualizar dados</button><div class="qf-people" ${people?'':'hidden'}></div>`;
    const groups=new Map();for(const row of results){const person=row.data.fields?.assignee,id=person?.accountId||'unassigned';if(!groups.has(id))groups.set(id,{name:person?.displayName||'Sem responsável',rows:[]});groups.get(id).rows.push(row);}
    const list=strip.querySelector('.qf-people');
    for(const {name,rows} of groups.values()){
      const section=document.createElement('details');section.open=groups.size===1;
      section.innerHTML=`<summary>${esc(name)} · ${rows.length} ${rows.length===1?'demanda':'demandas'} neste recorte</summary>${rows.map(({item,data})=>`<p><a href="/browse/${encodeURIComponent(item.key)}">${esc(item.key)} · ${esc(data.fields?.summary)}</a><br>${esc(data.fields?.status?.name)} · ${esc(data.fields?.priority?.name)} · Prazo: ${esc(data.fields?.duedate||'não definido')} · Apontado: ${hours(data.fields?.timetracking?.timeSpentSeconds)}</p>`).join('')}`;list.append(section);
    }
    strip.querySelectorAll('a').forEach(a=>a.style.color='var(--ds-link,#85b8ff)');
    strip.querySelectorAll('button').forEach(b=>b.style.cssText='font:inherit;color:inherit;background:transparent;border:1px solid #8886;border-radius:5px;padding:5px 8px;margin:3px;cursor:pointer;');
    strip.addEventListener('click',e=>{const action=e.target.closest('button')?.dataset.view;if(action==='people'){people=!people;list.hidden=!people;e.target.setAttribute('aria-expanded',String(people));}if(action==='details'){detailed=!detailed;signature='';}if(action==='refresh'){cache.clear();signature='';}});
  }
  function nativeContext(){
    const dialog=[...document.querySelectorAll('[role="dialog"],[data-testid*="issue-detail"]')].filter(visible).find(n=>n.querySelector('[data-testid*="issue.views"],a[href*="/browse/"]'));
    const key=issueKey(location.href)||dialog?.textContent.match(/\b[A-Z][A-Z0-9_]*-\d+\b/)?.[0];if(!key)return null;
    const context=[...(dialog||document).querySelectorAll('[data-testid*="context.context-items"],[data-testid*="issue-layout.right"],[data-testid="native-issue-context"]')].find(visible);
    return {key,context,dialog};
  }
  function removePanel(){detailGeneration++;panelHost?.remove();panelHost=panel=null;selected=null;host.removeAttribute('data-qf-detail');}
  function createPanel(info){
    removePanel();selected=info.key;collapsed=false;closePopover();host.dataset.qfDetail='true';
    panelHost=document.createElement('aside');panelHost.dataset.qfOwned='issue';
    panelHost.style.cssText=info.context?'display:block;margin:0 0 16px;width:100%;min-width:0;':'position:fixed;right:20px;top:110px;width:min(320px,calc(100vw - 40px));z-index:2147483643;';
    panel=panelHost.attachShadow({mode:'open'});
    panel.innerHTML=`<link rel="stylesheet" href="${chrome.runtime.getURL('board-detail.css')}"><section aria-label="QuickFill: ações da demanda"><header><strong>QuickFill <small>${esc(info.key)}</small></strong><button data-do="collapse" aria-label="Recolher ações rápidas" aria-expanded="true">−</button></header><div class="body"><div class="facts" role="status">Carregando demanda…</div><nav><button data-do="move">Mover →</button><button data-do="comment">Comentar</button><button data-do="hours">Apontar horas</button><button data-do="copy">Copiar link</button><button data-do="refresh">Atualizar</button></nav><div class="editor"></div><div class="feedback" role="status"></div><details><summary>Atividade recente</summary><div class="activity"></div></details></div></section>`;
    (info.context||document.body).prepend(panelHost);panel.addEventListener('click',handlePanelClick);panel.addEventListener('submit',handleSubmit);loadDetails();
  }
  async function loadDetails(){
    const key=selected,current=++detailGeneration;if(!panel)return;panel.querySelector('.feedback').textContent='Atualizando…';
    const results=await Promise.allSettled([request(key,'?fields=summary,status,assignee,priority,duedate,timetracking'),request(key,'/comment?orderBy=-created&maxResults=5'),request(key,'/changelog?maxResults=1').then(data=>request(key,`/changelog?startAt=${Math.max(0,(data.total||0)-5)}&maxResults=5`))]);
    if(current!==detailGeneration||selected!==key||!panel)return;
    if(results[0].status==='rejected'){panel.querySelector('.feedback').textContent=results[0].reason.message;return;}
    const f=results[0].value.fields||{},comments=results[1].value?.comments||[],history=results[2].value?.values||[];
    panel.querySelector('.facts').innerHTML=`<p class="summary">${esc(f.summary)}</p><dl><dt>Etapa</dt><dd>${esc(f.status?.name)}</dd><dt>Responsável</dt><dd>${esc(f.assignee?.displayName||'Sem responsável')}</dd><dt>Prioridade</dt><dd class="${priorityTone(f.priority?.name)}">${esc(f.priority?.name||'Não informada')}</dd><dt>Prazo</dt><dd>${esc(f.duedate||'Não definido')}</dd><dt>Apontado</dt><dd>${hours(f.timetracking?.timeSpentSeconds)}</dd><dt>Restante</dt><dd>${hours(f.timetracking?.remainingEstimateSeconds)}</dd></dl>`;
    const events=[...comments.map(c=>({date:c.created,text:`${c.author?.displayName||'Usuário'}: ${plain(c.body)}`})),...history.map(h=>({date:h.created,text:`${h.author?.displayName||'Usuário'}: ${(h.items||[]).map(i=>`${i.field}: ${i.fromString||'—'} → ${i.toString||'—'}`).join('; ')}`}))].sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,8);
    panel.querySelector('.activity').innerHTML=events.map(e=>`<article><small>${esc(new Date(e.date).toLocaleString('pt-BR'))}</small><p>${esc(e.text)}</p></article>`).join('')||'<p>Nenhuma atividade disponível.</p>';
    panel.querySelector('.feedback').textContent=results.some(r=>r.status==='rejected')?'Algumas atividades não puderam ser consultadas.':'';
  }
  async function handlePanelClick(event){
    const button=event.target.closest('button');if(!button||saving)return;
    const action=button.dataset.do,key=selected,current=detailGeneration,target=panel;
    if(action==='collapse'){collapsed=!collapsed;panel.querySelector('.body').hidden=collapsed;button.textContent=collapsed?'+':'−';button.setAttribute('aria-expanded',String(!collapsed));return;}
    if(action==='refresh')return loadDetails();
    if(action==='copy'){try{await navigator.clipboard.writeText(`${location.origin}/browse/${key}`);if(panel===target)panel.querySelector('.feedback').textContent='Link copiado.';}catch{if(panel===target)panel.querySelector('.feedback').textContent='Não foi possível copiar o link.';}return;}
    const editor=panel.querySelector('.editor');
    if(action==='cancel'){editor.replaceChildren();return;}
    if(action==='comment')editor.innerHTML='<form data-kind="comment"><label>Comentário<textarea name="comment" required maxlength="10000"></textarea></label><button>Publicar no Jira</button><button type="button" data-do="cancel">Cancelar</button></form>';
    if(action==='hours'){editor.innerHTML='<form data-kind="hours"><label>Tempo em minutos<input name="minutes" type="number" min="1" max="1440" required></label><label>Início<input name="started" type="datetime-local" required></label><label>Descrição<textarea name="comment" maxlength="2000"></textarea></label><button>Registrar no Jira</button><button type="button" data-do="cancel">Cancelar</button></form>';editor.querySelector('[name=started]').value=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);}
    if(action==='move'){
      editor.textContent='Consultando destinos permitidos…';
      try{const data=await request(key,'/transitions?expand=transitions.fields');if(current!==detailGeneration||panel!==target)return;editor.replaceChildren();for(const transition of data.transitions||[]){const btn=document.createElement('button');btn.textContent=`${transition.name} → ${transition.to?.name||''}`;btn.addEventListener('click',()=>move(key,transition));editor.append(btn);}if(!data.transitions?.length)editor.textContent='Nenhuma transição disponível para sua conta.';}
      catch(error){if(panel===target)editor.textContent=error.message;}
    }
    editor.querySelector('input,textarea')?.focus();
  }
  async function save(key,operation){
    if(saving||selected!==key)return;const target=panel;saving=true;target.querySelectorAll('button,input,textarea').forEach(n=>n.disabled=true);
    try{await operation();cache.delete(key);signature='';if(panel===target){panel.querySelector('.editor').replaceChildren();await loadDetails();if(panel===target)panel.querySelector('.feedback').textContent='Salvo no Jira. Os campos nativos podem exigir atualização da página.';}}
    catch(error){if(panel===target)panel.querySelector('.feedback').textContent=error.message;}
    finally{saving=false;if(panel===target)target.querySelectorAll('button,input,textarea').forEach(n=>n.disabled=false);}
  }
  function move(key,transition){if(Object.values(transition.fields||{}).some(f=>f.required&&!f.hasDefaultValue)){panel.querySelector('.feedback').textContent='Esta transição exige campos adicionais. Use o seletor de status nativo da demanda.';return;}return save(key,()=>write(key,'/transitions',{transition:{id:String(transition.id)}}));}
  function handleSubmit(event){
    event.preventDefault();const form=event.target;if(!form.reportValidity()||saving)return;
    const data=new FormData(form),text=String(data.get('comment')||'').trim(),key=selected;
    if(form.dataset.kind==='comment'){if(!text){panel.querySelector('.feedback').textContent='Escreva um comentário.';return;}return save(key,()=>write(key,'/comment',{body:adf(text)}));}
    const minutes=Number(data.get('minutes')),started=new Date(String(data.get('started')));if(!Number.isInteger(minutes)||minutes<1||minutes>1440||!Number.isFinite(started.getTime()))return;
    return save(key,()=>write(key,'/worklog?adjustEstimate=leave',{timeSpentSeconds:minutes*60,started:started.toISOString().replace('Z','+0000'),...(text?{comment:adf(text)}:{})}));
  }
  function endDrag(){clearTimeout(heldTimer);if(drag){cache.delete(drag.item.key);signature='';}nativeDragging=false;pointer=null;drag=null;dragGeneration++;guides.replaceChildren();host.removeAttribute('data-qf-dragging');}
  async function beginDrag(item){
    if(drag||!isEnabled())return;closePopover();host.dataset.qfDragging='true';const current=++dragGeneration;drag={item,columns:[],message:'Consultando fluxo do Jira…'};drawGuides();
    try{
      const id=location.pathname.match(/\/boards\/(\d+)/)?.[1]||new URLSearchParams(location.search).get('rapidView');
      const [data,config]=await Promise.all([request(item.key,'/transitions'),id?json(`/rest/agile/1.0/board/${encodeURIComponent(id)}/configuration`).catch(()=>null):null]);
      if(current!==dragGeneration||!drag)return;
      const transitions=data.transitions||[],configured=config?.columnConfig?.columns;
      const names=configured?allowedColumns(configured,transitions).map(c=>normalize(c.name)):transitions.map(t=>normalize(t.to?.name));
      const candidates=[...document.querySelectorAll('[data-testid*="column"],[data-rbd-droppable-id],[data-drop-target-for-element]')].filter(visible),seen=new Set();
      drag.columns=candidates.filter(node=>{const heading=node.querySelector('h2,h3,[data-testid*="column-header"],[data-testid*="column.title"],[data-testid*="column-name"]');const name=normalize(heading?.textContent).replace(/\s+\d+$/,'');if(!name||!names.includes(name)||seen.has(name))return false;seen.add(name);return true;});
      drag.message=drag.columns.length?'Destinos disponíveis · solte usando o arraste do Jira':transitions.length?'Destinos: '+transitions.map(t=>t.to?.name||t.name).join(' · ')+' · Não foi possível localizar as colunas.':'Nenhuma transição disponível para esta demanda.';drawGuides();
    }catch(error){if(current===dragGeneration&&drag){drag.message=error.message;drawGuides();}}
  }
  function drawGuides(){if(!drag)return;guides.innerHTML=`<div class="qf-drag-message" role="status">${esc(drag.item.key)} · ${esc(drag.message)}</div>`;for(const column of drag.columns){const r=column.getBoundingClientRect();if(r.right<0||r.left>innerWidth)continue;const outline=document.createElement('div');outline.className='qf-drop-guide';outline.style.cssText=`left:${Math.max(0,r.left)}px;top:${Math.max(0,r.top)}px;width:${Math.min(r.right,innerWidth)-Math.max(r.left,0)}px;height:${Math.max(50,Math.min(r.bottom,innerHeight)-Math.max(r.top,0))}px;`;outline.innerHTML='<span>Destino permitido ↓</span>';guides.append(outline);}}
  document.addEventListener('pointerdown',e=>{if(!isEnabled()||e.button!==0||e.target.closest('[data-qf-owned]'))return;const found=findCard(e.target);if(!found)return;pointer={item:found,x:e.clientX,y:e.clientY};heldTimer=setTimeout(()=>{if(pointer)beginDrag(pointer.item);},350);},true);
  document.addEventListener('pointermove',e=>{if(pointer&&Math.hypot(e.clientX-pointer.x,e.clientY-pointer.y)>6)beginDrag(pointer.item);},true);
  document.addEventListener('dragstart',e=>{if(!isEnabled())return;const found=findCard(e.target);if(found){nativeDragging=true;beginDrag(found);}},true);
  for(const name of ['pointerup','dragend','drop'])document.addEventListener(name,endDrag,true);
  document.addEventListener('pointercancel',()=>{if(!nativeDragging)endDrag();},true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')endDrag();},true);
  window.addEventListener('blur',endDrag);window.addEventListener('scroll',drawGuides,{capture:true,passive:true});window.addEventListener('resize',drawGuides);
  // Never prevent or replace the native card click.
  document.addEventListener('click',e=>{if(isEnabled()&&findCard(e.target))closePopover();},true);
  setInterval(()=>{
    const active=isEnabled()&&!host.hidden;if(!active){if(lastActive){clearBoard();removePanel();endDrag();}lastActive=false;return;}lastActive=true;
    if(lastRoute!==location.href){lastRoute=location.href;signature='';endDrag();}
    const info=nativeContext();if(info){if(selected!==info.key||!panelHost?.isConnected)createPanel(info);else if(info.context&&panelHost.parentNode!==info.context){panelHost.style.cssText='display:block;margin:0 0 16px;width:100%;min-width:0;';info.context.prepend(panelHost);}}else if(selected)removePanel();
    if(drag||selected||boardBusy)return;
    const items=cards(),next=items.map(i=>i.key).join('|');if(signature&&next!==signature&&items.length<signature.split('|').length&&items.every(i=>scannedNodes.has(i.key)))detailed=true;if(next!==signature||items.some(i=>scannedNodes.get(i.key)!==i.node||(decorations.has(i.node)&&!decorations.get(i.node).badge.isConnected)))enrich(items);
  },900);
}
