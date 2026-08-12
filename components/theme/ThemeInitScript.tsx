import { APP_THEME_STORAGE_KEY } from '../../lib/theme/constants';
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

  return `(function(){
try{
var k='${APP_THEME_STORAGE_KEY}';
var t=localStorage.getItem(k);
if(t!=='dark'&&t!=='light')t='light';
var r=document.documentElement;
var tokens=t==='dark'?${dark}:${light};
r.setAttribute('data-theme',t);
r.setAttribute('data-mantine-color-scheme',t);
r.classList.toggle('dark',t==='dark');
r.style.colorScheme=t;
var pk='${PALETTE_STORAGE_KEY}';
var p=localStorage.getItem(pk);
if(${paletteKeys}.indexOf(p)===-1)p='${DEFAULT_PALETTE_KEY}';
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
var APP=${appearance};
var pa=(APP[p]||APP['${DEFAULT_PALETTE_KEY}'])[t];
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
}catch(e){}
})();`;
}

/** Aplica el tema guardado antes de hidratar React */
export function ThemeInitScript() {
  return <script dangerouslySetInnerHTML={{ __html: buildInitScript() }} />;
}
