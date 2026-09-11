const P = {
  paperPreset:'A4 Portrait', canvasWMM:210, canvasHMM:297, dpi:150,
  previewScale:1, fitToViewport:true, margin:12, showGrid:true,
  gridRows:1, gridCols:1,
  stroke:.25, colorA:'#151515', colorB:'#2f7f78', barbPattern:'alternating',
};
const FEATHER_DEFAULTS = {
  width:175, bend:18, taper:.82, angle:60, curl:.7, texture:.3, fray:.32, density:110, spine:12,
  height:235,
};
const selected = {...FEATHER_DEFAULTS,seed:31,rotation:0};
function makeInstance(x,y,seed){return {x,y,seed,rotation:0,...FEATHER_DEFAULTS};}
let instances=[makeInstance(105,148.5,31)], active=0, cnv, pane, dragging;
let cache=new WeakMap();
function setup(){
  const size=PaperUtils.getCanvasPixelSize(P);
  cnv=createCanvas(size.width,size.height); cnv.parent('wrap'); pixelDensity(1); noLoop();
  buildPane(); fit();
  const el=cnv.elt;
  el.addEventListener('pointerdown',pointerDown);
  el.addEventListener('pointermove',pointerMove);
  el.addEventListener('pointerup',()=>dragging=null);
  el.addEventListener('pointercancel',()=>dragging=null);
  document.querySelector('#arrange').onclick=arrange;
  document.querySelector('#reseed').onclick=()=>{instances[active].seed=nextSeed();cache.delete(instances[active]);syncSelection();redraw();};
  document.querySelector('#reseedAll').onclick=reseedAll;
  document.querySelector('#svg').onclick=()=>ExportUtils.downloadText(svgText(),`feathers-${instances[0].seed}.svg`,'image/svg+xml');
  document.querySelector('#png').onclick=()=>{paint(false);saveCanvas(cnv,`feathers-${instances[0].seed}`,'png');redraw();};
  new ResizeObserver(fit).observe(document.querySelector('#wrap'));
}
function nextSeed(){let n;do{n=Math.floor(Math.random()*1000000);}while(instances.some(i=>i.seed===n));return n;}
function buildPane(){
  pane=new Tweakpane.Pane({container:document.querySelector('#pane'),title:'Feather generator'});
  const shape=pane.addFolder({title:'Feather',expanded:true});
  for(const [key,label,min,max,step] of [
    ['width','Width',25,400,1],['bend','Bend',-240,240,1],['taper','Taper',.1,3,.01],
    ['angle','Barb angle',5,115,1],['curl','Curl',0,4,.01],['texture','Texture',0,2,.01],
    ['fray','Base fray',0,2,.01],['density','Barbs / side',12,400,1],['spine','Spine width',2,40,.5]
  ])shape.addInput(selected,key,{label,min,max,step}).on('change',()=>{
    instances[active][key]=selected[key];cache.delete(instances[active]);redraw();
  });
  const composition=pane.addFolder({title:'Placement & ink',expanded:true});
  composition.addInput(P,'gridRows',{label:'Rows',min:1,max:12,step:1}).on('change',applyGrid);
  composition.addInput(P,'gridCols',{label:'Columns',min:1,max:12,step:1}).on('change',applyGrid);
  composition.addInput(selected,'height',{label:'Size (mm)',min:10,max:500,step:1}).on('change',()=>{instances[active].height=selected.height;redraw();});
  composition.addInput(selected,'seed',{label:'Selected seed',min:0,max:999999,step:1}).on('change',()=>{instances[active].seed=selected.seed;cache.delete(instances[active]);redraw();});
  composition.addInput(selected,'rotation',{label:'Rotation',min:-180,max:180,step:1}).on('change',()=>{instances[active].rotation=selected.rotation;redraw();});
  composition.addInput(P,'stroke',{label:'Stroke (mm)',min:.05,max:2,step:.05}).on('change',()=>redraw());
  composition.addInput(P,'colorA',{label:'Barb color A'}).on('change',()=>redraw());
  composition.addInput(P,'colorB',{label:'Barb color B'}).on('change',()=>redraw());
  composition.addInput(P,'barbPattern',{label:'Barb pattern',options:{
    'Alternating':'alternating','Fine bands':'fineBands','Broad bands':'broadBands',
    'Split sides':'splitSides','Base / tip':'baseTip','Chevron bands':'chevron','Seeded mix':'random'
  }}).on('change',()=>redraw());
  const paper=pane.addFolder({title:'Paper & preview',expanded:false});
  paper.addInput(P,'paperPreset',{label:'Paper',options:Object.fromEntries(Object.keys(PaperUtils.PAPER_PRESETS_MM).map(k=>[k,k]))}).on('change',()=>{PaperUtils.applyPaperPreset(P,P.paperPreset);resizePaper();});
  for(const key of ['canvasWMM','canvasHMM'])paper.addInput(P,key,{label:key==='canvasWMM'?'Width (mm)':'Height (mm)',min:30,max:1000,step:1}).on('change',()=>{PaperUtils.syncPresetFromSize(P);resizePaper();});
  paper.addInput(P,'margin',{label:'Grid margin',min:0,max:50,step:1}).on('change',arrange);
  paper.addInput(P,'showGrid',{label:'Show grid guides'}).on('change',()=>redraw());
  paper.addInput(P,'dpi',{label:'PNG DPI',options:{'96':96,'150':150,'300':300}}).on('change',resizePaper);
  paper.addInput(P,'fitToViewport',{label:'Fit view'}).on('change',fit);
  paper.addInput(P,'previewScale',{label:'Zoom',min:.25,max:3,step:.05}).on('change',fit);
}
function resizePaper(){const size=PaperUtils.getCanvasPixelSize(P);resizeCanvas(size.width,size.height,true);fit();pane.refresh();redraw();}
function fit(){if(cnv)PaperUtils.updateCanvasDisplaySize({style:(key,value)=>{cnv.elt.style[key]=value;}},P,'wrap',36);}
function syncSelection(){Object.assign(selected,instances[active]);pane.refresh();}
function geometry(item){
  if(!cache.has(item)){
    const paths=FeatherGeometry.generate(item,item.seed);
    // Bound the entire Bézier control hull, including the outlined shaft.
    const coords=paths.flatMap(p=>p.d.match(/-?\d+(?:\.\d+)?/g).map(Number));
    const xs=coords.filter((_,i)=>i%2===0),ys=coords.filter((_,i)=>i%2===1);
    cache.set(item,{paths:paths.map(p=>({...p,path:new Path2D(p.d)})),bounds:{x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)}});
  }return cache.get(item);
}
function arrange(){
  const n=instances.length, cols=P.gridCols,rows=P.gridRows;
  const margin=Math.min(P.margin,Math.min(P.canvasWMM,P.canvasHMM)*.2);
  const w=(P.canvasWMM-2*margin)/cols,h=(P.canvasHMM-2*margin)/rows;
  instances.forEach((item,i)=>{
    item.x=margin+(i%cols+.5)*w;item.y=margin+(Math.floor(i/cols)+.5)*h;item.rotation=0;
    const b=geometry(item).bounds;
    item.height=Math.min(w*.88*650/b.w,h*.88*650/b.h);
  });
  syncSelection();redraw();
}
function applyGrid(){
  P.gridRows=Math.max(1,Math.round(P.gridRows));
  P.gridCols=Math.max(1,Math.round(P.gridCols));
  const count=P.gridRows*P.gridCols;
  while(instances.length<count){
    instances.push(makeInstance(P.canvasWMM/2,P.canvasHMM/2,nextSeed()));
  }
  if(instances.length>count)instances.length=count;
  active=Math.min(active,instances.length-1);
  arrange();syncSelection();pane.refresh();
}
function reseedAll(){
  instances.forEach(item=>{item.seed=nextSeed();});
  cache=new WeakMap();syncSelection();redraw();
}
function draw(){paint(true);}
function barbType(path,item){
  if(path.kind==='spine')return 0;
  const t=path.t||0,side=path.side||1,index=path.index||0;
  switch(P.barbPattern){
    case 'fineBands':return Math.floor(t*12)%2;
    case 'broadBands':return Math.floor(t*4)%2;
    case 'splitSides':return side>0?1:0;
    case 'baseTip':return t>=.5?1:0;
    case 'chevron':return (Math.floor(t*8)+(side>0?1:0))%2;
    case 'random':{
      const n=Math.sin((index+1)*12.9898+side*78.233+item.seed*.731)*43758.5453;
      return n-Math.floor(n)>=.5?1:0;
    }
    default:return Math.abs(index)%2;
  }
}
function pathColor(path,item){return barbType(path,item)?P.colorB:P.colorA;}
function drawGridGuides(ctx){
  const margin=Math.min(P.margin,Math.min(P.canvasWMM,P.canvasHMM)*.2);
  const innerW=P.canvasWMM-margin*2,innerH=P.canvasHMM-margin*2;
  const cellW=innerW/P.gridCols,cellH=innerH/P.gridRows;
  ctx.save();
  ctx.fillStyle='rgba(85,155,169,.035)';
  ctx.strokeStyle='rgba(85,155,169,.58)';
  ctx.lineWidth=.22;
  ctx.setLineDash([1.2,1.2]);
  for(let row=0;row<P.gridRows;row++){
    for(let col=0;col<P.gridCols;col++){
      ctx.fillRect(margin+col*cellW,margin+row*cellH,cellW,cellH);
      ctx.strokeRect(margin+col*cellW,margin+row*cellH,cellW,cellH);
    }
  }
  ctx.strokeStyle='rgba(38,111,126,.9)';
  ctx.lineWidth=.35;
  ctx.setLineDash([2,1]);
  ctx.strokeRect(margin,margin,innerW,innerH);
  ctx.restore();
}
function paint(guides){
  background(255);const ctx=drawingContext,px=PaperUtils.getPxPerMM(P);
  ctx.save();ctx.scale(px,px);
  if(guides&&P.showGrid)drawGridGuides(ctx);
  ctx.lineCap='round';ctx.lineJoin='round';
  instances.forEach((item,i)=>{
    const g=geometry(item),b=g.bounds,s=item.height/650;
    ctx.save();ctx.translate(item.x,item.y);ctx.rotate(item.rotation*Math.PI/180);ctx.scale(s,s);ctx.translate(-b.x-b.w/2,-b.y-b.h/2);
    ctx.lineWidth=P.stroke/s;for(const p of g.paths){ctx.strokeStyle=pathColor(p,item);ctx.stroke(p.path);}
    if(guides&&i===active){ctx.strokeStyle='#559ba9';ctx.lineWidth=.18/s;ctx.setLineDash([1.5/s,1.5/s]);ctx.strokeRect(b.x-5,b.y-5,b.w+10,b.h+10);}
    ctx.restore();
  });ctx.restore();
  document.querySelector('#status').textContent=`${instances.length} feather${instances.length===1?'':'s'} · selected ${active+1} · ${P.canvasWMM} × ${P.canvasHMM} mm`;
}
function localPoint(event){const r=cnv.elt.getBoundingClientRect();return {x:(event.clientX-r.left)/r.width*P.canvasWMM,y:(event.clientY-r.top)/r.height*P.canvasHMM};}
function pointerDown(e){
  const p=localPoint(e);
  for(let i=instances.length-1;i>=0;i--){
    const item=instances[i],s=item.height/650,a=-item.rotation*Math.PI/180,dx=p.x-item.x,dy=p.y-item.y;
    const b=geometry(item).bounds,x=(dx*Math.cos(a)-dy*Math.sin(a))/s+b.x+b.w/2,y=(dx*Math.sin(a)+dy*Math.cos(a))/s+b.y+b.h/2;
    if(x>=b.x-10&&x<=b.x+b.w+10&&y>=b.y-10&&y<=b.y+b.h+10){active=i;dragging={dx,dy};cnv.elt.setPointerCapture(e.pointerId);syncSelection();redraw();break;}
  }
}
function pointerMove(e){if(!dragging)return;const p=localPoint(e);instances[active].x=Math.max(0,Math.min(P.canvasWMM,p.x-dragging.dx));instances[active].y=Math.max(0,Math.min(P.canvasHMM,p.y-dragging.dy));redraw();}
function svgText(){
  const f=ExportUtils.fmt;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${P.canvasWMM}mm" height="${P.canvasHMM}mm" viewBox="0 0 ${P.canvasWMM} ${P.canvasHMM}"><g fill="none" stroke-linecap="round" stroke-linejoin="round">${instances.map((item,i)=>{const s=item.height/650;return `<g id="feather-${i+1}" data-seed="${item.seed}" stroke-width="${f(P.stroke/s)}" transform="translate(${f(item.x)} ${f(item.y)}) rotate(${f(item.rotation)}) scale(${f(s)}) translate(${f(-geometry(item).bounds.x-geometry(item).bounds.w/2)} ${f(-geometry(item).bounds.y-geometry(item).bounds.h/2)})">${geometry(item).paths.map(p=>`<path stroke="${ExportUtils.escapeXML(pathColor(p,item))}" d="${p.d}"/>`).join('')}</g>`;}).join('')}</g></svg>`;
}
