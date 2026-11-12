/* ================= UPS ================= */
let UCFG=null, UHIST=null, upsDocs=[], upsLocais={}, escalaDb=null, escalaDbInfo=null, escalaLocal=null, ferUps={}, UR=null, ordemU={k:'pct',dir:1}, cobModoU='mes', nAvisosUps=0;
const SIGLAS=['BCB','ITM','PDS','PDT','STI'];
const NOME_SIGLA={BCB:'Bacabal',ITM:'Itapecuru Mirim',PDS:'Pedreiras',PDT:'Presidente Dutra',STI:'Santa Inês'};
const CL_COR={A:'#40c746',B:'#f2e33a',C:'#ed7b24',D:'#f24141'};
const n0=v=>Math.round(v||0).toLocaleString('pt-BR');
const n1=v=>v==null?'–':(+v).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1});
const clsPill=c=>c?'<span class="cl cl-'+c+'">'+c+'</span>':'<span class="pill nd">–</span>';
const faixaCell=p=>'<span class="pct '+UPSCalc.faixaBase(p).cls+'">'+pct(p)+'</span>';
const clsCell=p=>{const c=UPSCalc.classe(p);return '<span class="pct cl-p-'+(c||'x')+'">'+pct(p)+'</span>'};
function indAtual(){const p=pag().id;if(p.startsWith('ups-'))return'ups';if(['painel','prefixos','cobranca'].includes(p))return'disp';return null}

function montarUPS(){
  if(!UCFG||!UHIST||!cfg)return;
  const dias=Object.assign({},UHIST.dias);
  for(const d of upsDocs)dias[d.data]=d.eq;
  for(const d in upsLocais)dias[d]=upsLocais[d];
  const escala=escalaLocal||escalaDb||UCFG.escala;
  UR=UPSCalc.calcular(UCFG,escala,dias,cfg.feriados,ferUps);
  UR.dias=dias;UR.escala=escala;
  preencherFiltrosUps();renderUPS();renderInicio();renderAvisosUps();renderCadUps();renderRail();
}
function preencherFiltrosUps(){
  const ms=new Set();for(const l of UR.linhas)if(l.meta>0||l.temUps)ms.add(l.mes);
  const meses=[...ms].sort().reverse();
  const prev=$('u-mes').value;
  opts($('u-mes'),meses,null,mesNome);
  if(!prev&&meses.length)$('u-mes').value=UR.ultima&&meses.includes(UR.ultima.slice(0,7))?UR.ultima.slice(0,7):meses[0];
  opts($('u-base'),SIGLAS,'Todas',s=>s+' · '+NOME_SIGLA[s]);
  opts($('u-tipo'),[...new Set(UR.cadastros.map(c=>c.tipo).filter(Boolean))].sort(),'Todos');
}
function filtrarUps(m){
  m=m||$('u-mes').value;const b=$('u-base').value,t=$('u-tipo').value;
  return UR.linhas.filter(l=>l.mes===m&&(!b||l.sigla===b)&&(!t||l.tipo===t));
}
function statsUps(L){
  let ups=0,meta=0,tem=false;for(const l of L){ups+=l.ups;meta+=l.meta;tem=tem||l.temUps}
  const teams=UPSCalc.porEquipe(L.filter(l=>l.cod)).filter(t=>t.classe);
  return {ups,meta,pct:meta&&tem?ups/meta:null,teams};
}
function diasComDados(m){return Object.keys(UR.dias).filter(d=>d.startsWith(m)&&d<=UR.ultima).sort()}
function metaDoMes(m){const b=$('u-base').value,t=$('u-tipo').value;let s=0;for(const k in UR.metaMes){const [mm,,sg,tp]=k.split('|');if(mm===m&&(!b||sg===b)&&(!t||tp===t))s+=UR.metaMes[k]}return s}
function contaClasses(teams){const c={A:0,B:0,C:0,D:0};for(const t of teams)c[t.classe]++;return c}
function pctAB(teams){if(!teams.length)return null;return teams.filter(t=>t.classe==='A'||t.classe==='B').length/teams.length}

