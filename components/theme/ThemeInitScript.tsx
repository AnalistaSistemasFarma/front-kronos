import { APP_THEME_STORAGE_KEY, LANDING_CSS_VARS } from '../../lib/theme/constants';
import {
  DEFAULT_PALETTE_KEY,
  PALETTE_APPEARANCE,
  PALETTE_KEY_SET,
  PALETTE_STORAGE_KEY,
} from '../../lib/theme/palettes';
import { darkTokens, lightTokens } from '../../lib/theme/tokens';

function buildInitScript(): string {
  const light = JSON.stringify(lightTokens);
  const dark = JSON.stringify(darkTokens);
  const paletteKeys = JSON.stringify(Array.from(PALETTE_KEY_SET));
  const appearance = JSON.stringify(PALETTE_APPEARANCE);
  const landingVars = JSON.stringify(LANDING_CSS_VARS);

  return `(function(){
try{
function hx(n){n=Math.max(0,Math.min(255,Math.round(n)));return n.toString(16).padStart(2,'0')}
function rgb(h){h=String(h).replace('#','');return[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]}
function mix(a,b,t){var A=rgb(a),B=rgb(b);return'#'+hx(A[0]+(B[0]-A[0])*t)+hx(A[1]+(B[1]-A[1])*t)+hx(A[2]+(B[2]-A[2])*t)}
function lum(h){var C=rgb(h).map(function(c){c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4)});return 0.2126*C[0]+0.7152*C[1]+0.0722*C[2]}
function ratio(a,b){var x=lum(a),y=lum(b),hi=Math.max(x,y),lo=Math.min(x,y);return (hi+0.05)/(lo+0.05)}
function toHsl(h){var C=rgb(h),r=C[0]/255,g=C[1]/255,b=C[2]/255,max=Math.max(r,g,b),min=Math.min(r,g,b),l=(max+min)/2,s=0,hh=0;if(max!==min){var d=max-min;s=l>0.5?d/(2-max-min):d/(max+min);if(max===r)hh=(g-b)/d+(g<b?6:0);else if(max===g)hh=(b-r)/d+2;else hh=(r-g)/d+4;hh*=60}return[hh,s*100,l*100]}
function hue2(p,q,t){if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p}
function fromHsl(h,s,l){h=((h%360)+360)%360;s=Math.max(0,Math.min(100,s))/100;l=Math.max(0,Math.min(100,l))/100;if(s===0){var g=l*255;return'#'+hx(g)+hx(g)+hx(g)}var q=l<0.5?l*(1+s):l+s-l*s,p=2*l-q,hk=h/360;return'#'+hx(hue2(p,q,hk+1/3)*255)+hx(hue2(p,q,hk)*255)+hx(hue2(p,q,hk-1/3)*255)}
function tune(hex,bg,dark){var H=toHsl(hex),h=H[0],s=Math.max(38,Math.min(82,H[1])),l=H[2];if(!dark){l=Math.min(l,42);while(ratio(fromHsl(h,s,l),bg)<4.5&&l>10)l-=2}else{l=Math.max(l,58);while(ratio(fromHsl(h,s,l),bg)<4.5&&l<90)l+=2}return fromHsl(h,s,l)}
function customPa(hex,mode){if(mode!=='dark'){var bg=mix('#eef1f5',hex,0.1);var surface=mix('#ffffff',hex,0.045);var acc=tune(hex,bg,false);return{bg:bg,surface:surface,surfaceRaised:mix('#ffffff',hex,0.03),header:surface,accent:acc,accentHover:mix(acc,'#000000',0.12)}}var dbg=mix('#151c2e',hex,0.16);var dsurface=mix('#1f2840',hex,0.18);var dacc=tune(hex,dbg,true);return{bg:dbg,surface:dsurface,surfaceRaised:mix('#283352',hex,0.2),header:mix('#121824',hex,0.14),accent:dacc,accentHover:mix(dacc,'#ffffff',0.14)}}
var k='${APP_THEME_STORAGE_KEY}';
var landing=location.pathname==='/';
var t=landing?'light':localStorage.getItem(k);
if(t!=='dark'&&t!=='light')t='light';
var r=document.documentElement;
var tokens=t==='dark'?${dark}:${light};
r.setAttribute('data-theme',t);
r.setAttribute('data-mantine-color-scheme',t);
r.classList.toggle('dark',t==='dark');
r.style.colorScheme=t;
if(landing)r.setAttribute('data-landing','true');else r.removeAttribute('data-landing');
var pk='${PALETTE_STORAGE_KEY}';
var p=landing?'${DEFAULT_PALETTE_KEY}':localStorage.getItem(pk);
var customHex=null;
if(!landing&&typeof p==='string'&&/^custom:#[0-9a-fA-F]{6}$/.test(p)){customHex=p.slice(7).toLowerCase();}
else if(${paletteKeys}.indexOf(p)===-1)p='${DEFAULT_PALETTE_KEY}';
r.setAttribute('data-palette',p);
var map={
  '--app-bg':tokens.bg,
  '--app-surface':tokens.surface,
  '--app-surface-raised':tokens.surfaceRaised,
  '--app-header':tokens.header,
  '--app-text':tokens.text,
  '--app-text-muted':tokens.textMuted,
  '--app-border':tokens.border,
  '--app-border-subtle':tokens.borderSubtle,
  '--chart-text':tokens.chartText,
  '--chart-grid':tokens.chartGrid,
  '--chart-panel':tokens.chartPanel,
  '--chart-tooltip-bg':tokens.chartTooltipBg,
  '--app-accent':tokens.accent,
  '--app-card-shadow':tokens.cardShadow,
  '--background':tokens.bg,
  '--foreground':tokens.text,
  '--surface':tokens.surface
};
for(var q in map){if(map[q])r.style.setProperty(q,map[q]);}
if(landing){
  var lv=${landingVars};
  for(var lk in lv){if(lv[lk])r.style.setProperty(lk,lv[lk]);}
}else{
var APP=${appearance};
var pa=customHex?customPa(customHex,t):(APP[p]||APP['${DEFAULT_PALETTE_KEY}'])[t];
if(pa){
  var pmap={
    '--app-bg':pa.bg,
    '--background':pa.bg,
    '--mantine-color-body':pa.bg,
    '--app-surface':pa.surface,
    '--surface':pa.surface,
    '--app-surface-raised':pa.surfaceRaised,
    '--surface-muted':pa.surfaceRaised,
    '--app-header':pa.header,
    '--app-accent':pa.accent,
    '--app-accent-hover':pa.accentHover,
    '--mantine-color-anchor':pa.accent
  };
  for(var m in pmap){if(pmap[m])r.style.setProperty(m,pmap[m]);}
}
}
}catch(e){}
})();`;
}

/** Aplica el tema guardado antes de hidratar React */
export function ThemeInitScript() {
  return <script dangerouslySetInnerHTML={{ __html: buildInitScript() }} />;
}
