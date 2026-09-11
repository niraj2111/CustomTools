/* Feather construction adapted from the supplied parametric generator. */
const FeatherGeometry = (() => {
  const defaults={
    shaftBend:18,
    shaftS:6,
    featherWidth:175,
    baseBare:.12,
    baseBulge:.78,
    tipTaper:.82,
    asymmetry:.04,

    density:110,
    barbReach:.96,
    baseAngle:60,
    tipAngle:22,
    curvature:.7,
    barbNoiseStrength:0,
    barbNoiseScale:5,
    barbNoiseSeed:31,
    tipHandle:.42,
    rootHandle:.32,
    irregularity:.07,
    organicPosition:1,
    organicLength:1,
    organicAngle:1,
    organicScale:18,
    organicSeed:47,
    gaps:.03,
    gapSeverity:.3,
    lowerFray:.32,
    lowerFrayScale:11,
    lowerFraySeed:263,

    barbStroke:1.55,
    shaftStroke:4.2,
    opacity:1,
    color:'#151515',
    seed:31,

    paletteMode:'solid',
    paletteColors:['#151515'],
    colorNoiseScale:3.2,
    colorBanding:.35
  };

  let state, paths;
  function rng(seed){
    let t=seed>>>0;
    return()=>{
      t+=0x6D2B79F5;
      let r=Math.imul(t^t>>>15,1|t);
      r^=r+Math.imul(r^r>>>7,61|r);
      return((r^r>>>14)>>>0)/4294967296;
    };
  }

  const lerp=(a,b,t)=>a+(b-a)*t;

  function hexToRgb(hex){
    const n=parseInt(hex.slice(1),16);
    return{r:(n>>16)&255,g:(n>>8)&255,b:n&255};
  }

  function rgbToHex(c){
    const h=v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0');
    return`#${h(c.r)}${h(c.g)}${h(c.b)}`;
  }

  function mixColor(a,b,t){
    const x=hexToRgb(a),y=hexToRgb(b);
    return rgbToHex({
      r:lerp(x.r,y.r,t),
      g:lerp(x.g,y.g,t),
      b:lerp(x.b,y.b,t)
    });
  }

  function noise(x,y,s){
    const q=Math.sin(x*12.9898+y*78.233+s*.731)*43758.5453;
    return q-Math.floor(q);
  }

  function smoothNoise1D(x,channel,seed){
    const cell=Math.floor(x);
    const f=x-cell;
    const blend=f*f*f*(f*(f*6-15)+10);
    return lerp(
      noise(cell,channel,seed),
      noise(cell+1,channel,seed),
      blend
    )*2-1;
  }

  function fractalNoise1D(x,channel,seed){
    return (
      smoothNoise1D(x,channel,seed)*.58+
      smoothNoise1D(x*2.03,channel+13.7,seed+37)*.28+
      smoothNoise1D(x*4.11,channel+29.1,seed+83)*.14
    );
  }

  // Low-frequency domain warping makes length changes flow through
  // neighboring barbs instead of looking like independent jitter.
  function fluidNoise1D(x,channel,seed){
    const warp=smoothNoise1D(
      x*.32+5.7,
      channel+41.3,
      seed+131
    )*.7;
    const broad=smoothNoise1D(
      x*.48-2.4,
      channel+67.9,
      seed+197
    );
    const flow=smoothNoise1D(
      x+warp,
      channel,
      seed
    );
    return flow*.74+broad*.26;
  }

  // Smooth, signed noise sampled by attachment position along the shaft.
  // Nearby barbs share a bend; each side has its own deterministic pattern.
  function barbCurvatureNoise(t,side){
    return smoothNoise1D(
      t*state.barbNoiseScale,
      side,
      state.barbNoiseSeed
    )*state.barbNoiseStrength;
  }

  function organicNoise(t,side,channel){
    return fractalNoise1D(
      t*state.organicScale+channel*3.17,
      side*7.3+channel,
      state.organicSeed+channel*101
    );
  }

  function paletteColor(t,side,i){
    if(state.paletteMode==='solid')return state.color;
    const cols=state.paletteColors;
    const nA=noise(t*state.colorNoiseScale,side*2.31+i*.017,state.seed);
    const nB=noise(t*1.4+17,i*.053,state.seed+91);
    const n=lerp(nA,nB,state.colorBanding);

    if(cols.length===2)return mixColor(cols[0],cols[1],n);
    return n<.5
      ?mixColor(cols[0],cols[1],n*2)
      :mixColor(cols[1],cols[2],(n-.5)*2);
  }

  function shaftPoint(t){
    const x0=300,y0=720,x3=300+state.shaftBend*.22,y3=70;
    const x1=300-state.shaftBend*.12+state.shaftS*.55,y1=510;
    const x2=300+state.shaftBend*.82-state.shaftS*.35,y2=265;
    const u=1-t;

    return{
      x:u*u*u*x0+3*u*u*t*x1+3*u*t*t*x2+t*t*t*x3,
      y:u*u*u*y0+3*u*u*t*y1+3*u*t*t*y2+t*t*t*y3
    };
  }

  function shaftTangent(t){
    const e=.0008;
    const a=shaftPoint(Math.max(0,t-e));
    const b=shaftPoint(Math.min(1,t+e));
    const dx=b.x-a.x,dy=b.y-a.y;
    const m=Math.hypot(dx,dy)||1;
    return{x:dx/m,y:dy/m};
  }

  function envelope(t,side){
    const u=Math.max(0,Math.min(1,(t-state.baseBare)/(1-state.baseBare)));
    const belly=Math.pow(Math.sin(Math.PI*u),.62);
    const rise=Math.pow(u,.36);
    const fall=Math.pow(1-u,state.tipTaper*.72+.12);

    let shape=(.25+.75*belly)*rise*Math.pow(fall,.28);
    shape*=lerp(.7,1.15,state.baseBulge*Math.max(0,1-u*1.7));

    const sideScale=side<0?1-state.asymmetry:1+state.asymmetry;
    return Math.max(0,state.featherWidth*shape*sideScale);
  }


  function shaftEdge(t,side){
    const p=shaftPoint(t), v=shaftTangent(t);
    // Both edges meet at each tip; the shaft never uses a center stroke.
    const half=state.shaftStroke*.5*Math.pow(Math.sin(Math.PI*t),.38)*Math.pow(1-t,.55);
    return {x:p.x-v.y*side*half,y:p.y+v.x*side*half};
  }
  function addPath(d,width,color,opacity=1,meta={}){paths.push({d,...meta});}
  function build(){
    paths=[];
    const random=rng(state.seed);

    const outline=[];
    for(const side of [-1,1]){
      for(let i=0;i<=100;i++){
        const t=side<0?i/100:1-i/100;
        const p=shaftEdge(t,side);
        outline.push(`${outline.length?'L':'M'} ${p.x.toFixed(3)} ${p.y.toFixed(3)}`);
      }
    }
    addPath(outline.join(' ')+' Z',state.barbStroke,state.color,1,{kind:'spine'});

    let count=0;
    const n=Math.round(state.density);

    for(const side of [-1,1]){
      for(let i=0;i<n;i++){
        let t=state.baseBare+((i+.45)/n)*(1-state.baseBare);
        t+=organicNoise(t,side,1)*state.irregularity*state.organicPosition*.006;
        t=Math.max(state.baseBare,Math.min(.996,t));

        const featherT=Math.max(0,Math.min(1,
          (t-state.baseBare)/(1-state.baseBare)
        ));
        const lowerWeight=Math.pow(
          Math.max(0,1-featherT/.42),
          1.35
        );
        const frayLength=fluidNoise1D(
          t*state.lowerFrayScale*.65,
          side*19.1,
          state.lowerFraySeed
        );
        const frayAngle=fractalNoise1D(
          t*state.lowerFrayScale+7.9,
          side*23.7,
          state.lowerFraySeed+156
        );

        if(random()<state.gaps*(.35+.65*t))continue;

        const rootP=shaftEdge(t,side);
        const tipward=shaftTangent(t);
        const outward={
          x:-tipward.y*side,
          y:tipward.x*side
        };

        let len=envelope(t,side)*state.barbReach;
        len*=1+organicNoise(t,side,2)*state.irregularity*state.organicLength*.7;
        len*=1+frayLength*state.lowerFray*lowerWeight*.55;

        if(random()<state.gaps*.8){
          len*=1-state.gapSeverity*(.35+random()*.65);
        }

        len=Math.max(4,len);

        const angleExponent=3.2;
        const baseOpening=(
          Math.exp(angleExponent*(1-featherT))-1
        )/(Math.exp(angleExponent)-1);
        const aDeg=
          state.tipAngle+(state.baseAngle-state.tipAngle)*baseOpening+
          organicNoise(t,side,3)*state.irregularity*state.organicAngle*8+
          frayAngle*state.lowerFray*lowerWeight*20;

        const a=aDeg*Math.PI/180;

        let rx=
          outward.x*Math.sin(a)+
          tipward.x*Math.cos(a);

        let ry=
          outward.y*Math.sin(a)+
          tipward.y*Math.cos(a);

        const rm=Math.hypot(rx,ry)||1;
        rx/=rm;
        ry/=rm;

        const lateral=len*(1-state.curvature*.065);
        const forward=len*(.10+state.curvature*.16);

        const end={
          x:rootP.x+rx*lateral+tipward.x*forward,
          y:rootP.y+ry*lateral+tipward.y*forward
        };

        const h1=len*(.20+state.rootHandle*.28);

        const c1={
          x:rootP.x+rx*h1,
          y:rootP.y+ry*h1
        };

        // For a cubic Bézier, endpoint tangent = end - c2.
        // Putting c2 behind the endpoint along -tipward guarantees
        // the final barb direction points toward the feather tip.
        const h2=len*(.08+state.tipHandle*.34+state.curvature*.10);

        const c2={
          x:end.x-tipward.x*h2,
          y:end.y-tipward.y*h2
        };

        const lowerBend=frayAngle*state.lowerFray*lowerWeight;
        if(lowerBend){
          c1.x+=tipward.x*len*lowerBend*.32;
          c1.y+=tipward.y*len*lowerBend*.32;
          const frayedH2=h2*(1+frayLength*state.lowerFray*lowerWeight*.7);
          c2.x=end.x-tipward.x*frayedH2;
          c2.y=end.y-tipward.y*frayedH2;
        }

        if(state.barbNoiseStrength>0){
          const bend=barbCurvatureNoise(t,side);
          c1.x+=tipward.x*len*bend*.6;
          c1.y+=tipward.y*len*bend*.6;
          // Keep the last handle behind the fixed endpoint so its tangent
          // still points tipward, even at maximum noise strength.
          const currentH2=Math.hypot(end.x-c2.x,end.y-c2.y);
          const noisyH2=currentH2*(1+bend*.8);
          c2.x=end.x-tipward.x*noisyH2;
          c2.y=end.y-tipward.y*noisyH2;
        }

        addPath(
          `M ${rootP.x.toFixed(2)} ${rootP.y.toFixed(2)} C ${c1.x.toFixed(2)} ${c1.y.toFixed(2)}, ${c2.x.toFixed(2)} ${c2.y.toFixed(2)}, ${end.x.toFixed(2)} ${end.y.toFixed(2)}`,
          state.barbStroke,
          paletteColor(t,side,i),
          1,
          {kind:'barb',t,side,index:i}
        );

        count++;
      }
    }

    const downy=Math.round(3+state.lowerFray*18);

    for(let i=0;i<downy;i++){
      const t=state.baseBare*(.25+.8*random());
      const side=random()<.5?-1:1;
      const p=shaftEdge(t,side);
      const tipward=shaftTangent(t);
      const outward={
        x:-tipward.y*side,
        y:tipward.x*side
      };

      const downyFlow=fluidNoise1D(
        (t/Math.max(.001,state.baseBare))*state.lowerFrayScale*.7,
        side*31.1,
        state.lowerFraySeed+503
      );
      const len=12+(downyFlow*.5+.5)*38*state.lowerFray;

      const end={
        x:p.x+outward.x*len+tipward.x*len*.35,
        y:p.y+outward.y*len+tipward.y*len*.35
      };

      const c1={
        x:p.x+outward.x*len*.45,
        y:p.y+outward.y*len*.45
      };

      const c2={
        x:end.x-tipward.x*len*.25,
        y:end.y-tipward.y*len*.25
      };

      addPath(
        `M ${p.x.toFixed(2)} ${p.y.toFixed(2)} C ${c1.x.toFixed(2)} ${c1.y.toFixed(2)}, ${c2.x.toFixed(2)} ${c2.y.toFixed(2)}, ${end.x.toFixed(2)} ${end.y.toFixed(2)}`,
        Math.max(.45,state.barbStroke*.7),
        paletteColor(t,side,i+1000),
        .7,
        {kind:'barb',t,side,index:i+1000}
      );
    }

    return paths;
  }

  return {generate(p,seed){
    state={...defaults, seed, organicSeed:seed+47, lowerFraySeed:seed+263, barbNoiseSeed:seed+31,
      shaftBend:p.bend, shaftS:p.bend*.35, featherWidth:p.width,
      tipTaper:p.taper, baseBulge:1.5-p.taper*.35,
      baseAngle:p.angle, tipAngle:Math.max(2,p.angle*.36),
      curvature:p.curl, tipHandle:.25+p.curl*.2,
      irregularity:p.texture*.35, barbNoiseStrength:p.texture*.6,
      organicScale:5+p.texture*30, gaps:p.texture*.1,
      asymmetry:fractalNoise1D(.7,2,seed)*p.texture*.35,
      lowerFray:p.fray, density:p.density, shaftStroke:p.spine,
    };
    return build();
  }};
})();