function renderUPS(){
  if(!UR)return;
  const m=$('u-mes').value;if(!m)return;
  const L=filtrarUps(),S=statsUps(L),cl=contaClasses(S.teams),dias=diasComDados(m);
  const ate=dias.length?dias[dias.length-1]:null;
  // chips de filtro
  const at=[['u-base','Base'],['u-tipo','Tipo']].filter(x=>$(x[0]).value);
  $('ativosUps').innerHTML=at.map(c=>'<span class="chipf"><small>'+c[1]+'</small>'+esc($(c[0]).value)+'<button type="button" data-tirau="'+c[0]+'" aria-label="Remover filtro">✕</button></span>').join('');
  $('ativosUps').querySelectorAll('[data-tirau]').forEach(b=>b.onclick=()=>{$(b.dataset.tirau).value='';renderUPS();pintarTopoUps()});
  ['ativosUpsP','ativosUpsD','ativosUpsC'].forEach(id=>{$(id).innerHTML=$('ativosUps').innerHTML;$(id).querySelectorAll('[data-tirau]').forEach(b=>b.onclick=()=>{$(b.dataset.tirau).value='';renderUPS();pintarTopoUps()})});
  // resumo
  const metaMes=metaDoMes(m), mesmo=UR.ultima&&UR.ultima.startsWith(m);
  const faltam=[];if(dias.length){const ult=mesmo?UR.ultima:dias[dias.length-1];for(let d=m+'-01';d<=ult;d=UPSCalc.addDias(d,1))if(!UR.dias[d])faltam.push(d)}
  $('upsResumo').innerHTML='<div class="ur-main"><span class="ur-k">Realizado</span><b>'+n0(S.ups)+'</b><span class="ur-de">de '+n0(S.meta)+' UPS</span>'+clsCell(S.pct)+'<span class="ur-cl">Classe '+clsPill(UPSCalc.classe(S.pct))+'</span></div>'
    +(mesmo&&S.pct!=null?'<div class="ur-proj">Projeção do mês <b>'+n0(metaMes*S.pct)+'</b> de '+n0(metaMes)+'</div>':'')
    +'<div class="ur-ate">'+(ate?'Produção até <b>'+dataBR(ate)+'</b>':'Sem produção no mês')+(faltam.length?' · <span class="ur-falta">faltam '+faltam.length+' dia(s) sem produção carregada</span>':'')+'</div>';
  // classes
  const tt=S.teams.length||1;
  $('upsClasses').innerHTML=['A','B','C','D'].map(c=>'<div class="clcard" style="--c:'+CL_COR[c]+'"><span>Classe '+c+'</span><b>'+cl[c]+'</b><small>'+pct(cl[c]/tt)+' das equipes</small></div>').join('');
  // bases
  const base=s=>S.teams.filter(t=>t.siglas.has(s));
  $('upsBases').innerHTML=SIGLAS.map(s=>{const p=pctAB(base(s));return '<div class="bcard '+UPSCalc.faixaBase(p).cls+'"><span>'+s+'</span><b>'+pct(p)+'</b><small>'+base(s).length+' equipes</small></div>'}).join('')
    +(()=>{const p=pctAB(S.teams);return '<div class="bcard geral '+UPSCalc.faixaBase(p).cls+'"><span>Geral</span><b>'+pct(p)+'</b><small>'+S.teams.length+' equipes</small></div>'})();
  // por tipo
  const tipos={};for(const l of L.filter(x=>x.cod)){const a=tipos[l.tipo]||(tipos[l.tipo]={k:l.tipo,ups:0,meta:0,tem:false,recs:new Set(),ed:new Set()});a.ups+=l.ups;a.meta+=l.meta;a.tem=a.tem||l.temUps;if(l.n>0){a.recs.add(l.rec);a.ed.add(l.rec+'|'+l.data)}}
  const linhaT=(nome,a,tot)=>{const p=a.meta&&a.tem?a.ups/a.meta:null;return '<tr'+(tot?' class="tot"':'')+'><td>'+esc(nome)+'</td><td class="n">'+a.recs.size+'</td><td class="n">'+n0(a.ups)+'</td><td class="n">'+n0(a.meta)+'</td><td class="n">'+clsCell(p)+'</td><td>'+clsPill(UPSCalc.classe(p))+'</td><td class="n">'+n1(a.ed.size?a.ups/a.ed.size:null)+'</td></tr>'};
  const totT={ups:0,meta:0,tem:false,recs:new Set(),ed:new Set()};for(const l of L){totT.ups+=l.ups;totT.meta+=l.meta;totT.tem=totT.tem||l.temUps;if(l.n>0){totT.recs.add(l.rec);totT.ed.add(l.rec+'|'+l.data)}}
  $('upsTipo').innerHTML=Object.values(tipos).sort((a,b)=>a.k<b.k?-1:1).map(a=>linhaT(a.k,a)).join('')+linhaT('Total',totT,true);
  // classes por base (barras empilhadas)
  $('upsStack').innerHTML=SIGLAS.map(s=>{const ts=base(s),n=ts.length;if(!n)return'';const c=contaClasses(ts);
    return '<div class="stk"><span class="stk-n">'+s+'</span><div class="stk-b">'+['A','B','C','D'].filter(k=>c[k]).map(k=>'<i style="flex:'+c[k]+';background:'+CL_COR[k]+'" title="Classe '+k+': '+c[k]+' de '+n+'">'+(c[k]/n>=0.08?pct(c[k]/n):'')+'</i>').join('')+'</div></div>'}).join('')+'<div class="stk-leg">'+['A','B','C','D'].map(k=>'<span><i style="background:'+CL_COR[k]+'"></i>'+k+'</span>').join('')+'</div>';
  // ritmo
  graficoRitmo(L,dias,mesmo);
  // mês × base
  const meses=[...new Set(UR.linhas.filter(l=>l.meta>0).map(l=>l.mes))].sort();
  const tsel=$('u-tipo').value;const LM=UR.linhas.filter(l=>!tsel||l.tipo===tsel);
  const agM={};for(const l of LM){const ks=[l.mes+'|TOTAL'];if(l.cod&&l.sigla)ks.push(l.mes+'|'+l.sigla);for(const k of ks){const a=agM[k]||(agM[k]=[0,0]);a[0]+=l.ups;a[1]+=l.meta}}
  const vM=k=>{const a=agM[k];return a&&a[1]?a[0]/a[1]:null};
  const totB=s=>{let u=0,mt=0;for(const mm of meses){const a=agM[mm+'|'+s];if(a){u+=a[0];mt+=a[1]}}return mt?u/mt:null};
  $('upsMes').innerHTML='<thead><tr><th>Base</th>'+meses.map(mm=>'<th class="n">'+MESES[+mm.slice(5)-1].slice(0,3)+'/'+mm.slice(2,4)+'</th>').join('')+'<th class="n">Total</th></tr></thead><tbody>'
    +SIGLAS.map(s=>'<tr><td><b>'+s+'</b></td>'+meses.map(mm=>'<td class="n">'+faixaCell(vM(mm+'|'+s))+'</td>').join('')+'<td class="n">'+faixaCell(totB(s))+'</td></tr>').join('')
    +'<tr class="tot"><td>Total</td>'+meses.map(mm=>'<td class="n">'+faixaCell(vM(mm+'|TOTAL'))+'</td>').join('')+'<td class="n">'+faixaCell(totB('TOTAL'))+'</td></tr></tbody>';
  tabelaPrefUps(S.teams);
  diarioUps(L,dias,S.teams);
  cobrancaUps(L,S.teams,dias);
  if(indAtual()==='ups')pintarTopoUps();
}
function pintarTopoUps(){const m=$('u-mes').value;$('periodoTxt').textContent=m?mesNome(m).replace(/^./,c=>c.toUpperCase()):'Período';const n=['u-base','u-tipo'].filter(id=>$(id).value).length;$('filtrosN').hidden=!n;$('filtrosN').textContent=n}
function graficoRitmo(L,dias,mesmo){
  const el=$('upsRitmo');
  const pd=dias.map(d=>{let u=0,mt=0;for(const l of L)if(l.data===d){u+=l.ups;mt+=l.meta}return{d,u,mt}}).filter(x=>x.mt>0);
  $('upsRitmoSub').textContent='barras = atingimento do dia · linha = acumulado no mês';
  if(!pd.length){el.innerHTML='<div class="empty">Sem dias com produção e meta neste mês.</div>';return}
  let cu=0,cm=0;for(const x of pd){cu+=x.u;cm+=x.mt;x.p=x.u/x.mt;x.ac=cu/cm}
  const W=1100,H=260,L0=46,R=16,T=26,B=34,top=Math.max(1,Math.ceil(Math.max(...pd.map(x=>Math.max(x.p,x.ac)))*10)/10);
  const bw=(W-L0-R)/pd.length, X=i=>L0+bw*i+bw/2, Y=v=>T+(top-v)/top*(H-T-B);
  let s='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Ritmo diário da UPS">';
  for(let v=0;v<=top+1e-9;v+=0.2){s+='<line class="grid" x1="'+L0+'" x2="'+(W-R)+'" y1="'+Y(v)+'" y2="'+Y(v)+'"/><text x="'+(L0-8)+'" y="'+(Y(v)+4)+'" text-anchor="end">'+Math.round(v*100)+'%</text>'}
  s+='<line class="meta" x1="'+L0+'" x2="'+(W-R)+'" y1="'+Y(0.9095)+'" y2="'+Y(0.9095)+'"/>';
  pd.forEach((x,i)=>{const c=UPSCalc.classe(x.p);const w=Math.min(46,bw*0.7);s+='<rect x="'+(X(i)-w/2)+'" y="'+Y(x.p)+'" width="'+w+'" height="'+(Y(0)-Y(x.p))+'" rx="3" fill="'+CL_COR[c]+'" opacity=".85"><title>'+dataBR(x.d)+': '+pct(x.p)+' no dia</title></rect>';
    if(pd.length<=16)s+='<text x="'+X(i)+'" y="'+(Y(0)-6)+'" text-anchor="middle" style="fill:#2b2a2a;font-weight:700">'+Math.round(x.p*100)+'%</text>'});
  s+='<path d="'+pd.map((x,i)=>(i?'L':'M')+X(i).toFixed(1)+' '+Y(x.ac).toFixed(1)).join(' ')+'" fill="none" stroke="#1f3b57" stroke-width="2.5"/>';
  const passo=Math.ceil(pd.length/16);
  pd.forEach((x,i)=>{s+='<circle cx="'+X(i)+'" cy="'+Y(x.ac)+'" r="'+(i===pd.length-1?5:3.5)+'" fill="#fff" stroke="#1f3b57" stroke-width="2"><title>'+dataBR(x.d)+': acumulado '+pct(x.ac)+'</title></circle>';
    if(i===pd.length-1||(pd.length<=16))s+='<text x="'+X(i)+'" y="'+(Y(x.ac)-10)+'" text-anchor="middle" style="fill:#1f3b57;font-weight:800">'+pct(x.ac)+'</text>';
    if(i%passo===0||i===pd.length-1)s+='<text x="'+X(i)+'" y="'+(H-10)+'" text-anchor="middle">'+x.d.slice(8,10)+' '+semana(x.d).slice(0,3)+'</text>'});
  el.innerHTML=s+'</svg>';
}
function tabelaPrefUps(teams){
  const q=$('u-busca').value.trim().toUpperCase();
  let l=teams.map(t=>Object.assign({},t,{upsDia:t.equipeDias?t.ups/t.equipeDias:null})).filter(t=>!q||t.rec.toUpperCase().includes(q));
  const k=ordemU.k,d=ordemU.dir;l.sort((a,b)=>{const va=a[k]??-1,vb=b[k]??-1;return(va<vb?-1:va>vb?1:0)*d});
  $('u-cont').textContent=l.length+' equipes';
  $('t-upsPref').innerHTML=l.map(t=>'<tr><td><b>'+esc(t.rec)+'</b></td><td>'+esc(t.sigla)+'</td><td>'+esc(t.tipo)+'</td><td class="n">'+n1(t.ups)+'</td><td class="n">'+n1(t.meta)+'</td><td class="n">'+clsCell(t.pct)+'</td><td>'+clsPill(t.classe)+'</td><td class="n">'+n1(t.upsDia)+'</td></tr>').join('')||'<tr><td colspan="8"><div class="empty">Nenhuma equipe.</div></td></tr>';
  document.querySelectorAll('th.sortu').forEach(th=>{th.textContent=th.textContent.replace(/ [▲▼]$/,'');if(th.dataset.k===k)th.textContent+=d>0?' ▲':' ▼'});
}
function diarioUps(L,dias,teams){
  const recs=teams.map(t=>t.rec).sort();
  const g={};for(const l of L){if(!l.cod)continue;const k=l.rec+'|'+l.data;const a=g[k]||(g[k]={u:0,t:false});a.u+=l.ups;a.t=a.t||l.temUps}
  const tm={};for(const t of teams)tm[t.rec]=t;
  let h='<thead><tr><th class="nm">Equipe</th>'+dias.map(d=>'<th>'+d.slice(8,10)+'<br>'+semana(d).slice(0,3)+'</th>').join('')+'<th class="n">Meta acum.</th><th class="n">Total</th></tr></thead><tbody>';
  for(const r of recs){const t=tm[r];h+='<tr><td class="nm">'+esc(r)+'</td>'+dias.map(d=>{const a=g[r+'|'+d];if(!a||!a.t)return'<td class="c"></td>';const c=UPSCalc.corDia(a.u);return'<td class="c cd-'+c+'" title="'+esc(r)+' · '+dataBR(d)+': '+n1(a.u)+' UPS">'+n1(a.u)+'</td>'}).join('')+'<td class="n">'+n1(t.meta)+'</td><td class="n"><span class="pct cl-p-'+t.classe+'">'+n1(t.ups)+'</span></td></tr>'}
  $('upsDiario').innerHTML=h+'</tbody>';
}
function cobrancaUps(L,teams,dias){
  const dia=dias.length?dias[dias.length-1]:null;
  let grupos;
  if(cobModoU==='mes'){
    const g={};for(const t of teams)if(t.classe==='C'||t.classe==='D'){for(const s of t.siglas)(g[s]=g[s]||[]).push(t)}
    grupos=SIGLAS.filter(s=>teams.some(t=>t.siglas.has(s))).map(s=>({s,itens:(g[s]||[]).sort((a,b)=>a.pct-b.pct),total:teams.filter(t=>t.siglas.has(s)).length}));
  }else{
    const g={};for(const l of L){if(l.data!==dia||!l.cod||l.meta<=0)continue;const k=l.rec;const a=g[k]||(g[k]={rec:l.rec,sigla:l.sigla,tipo:l.tipo,u:0});a.u+=l.ups}
    const arr=Object.values(g);
    grupos=SIGLAS.filter(s=>arr.some(a=>a.sigla===s)).map(s=>({s,itens:arr.filter(a=>a.sigla===s&&a.u<31.5).sort((a,b)=>a.u-b.u),total:arr.filter(a=>a.sigla===s).length}));
  }
  $('cobRefU').innerHTML=cobModoU==='mes'?'<span>Acumulado de <b>'+mesNome($('u-mes').value)+'</b>'+(dia?' até '+dataBR(dia).slice(0,5):'')+'</span><span>·</span><span><b>'+grupos.reduce((a,g)=>a+g.itens.length,0)+'</b> equipes em classe C ou D</span>':'<span>Dia <b>'+(dia?dataBR(dia):'–')+'</b></span><span>·</span><span><b>'+grupos.reduce((a,g)=>a+g.itens.length,0)+'</b> equipes abaixo de 31,5 UPS no dia</span>';
  UR.cob={grupos,dia,modo:cobModoU};
  $('cobGridU').innerHTML=grupos.map((g,i)=>'<div class="cob"><div class="cob-hd"><div><h3>'+g.s+' · '+NOME_SIGLA[g.s]+'</h3><div class="sub"><b>'+g.itens.length+'</b> de '+g.total+' equipes'+(cobModoU==='mes'?' em classe C ou D':' abaixo de 31,5 UPS')+'</div></div>'+(g.itens.length?'<button class="btn" type="button" data-cobu="'+i+'">Copiar cobrança</button>':'')+'</div>'
    +(g.itens.length?'<div class="tw"><table><thead><tr><th>Prefixo</th>'+(cobModoU==='mes'?'<th class="n">UPS</th><th class="n">Meta</th><th class="n">%</th><th>Classe</th>':'<th>Tipo</th><th class="n">UPS no dia</th>')+'</tr></thead><tbody>'
      +g.itens.map(t=>cobModoU==='mes'?'<tr><td><b>'+esc(t.rec)+'</b><br><span class="motivo">'+esc(t.tipo)+'</span></td><td class="n">'+n1(t.ups)+'</td><td class="n">'+n1(t.meta)+'</td><td class="n">'+clsCell(t.pct)+'</td><td>'+clsPill(t.classe)+'</td></tr>':'<tr><td><b>'+esc(t.rec)+'</b></td><td>'+esc(t.tipo)+'</td><td class="n"><span class="pct cd-'+UPSCalc.corDia(t.u)+'">'+n1(t.u)+'</span></td></tr>').join('')+'</tbody></table></div>'
      :'<div class="cob-ok">Nenhuma equipe para cobrar.</div>')+'</div>').join('')||'<div class="empty">Sem dados.</div>';
  $('cobGridU').querySelectorAll('[data-cobu]').forEach(b=>b.onclick=()=>copiar(textoCobUps(UR.cob.grupos[+b.dataset.cobu]),'Cobrança copiada.'));
}
function textoCobUps(g){
  const c=UR.cob;let t='*Cobrança de UPS · '+g.s+' · '+NOME_SIGLA[g.s]+'*\n';
  if(c.modo==='mes'){t+='Acumulado de '+mesNome($('u-mes').value)+(c.dia?' até '+dataBR(c.dia).slice(0,5):'')+' · Meta 42 UPS por dia\n\nEquipes em classe C ou D:\n';for(const x of g.itens)t+=(x.classe==='D'?'🔴':'🟠')+' '+x.rec+' ('+x.tipo+'): *'+pct(x.pct)+'* · '+n1(x.ups)+' de '+n1(x.meta)+' UPS · classe '+x.classe+'\n'}
  else{t+='Dia '+dataBR(c.dia)+' ('+semana(c.dia)+')\n\nEquipes abaixo de 31,5 UPS no dia:\n';for(const x of g.itens)t+=(x.u<17.2?'🔴':'🟠')+' '+x.rec+' ('+x.tipo+'): *'+n1(x.u)+' UPS*\n'}
  return t+'\nFavor verificar e enviar a justificativa.';
}
document.querySelectorAll('[data-limu]').forEach(b=>b.onclick=()=>{cobModoU=b.dataset.limu;document.querySelectorAll('[data-limu]').forEach(x=>x.setAttribute('aria-pressed',x===b?'true':'false'));renderUPS()});
$('b-cobTodasU').onclick=()=>{const gs=(UR&&UR.cob?UR.cob.grupos:[]).filter(g=>g.itens.length);if(!gs.length){toast('Nenhuma equipe para cobrar.');return}copiar(gs.map(textoCobUps).join('\n\n────────\n\n'),'Cobranças copiadas.')};
$('u-busca').addEventListener('input',()=>renderUPS());
document.querySelectorAll('th.sortu').forEach(th=>th.addEventListener('click',()=>{const k=th.dataset.k;ordemU=ordemU.k===k?{k,dir:-ordemU.dir}:{k,dir:['pct','rec','sigla','tipo','classe'].includes(k)?1:-1};renderUPS()}));
['u-mes','u-base','u-tipo'].forEach(id=>$(id).addEventListener('change',()=>{$(id).classList.toggle('on',!!$(id).value&&id!=='u-mes');renderUPS();renderInicio()}));

/* ---------- visão geral ---------- */
function renderInicio(){
  const el=$('inicioCards');if(!el)return;
  let h='';
  if(resumo.length){
    const m=[...new Set(resumo.map(r=>r.mes))].sort().pop();const rs=resumo.filter(r=>r.mes===m);const s=soma(rs);
    const ds=[...new Set(rs.map(r=>r.data))].sort();const ud=ds[ds.length-1];const sd=soma(rs.filter(r=>r.data===ud));
    const abaixo=rs.filter(r=>r.data===ud&&r.prev>0&&r.real/r.prev<0.93).length;
    h+='<a class="icard" href="#painel"><div class="ic-hd"><span class="ic-k">Disponibilidade</span><span class="ic-m">'+mesNome(m)+'</span></div><div class="ic-v '+cls(s.pct)+'">'+pct(s.pct)+'</div><div>'+pill(s.pct)+'</div><div class="ic-l"><span>Último dia ('+dataBR(ud).slice(0,5)+')</span><b>'+pct(sd.pct)+'</b></div><div class="ic-l"><span>Equipes abaixo de 93% no dia</span><b>'+abaixo+'</b></div><div class="ic-l"><span>Meta</span><b>93%</b></div><span class="ic-go">Abrir painel →</span></a>';
  }
  if(UR&&UR.ultima){
    const m=UR.ultima.slice(0,7);const L=UR.linhas.filter(l=>l.mes===m);const S=statsUps(L);const c=contaClasses(S.teams);const ab=pctAB(S.teams);
    h+='<a class="icard" href="#ups-painel"><div class="ic-hd"><span class="ic-k">UPS</span><span class="ic-m">'+mesNome(m)+'</span></div><div class="ic-v cl-t-'+(UPSCalc.classe(S.pct)||'x')+'">'+pct(S.pct)+'</div><div>Classe '+clsPill(UPSCalc.classe(S.pct))+'</div><div class="ic-l"><span>Realizado / meta</span><b>'+n0(S.ups)+' / '+n0(S.meta)+'</b></div><div class="ic-l"><span>Equipes A + B</span><b>'+pct(ab)+'</b></div><div class="ic-l"><span>Classes A · B · C · D</span><b>'+c.A+' · '+c.B+' · '+c.C+' · '+c.D+'</b></div><span class="ic-go">Abrir painel →</span></a>';
  }
  el.innerHTML=h||'<div class="empty">Carregando indicadores…</div>';
  $('inicioAte').innerHTML=(ultimaData?'Disponibilidade até <b>'+dataBR(ultimaData)+'</b>':'')+(UR&&UR.ultima?' · UPS até <b>'+dataBR(UR.ultima)+'</b>':'');
}

/* ---------- conferência da UPS ---------- */
function renderAvisosUps(){
  const el=$('avisosUps');if(!el||!UR)return;
  const grupos=[];
  const m=UR.ultima?UR.ultima.slice(0,7):null;
  const falt=[];
  if(m){const mAnt=mesAnterior(m);for(const mm of [mAnt,m]){const ini=mm+'-01';const fim=mm===m?UR.ultima:UPSCalc.addDias(m+'-01',-1);for(let d=ini;d<=fim;d=UPSCalc.addDias(d,1))if(!UR.dias[d])falt.push(d)}}
  grupos.push({t:'r',tit:'Dias sem produção da UPS',sub:'Envie o relatório COI (ou o Relatório de Produção) desses dias em Atualizar com o SIGA. Sem eles, a UPS do mês fica incompleta.',n:falt.length,tab:falt.length?'<tbody><tr><td>'+falt.map(d=>'<span class="tag-dia">'+dataBR(d).slice(0,5)+'</span>').join(' ')+'</td></tr></tbody>':''});
  const semEsc=UR.linhas.filter(l=>l.data===UR.ultima&&!l.cod&&l.n>0);
  grupos.push({t:'a',tit:'Produção sem escala em '+(UR.ultima?dataBR(UR.ultima):'–'),sub:'Equipes com atividade no SIGA, mas sem X na planilha de equipes nesse dia. A produção delas não entra na UPS.',n:semEsc.length,tab:semEsc.length?'<thead><tr><th>Prefixo</th><th class="n">Atividades</th></tr></thead><tbody>'+semEsc.sort((a,b)=>b.n-a.n).map(l=>'<tr><td><b>'+esc(l.rec)+'</b></td><td class="n">'+l.n+'</td></tr>').join('')+'</tbody>':''});
  const fdp=UR.linhas.filter(l=>l.data===UR.ultima&&l.foraDp>0);
  grupos.push({t:'a',tit:'Atividades fora do DE_PARA em '+(UR.ultima?dataBR(UR.ultima):'–'),sub:'A chave do serviço não existe na tabela DE_PARA do Estudo UPS, então a atividade não pontua.',n:fdp.length,tab:fdp.length?'<thead><tr><th>Prefixo</th><th class="n">Atividades</th></tr></thead><tbody>'+fdp.map(l=>'<tr><td><b>'+esc(l.rec)+'</b></td><td class="n">'+l.foraDp+'</td></tr>').join('')+'</tbody>':''});
  nAvisosUps=grupos.reduce((s,g)=>s+(g.n?1:0),0);
  el.innerHTML='<div class="vhead"><div><h3 class="sec-t">UPS</h3></div></div>'+grupos.map(g=>'<div class="panel"><div class="aviso-hd"><span class="ic '+(g.n?g.t:'i')+'">'+(g.n?AVI.r:AVI.i)+'</span><div><h3>'+g.tit+'</h3><p>'+g.sub+'</p></div><span class="n">'+g.n+'</span></div>'+(g.n?'<div class="tw"><table>'+g.tab+'</table></div>':'<div class="aviso-ok">'+AVI.ok+'Nada para conferir.</div>')+'</div>').join('');
}

/* ---------- cadastros da UPS ---------- */
function renderCadUps(){
  if(!UR)return;
  const m=UR.ultima?UR.ultima.slice(0,7):'';const ini=UCFG.escalaInicio;
  const diasNoMes=c=>{let n=0;for(let i=0;i<c.d.length;i++)if(c.d[i]==='1'&&UPSCalc.addDias(ini,i).startsWith(m))n++;return n};
  const idx=UPSCalc.indexarEscala(UCFG,UR.escala);const lst=[];for(const r in idx)for(const c of idx[r])lst.push(c);
  const q=($('escBusca').value||'').trim().toUpperCase();
  const f=lst.filter(c=>!q||(c.rec+' '+c.tipo+' '+c.sigla).toUpperCase().includes(q)).sort((a,b)=>a.rec<b.rec?-1:1);
  $('escOrigem').innerHTML=escalaLocal?'<div class="note warn">Escala nova carregada só neste navegador. Salve em Atualizar com o SIGA.</div>':escalaDb?'<div class="note">Escala da planilha enviada'+(escalaDbInfo?' ('+esc(escalaDbInfo)+')':'')+'.</div>':'<div class="note">Escala da planilha EQUIPES E FREQUÊNCIA usada na criação do site. Para atualizar, envie a planilha nova em <a href="#atualizar">Atualizar com o SIGA</a>.</div>';
  $('t-esc').innerHTML=f.map(c=>'<tr><td><b>'+esc(c.rec)+'</b></td><td>'+esc(c.sigla||'–')+'</td><td>'+esc(c.tipo||'–')+'</td><td>'+(c.est?esc(c.est):'<span class="muted">fora da UPS</span>')+'</td><td>'+esc(c.sub||'')+'</td><td class="n">'+diasNoMes(c)+'</td></tr>').join('');
  $('escCont').textContent=f.length+' cadastros · dias escalados em '+mesNome(m);
  const fer=Object.entries(ferUps||{}).sort((a,b)=>a[0]<b[0]?1:-1);
  $('t-ferU').innerHTML=fer.map(([k,n])=>{const[d,t,b]=k.split('|');return '<tr><td><b>'+dataBR(d)+'</b></td><td>'+esc(t)+'</td><td>'+esc(b)+'</td><td>'+esc(n)+'</td><td>'+(podeSalvar?'<button class="btn sm del" type="button" data-dferu="'+esc(k)+'">Remover</button>':'')+'</td></tr>'}).join('')||'<tr><td colspan="5"><div class="empty">Nenhum feriado por equipe/base cadastrado.</div></td></tr>';
  $('t-ferU').querySelectorAll('[data-dferu]').forEach(b=>b.onclick=()=>{const it=Object.assign({},ferUps);delete it[b.dataset.dferu];salvarFerUps(it,'Feriado removido.')});
  $('formFerU').hidden=!podeSalvar;
}
async function salvarFerUps(itens,ok){
  if(!db||!podeSalvar){toast('Você não tem permissão para alterar os cadastros.');return false}
  try{await db.collection('config').doc('feriadosUps').set({itens,editadoEm:new Date().toISOString()});ferUps=itens;montarUPS();toast(ok);return true}catch(e){toast('Não foi possível salvar.');return false}
}
$('escBusca').addEventListener('input',renderCadUps);
$('formFerU').addEventListener('submit',e=>{e.preventDefault();const d=$('ferUData').value,t=$('ferUTipo').value,b=$('ferUBase').value,n=$('ferUNome').value.trim();if(!d||!t||!b||!n)return;const it=Object.assign({},ferUps);it[d+'|'+t+'|'+b]=n;salvarFerUps(it,'Feriado adicionado.').then(ok=>{if(ok){$('ferUData').value='';$('ferUNome').value=''}})});

/* ---------- leitura da planilha de equipes (escala) ---------- */
function lerEscala(wb){
  const ws=wb.Sheets['EQUIPES'];if(!ws)throw new Error('Aba EQUIPES não encontrada');
  const rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:null});
  const hi=rows.findIndex(r=>r&&r.some(c=>c==='EQUIPE / PREFIXO'));if(hi<0)throw new Error('Cabeçalho "EQUIPE / PREFIXO" não encontrado');
  const h=rows[hi].map(x=>x==null?'':x);const c=n=>h.indexOf(n);
  const ini=UCFG.escalaInicio;
  const dataCol=[];h.forEach((x,i)=>{let d=null;if(typeof x==='number'&&x>40000)d=Disp.parseData(x);else if(typeof x==='string'){const m=x.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(m)d=m[3]+'-'+String(m[2]).padStart(2,'0')+'-'+String(m[1]).padStart(2,'0')}if(d&&d>=ini)dataCol.push([i,d])});
  if(!dataCol.length)throw new Error('Colunas de datas não encontradas na aba EQUIPES');
  const dif=(a,b)=>Math.round((new Date(a+'T00:00:00Z')-new Date(b+'T00:00:00Z'))/86400000);
  const out=[];
  for(let r=hi+1;r<rows.length;r++){const row=rows[r];if(!row)continue;const rec=row[c('EQUIPE / PREFIXO')];if(!rec)continue;
    const arr=[];for(const[i,d]of dataCol){const v=row[i];if(v!=null&&String(v).trim().toUpperCase()==='X')arr[dif(d,ini)]='1'}
    let s='';for(let i=0;i<arr.length;i++)s+=arr[i]||'0';
    const g=n=>c(n)>=0&&row[c(n)]!=null?String(row[c(n)]):null;
    out.push({cod:g('COD'),rec:String(rec),bc:g('BASE'),tipo:g('TIPO DE EQUIPE'),sub:g('SUBTIPO'),ger:g('GERENCIA'),sup:g('SUPERVISOR'),coord:g('COORDENADOR'),tdias:g('TIPO DE DIAS'),treg:g('TIPO'),d:s});
  }
  return out;
}
function linhasRelatorio(wb){
  for(const n of wb.SheetNames){const rows=XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1,raw:true,defval:null});const hi=rows.findIndex(r=>r&&r.includes('Recurso')&&r.includes('Data'));if(hi>=0)return rows.slice(hi)}
  throw new Error('Tabela com as colunas Recurso e Data não encontrada');
}

/* ---------- Excel da UPS ---------- */
async function baixarUps(){
  if(!downloads){toast('Download indisponível nesta visualização.');return}
  if(!UR){toast('A UPS ainda está carregando.');return}
  try{
    const m=$('u-mes').value,L=filtrarUps(),S=statsUps(L),dias=diasComDados(m);
    const fmt=(ws,cols,z)=>{const r=XLSX.utils.decode_range(ws['!ref']);for(let R=1;R<=r.e.r;R++)for(const C of cols){const c=ws[XLSX.utils.encode_cell({r:R,c:C})];if(c&&c.t==='n')c.z=z}};
    const wb=XLSX.utils.book_new();
    const cl=contaClasses(S.teams);
    const res=[['RELATÓRIO DE UPS · '+mesNome(m).toUpperCase()],['Produção até',dias.length?dataBR(dias[dias.length-1]):''],['Filtros',[['Base',$('u-base').value],['Tipo',$('u-tipo').value]].filter(x=>x[1]).map(x=>x[0]+': '+x[1]).join(' · ')||'Todas as equipes'],[],['UPS realizada',S.ups],['Meta acumulada',S.meta],['Atingimento',S.pct],['Classe',UPSCalc.classe(S.pct)||''],[],['CLASSE','EQUIPES'],['A',cl.A],['B',cl.B],['C',cl.C],['D',cl.D],[],['BASE','% EQUIPES A+B','EQUIPES']];
    for(const s of SIGLAS){const ts=S.teams.filter(t=>t.siglas.has(s));res.push([s,pctAB(ts),ts.length])}
    res.push(['GERAL',pctAB(S.teams),S.teams.length]);
    const wsR=XLSX.utils.aoa_to_sheet(res);wsR['!cols']=[{wch:28},{wch:16},{wch:12}];
    for(const a of ['B7']){if(wsR[a])wsR[a].z='0.0%'}
    for(let r=17;r<=22;r++){const c=wsR['B'+r];if(c&&c.t==='n')c.z='0.0%'}
    XLSX.utils.book_append_sheet(wb,wsR,'RESUMO UPS');
    const pe=[['Recurso','Base','Tipo de equipe','UPS','Meta','% Atingimento','Classe','Equipe-dias','UPS por dia']];
    for(const t of S.teams.slice().sort((a,b)=>a.rec<b.rec?-1:1))pe.push([t.rec,t.sigla,t.tipo,+t.ups.toFixed(2),t.meta,t.pct,t.classe,t.equipeDias,t.equipeDias?+(t.ups/t.equipeDias).toFixed(2):'']);
    const wsP=XLSX.utils.aoa_to_sheet(pe);fmt(wsP,[5],'0.0%');wsP['!autofilter']={ref:wsP['!ref']};wsP['!cols']=[{wch:16},{wch:7},{wch:14},{wch:10},{wch:8},{wch:13},{wch:7},{wch:11},{wch:11}];
    XLSX.utils.book_append_sheet(wb,wsP,'POR EQUIPE');
    const g={};for(const l of L){if(!l.cod)continue;const k=l.rec+'|'+l.data;g[k]=(g[k]||0)+l.ups}
    const di=[['Recurso',...dias.map(d=>dataBR(d)),'Meta acumulada','Total']];
    for(const t of S.teams.slice().sort((a,b)=>a.rec<b.rec?-1:1))di.push([t.rec,...dias.map(d=>g[t.rec+'|'+d]!=null?+g[t.rec+'|'+d].toFixed(1):''),t.meta,+t.ups.toFixed(1)]);
    const wsD=XLSX.utils.aoa_to_sheet(di);wsD['!cols']=[{wch:16},...dias.map(()=>({wch:10})),{wch:14},{wch:9}];
    XLSX.utils.book_append_sheet(wb,wsD,'DIÁRIO');
    const meses=[...new Set(UR.linhas.filter(l=>l.meta>0).map(l=>l.mes))].sort();
    const ag={};for(const l of UR.linhas){for(const k of [l.mes+'|TOTAL'].concat(l.cod&&l.sigla?[l.mes+'|'+l.sigla]:[])){const a=ag[k]||(ag[k]=[0,0]);a[0]+=l.ups;a[1]+=l.meta}}
    const bm=[['Base',...meses.map(mm=>MESES[+mm.slice(5)-1].slice(0,3)+'/'+mm.slice(2,4))]];
    for(const s of SIGLAS.concat(['TOTAL']))bm.push([s,...meses.map(mm=>{const a=ag[mm+'|'+s];return a&&a[1]?a[0]/a[1]:''})]);
    const wsB=XLSX.utils.aoa_to_sheet(bm);fmt(wsB,meses.map((_,i)=>i+1),'0.0%');
    XLSX.utils.book_append_sheet(wb,wsB,'BASE X MÊS');
    const data=XLSX.write(wb,{type:'array',bookType:'xlsx'});
    await downloads.save({filename:'UPS - '+m+(dias.length?' até '+dataBR(dias[dias.length-1]).replace(/\//g,'-'):'')+'.xlsx',data:new Uint8Array(data)});
  }catch(e){if(!e||e.code!=='declined')toast('Não foi possível gerar o Excel.')}
}

/* ---------- print da UPS ---------- */
async function gerarPrintUps(){
  try{await document.fonts.ready}catch(e){}
  const F='"Plus Jakarta Sans",Arial,sans-serif';
  const m=$('u-mes').value,L=filtrarUps(),S=statsUps(L),cl=contaClasses(S.teams),dias=diasComDados(m);
  const tipos={};for(const l of L.filter(x=>x.cod)){const a=tipos[l.tipo]||(tipos[l.tipo]={k:l.tipo,ups:0,meta:0,recs:new Set(),ed:new Set()});a.ups+=l.ups;a.meta+=l.meta;if(l.n>0){a.recs.add(l.rec);a.ed.add(l.rec+'|'+l.data)}}
  const TL=Object.values(tipos).sort((a,b)=>a.k<b.k?-1:1);
  const pd=dias.map(d=>{let u=0,mt=0;for(const l of L)if(l.data===d){u+=l.ups;mt+=l.meta}return{d,u,mt}}).filter(x=>x.mt>0);let cu=0,cm=0;for(const x of pd){cu+=x.u;cm+=x.mt;x.p=x.u/x.mt;x.ac=cu/cm}
  const meses=[...new Set(UR.linhas.filter(l=>l.meta>0).map(l=>l.mes))].sort().slice(-12);
  const ag={};for(const l of UR.linhas){for(const k of [l.mes+'|TOTAL'].concat(l.cod&&l.sigla?[l.mes+'|'+l.sigla]:[])){const a=ag[k]||(ag[k]=[0,0]);a[0]+=l.ups;a[1]+=l.meta}}
  const W=1200,P=36;const tabH=60+(TL.length+1)*34+16, chH=270, mxH=60+6*32+16;
  const H=130+P+120+20+110+24+Math.max(tabH,240)+24+chH+24+mxH+60;
  const Sx=2,cv=document.createElement('canvas');cv.width=W*Sx;cv.height=H*Sx;const c=cv.getContext('2d');c.scale(Sx,Sx);
  c.fillStyle='#f4f4f4';c.fillRect(0,0,W,H);
  const g=c.createLinearGradient(0,0,W,130);g.addColorStop(0,'#711424');g.addColorStop(1,'#4a0b16');c.fillStyle=g;c.fillRect(0,0,W,130);
  const logo=document.querySelector('.logo-img');let lx=P;if(logo&&logo.naturalWidth){const lh=44,lw=logo.naturalWidth*lh/logo.naturalHeight;c.drawImage(logo,P,43,lw,lh);lx=P+lw+22;c.strokeStyle='rgba(255,255,255,.3)';c.beginPath();c.moveTo(lx-11,38);c.lineTo(lx-11,92);c.stroke()}
  c.fillStyle='rgba(255,255,255,.75)';c.font='700 12px '+F;c.fillText('SETOR DE MEDIÇÃO',lx,58);c.fillStyle='#fff';c.font='italic 900 30px '+F;c.fillText('Relatório de UPS',lx,92);
  c.textAlign='right';c.font='800 24px '+F;c.fillText(mesNome(m).replace(/^./,x=>x.toUpperCase()),W-P,64);c.font='600 13px '+F;c.fillStyle='rgba(255,255,255,.85)';
  const filt=[$('u-base').value,$('u-tipo').value].filter(Boolean).join(' · ');c.fillText((dias.length?'Produção até '+dataBR(dias[dias.length-1]):'')+(filt?' · '+filt:''),W-P,90);c.textAlign='left';
  const card=(x,y,w,h)=>{c.save();c.shadowColor='rgba(43,42,42,.08)';c.shadowBlur=14;c.shadowOffsetY=3;rr(c,x,y,w,h,16);c.fillStyle='#fff';c.fill();c.restore();rr(c,x,y,w,h,16);c.strokeStyle='#dedadb';c.stroke()};
  // faixa de resumo
  let y=130+P;card(P,y,W-2*P,120);
  c.font='700 12px '+F;c.fillStyle='#6b6a6a';c.fillText('REALIZADO',P+24,y+36);c.font='800 40px '+F;c.fillStyle='#2b2a2a';c.fillText(n0(S.ups),P+24,y+82);
  const w1=c.measureText(n0(S.ups)).width;c.font='600 16px '+F;c.fillStyle='#6b6a6a';c.fillText('de '+n0(S.meta)+' UPS',P+34+w1,y+80);
  const cc=UPSCalc.classe(S.pct);c.font='800 44px '+F;c.fillStyle=cc?({A:'#2a8f30',B:'#a08c00',C:'#c25a00',D:'#d12f2f'})[cc]:'#6b6a6a';c.textAlign='right';c.fillText(pct(S.pct),W-P-150,y+82);
  rr(c,W-P-126,y+42,96,48,12);c.fillStyle=cc?CL_COR[cc]:'#eaeaea';c.fill();c.fillStyle='#2b2a2a';c.font='800 13px '+F;c.textAlign='center';c.fillText('CLASSE',W-P-78,y+60);c.font='900 20px '+F;c.fillText(cc||'–',W-P-78,y+82);c.textAlign='left';
  const mesmo=UR.ultima&&UR.ultima.startsWith(m);if(mesmo&&S.pct!=null){const mm=metaDoMes(m);c.font='600 13px '+F;c.fillStyle='#6b6a6a';c.fillText('Projeção do mês: '+n0(mm*S.pct)+' de '+n0(mm)+' UPS',P+24,y+106)}
  // classes + bases
  y+=140;const cw=(W-2*P-3*14)/4;
  ['A','B','C','D'].forEach((k,i)=>{const x=P+i*(cw+14);card(x,y,cw,96);c.save();rr(c,x,y,cw,96,16);c.clip();c.fillStyle=CL_COR[k];c.fillRect(x,y,7,96);c.restore();c.fillStyle='#6b6a6a';c.font='700 13px '+F;c.fillText('Classe '+k,x+22,y+30);c.fillStyle='#2b2a2a';c.font='800 34px '+F;c.fillText(String(cl[k]),x+22,y+70);c.font='600 12px '+F;c.fillStyle='#6b6a6a';c.textAlign='right';c.fillText(pct(cl[k]/(S.teams.length||1))+' das equipes',x+cw-18,y+70);c.textAlign='left'});
  y+=96+24;
  // tipo (esq) e bases (dir)
  const lw=Math.round((W-2*P-20)*0.6),rw=W-2*P-20-lw,rx=P+lw+20,hh=Math.max(tabH,240);
  card(P,y,lw,hh);c.fillStyle='#2b2a2a';c.font='800 17px '+F;c.fillText('Por tipo de equipe',P+20,y+32);
  const cols=[['TIPO',P+20,'left'],['EQUIPES',P+230,'right'],['UPS',P+320,'right'],['META',P+410,'right'],['%',P+500,'right'],['CLASSE',P+560,'center'],['UPS/DIA',P+lw-20,'right']];
  c.font='700 11px '+F;c.fillStyle='#6b6a6a';for(const[t,x,a]of cols){c.textAlign=a;c.fillText(t,x,y+58)}c.textAlign='left';
  let yy=y+66;const rowT=(nome,a,tot)=>{const p=a.meta?a.ups/a.meta:null,k=UPSCalc.classe(p);c.strokeStyle='#eeeaeb';c.beginPath();c.moveTo(P+20,yy);c.lineTo(P+lw-20,yy);c.stroke();if(tot){c.fillStyle='#f4f4f4';c.fillRect(P+20,yy+1,lw-40,33)}
    c.font=(tot?'800 ':'700 ')+'13px '+F;c.fillStyle='#2b2a2a';c.fillText(nome,P+20,yy+22);c.textAlign='right';c.fillText(String(a.recs.size),P+230,yy+22);c.fillText(n0(a.ups),P+320,yy+22);c.fillText(n0(a.meta),P+410,yy+22);c.fillText(pct(p),P+500,yy+22);
    if(k){rr(c,P+546,yy+8,28,20,6);c.fillStyle=CL_COR[k];c.fill();c.fillStyle='#2b2a2a';c.textAlign='center';c.font='800 12px '+F;c.fillText(k,P+560,yy+22)}
    c.textAlign='right';c.font='700 13px '+F;c.fillStyle='#2b2a2a';c.fillText(n1(a.ed.size?a.ups/a.ed.size:null),P+lw-20,yy+22);c.textAlign='left';yy+=34};
  for(const a of TL)rowT(a.k,a);const tot={ups:0,meta:0,recs:new Set(),ed:new Set()};for(const l of L){tot.ups+=l.ups;tot.meta+=l.meta;if(l.n>0){tot.recs.add(l.rec);tot.ed.add(l.rec+'|'+l.data)}}rowT('Total',tot,true);
  card(rx,y,rw,hh);c.fillStyle='#2b2a2a';c.font='800 17px '+F;c.fillText('% de equipes A + B por base',rx+20,y+32);
  let by=y+52;const bw=(rw-40-2*10)/3;
  SIGLAS.concat(['GERAL']).forEach((s,i)=>{const ts=s==='GERAL'?S.teams:S.teams.filter(t=>t.siglas.has(s));const p=pctAB(ts);const fx=UPSCalc.faixaBase(p).cls;const col={sup:'#2b7a0f',ate:'#3C9E18',par:'#a35a00',nao:'#C00000',nd:'#8a7f82'}[fx],bg={sup:'#e3f3dc',ate:'#eef8e9',par:'#fff3e0',nao:'#fbe5e5',nd:'#f1eded'}[fx];
    const x=rx+20+(i%3)*(bw+10),yb=by+Math.floor(i/3)*86;rr(c,x,yb,bw,76,12);c.fillStyle=bg;c.fill();c.fillStyle='#6b6a6a';c.font='800 12px '+F;c.textAlign='center';c.fillText(s,x+bw/2,yb+22);c.fillStyle=col;c.font='800 24px '+F;c.fillText(pct(p),x+bw/2,yb+52);c.font='600 11px '+F;c.fillStyle='#6b6a6a';c.fillText(ts.length+' equipes',x+bw/2,yb+68);c.textAlign='left'});
  // ritmo
  y+=hh+24;card(P,y,W-2*P,chH);c.fillStyle='#2b2a2a';c.font='800 17px '+F;c.fillText('Ritmo diário × acumulado',P+20,y+32);
  if(pd.length){const x0=P+60,x1=W-P-24,yt=y+60,yb=y+chH-40,top=Math.max(1,Math.ceil(Math.max(...pd.map(x=>Math.max(x.p,x.ac)))*10)/10),bwd=(x1-x0)/pd.length,X=i=>x0+bwd*i+bwd/2,Y=v=>yt+(top-v)/top*(yb-yt);
    c.font='600 11px '+F;for(let v=0;v<=top+1e-9;v+=0.2){c.strokeStyle='#eeeaeb';c.beginPath();c.moveTo(x0,Y(v));c.lineTo(x1,Y(v));c.stroke();c.fillStyle='#6b6a6a';c.textAlign='right';c.fillText(Math.round(v*100)+'%',x0-8,Y(v)+4)}c.textAlign='left';
    pd.forEach((x,i)=>{const k=UPSCalc.classe(x.p),w=Math.min(46,bwd*0.7);rr(c,X(i)-w/2,Y(x.p),w,Y(0)-Y(x.p),3);c.fillStyle=CL_COR[k];c.fill();if(pd.length<=16){c.fillStyle='#2b2a2a';c.font='700 11px '+F;c.textAlign='center';c.fillText(Math.round(x.p*100)+'%',X(i),Y(0)-6)}
      const passo=Math.ceil(pd.length/16);if(i%passo===0||i===pd.length-1){c.fillStyle='#6b6a6a';c.font='600 11px '+F;c.textAlign='center';c.fillText(x.d.slice(8,10)+' '+semana(x.d).slice(0,3),X(i),yb+22)}c.textAlign='left'});
    c.beginPath();pd.forEach((x,i)=>i?c.lineTo(X(i),Y(x.ac)):c.moveTo(X(i),Y(x.ac)));c.strokeStyle='#1f3b57';c.lineWidth=2.5;c.stroke();c.lineWidth=1;
    pd.forEach((x,i)=>{c.beginPath();c.arc(X(i),Y(x.ac),i===pd.length-1?5:3.5,0,Math.PI*2);c.fillStyle='#fff';c.fill();c.strokeStyle='#1f3b57';c.lineWidth=2;c.stroke();c.lineWidth=1});
    const lp=pd[pd.length-1];c.fillStyle='#1f3b57';c.font='800 13px '+F;c.textAlign='center';c.fillText(pct(lp.ac),Math.min(X(pd.length-1),x1-24),Y(lp.ac)-12);c.textAlign='left'}
  // mês × base
  y+=chH+24;card(P,y,W-2*P,mxH);c.fillStyle='#2b2a2a';c.font='800 17px '+F;c.fillText('UPS por mês · atingimento por base',P+20,y+32);
  const mx0=P+120,mcw=(W-2*P-120-20)/Math.max(1,meses.length);c.font='700 11px '+F;c.fillStyle='#6b6a6a';c.textAlign='center';meses.forEach((mm,i)=>c.fillText(MESES[+mm.slice(5)-1].slice(0,3)+'/'+mm.slice(2,4),mx0+i*mcw+mcw/2,y+56));c.textAlign='left';
  SIGLAS.concat(['TOTAL']).forEach((s,j)=>{const yr=y+64+j*32;c.fillStyle='#2b2a2a';c.font=(s==='TOTAL'?'800 ':'700 ')+'13px '+F;c.fillText(s==='TOTAL'?'Total':s,P+20,yr+20);
    meses.forEach((mm,i)=>{const a=ag[mm+'|'+s];const p=a&&a[1]?a[0]/a[1]:null;const fx=UPSCalc.faixaBase(p).cls;const bg={sup:'#2b7a0f',ate:'#9fd58a',par:'#f6c77d',nao:'#C00000',nd:'#eaeaea'}[fx],tc={sup:'#fff',ate:'#173d08',par:'#5a3300',nao:'#fff',nd:'#a0a0a0'}[fx];rr(c,mx0+i*mcw+2,yr+3,mcw-4,26,6);c.fillStyle=bg;c.fill();c.fillStyle=tc;c.font='800 11.5px '+F;c.textAlign='center';c.fillText(p==null?'–':(p*100).toFixed(1).replace('.',',')+'%',mx0+i*mcw+mcw/2,yr+20);c.textAlign='left'})});
  const agora=new Date();c.font='600 12px '+F;c.fillStyle='#6b6a6a';c.fillText('Meta 42 UPS por equipe-dia · Classe A ≥ 90,95% · B ≥ 75% · C ≥ 40,95% · D abaixo · Fonte: SIGA (COI)',P,H-24);c.textAlign='right';c.fillText('Gerado em '+agora.toLocaleDateString('pt-BR')+' às '+agora.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}),W-P,H-24);c.textAlign='left';
  return cv;
}
